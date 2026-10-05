import { resolve, sep } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { chromium } from 'playwright';
import sharp from 'sharp';
import type { Db } from '../db/client.js';
import { pages, scans, type ScanRow } from '../db/schema.js';
import { SEVERITIES, type FindingView } from '@pre-mlr/shared';
import { findingViewsForScan, pageTips } from '../review/views.js';
import { renderSiteMapSvg } from '../sitemap/render.js';
import { footerTemplate, IMAGE_ORIGIN, renderReportHtml, type ReportSummary } from './html.js';
import {
  PANEL,
  pageLabel,
  planReport,
  type ImageInfo,
  type PageSize,
  type ReportFinding,
  type ReportPageInput,
  type ReportPlan,
  type ReportPrecedent,
} from './plan.js';

const JPEG_QUALITY = 80;

export interface GenerateReportOptions {
  db: Db;
  dataDir: string;
  pageSize: PageSize;
  scan: ScanRow;
  now?: Date;
}

// One PDF at a time: each render launches a browser and decodes every screenshot.
let queue: Promise<unknown> = Promise.resolve();

export function generateReportPdf(opts: GenerateReportOptions): Promise<Buffer> {
  const run = queue.then(() => generate(opts));
  queue = run.catch(() => {});
  return run;
}

async function generate({
  db,
  dataDir,
  pageSize,
  scan,
  now = new Date(),
}: GenerateReportOptions): Promise<Buffer> {
  const rows = db
    .select()
    .from(pages)
    .where(eq(pages.scanId, scan.id))
    .orderBy(asc(pages.crawlIndex))
    .all();

  // The report reflects the review state at download time; rejected findings are only counted.
  const views = findingViewsForScan(db, scan.id);
  const rejected = views.filter((f) => f.status === 'rejected').length;
  const included = views.filter((f) => f.status !== 'rejected');
  const tips = pageTips(
    db,
    rows.map((r) => r.id),
  );

  const inputs: ReportPageInput[] = await Promise.all(
    rows.map(async (row, i) => ({
      id: row.id,
      number: i + 1,
      url: row.url,
      title: row.title,
      httpStatus: row.httpStatus,
      error: row.error,
      desktop: await imageInfo(dataDir, row.desktopScreenshotPath),
      mobile: await imageInfo(dataDir, row.mobileScreenshotPath),
      findings: toReportFindings(
        included.filter((f) => f.pageId === row.id),
        String(i + 1),
      ),
      tip: tips.get(row.id) ?? null,
      precedents: pagePrecedents(included.filter((f) => f.pageId === row.id)),
    })),
  );
  const siteWide = toReportFindings(
    included.filter((f) => f.pageId === null),
    'S',
  );
  const plan = planReport(pageSize, inputs, siteWide);
  const summary: ReportSummary = {
    rejected,
    findings: [
      ...siteWide.map((finding) => ({ finding, page: null })),
      ...inputs.flatMap((p) =>
        p.findings.map((finding) => ({ finding, page: { number: p.number, label: pageLabel(p) } })),
      ),
    ],
  };
  const svg = (await renderSiteMapSvg(rows)) ?? '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  const generatedAt = now.toISOString();
  const html = renderReportHtml(
    plan,
    {
      scanId: scan.id,
      startUrl: scan.startUrl,
      maxPages: scan.maxPages,
      maxDepth: scan.maxDepth,
      pagesCrawled: scan.pagesCrawled,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
      generatedAt,
      summary,
    },
    svg,
  );

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    // Serve screenshot slices on demand; block every other request (the report needs no network).
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (!url.startsWith(`${IMAGE_ORIGIN}/img/`)) return route.abort();
      const body = await sliceJpeg(plan, url);
      return body ? route.fulfill({ contentType: 'image/jpeg', body }) : route.abort();
    });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const { layout } = plan;
    return await page.pdf({
      width: `${layout.page.width}px`,
      height: `${layout.page.height}px`,
      margin: px(layout.margin),
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footerTemplate(generatedAt),
      tagged: true,
    });
  } finally {
    await browser.close();
  }
}

/**
 * The page's best past comments: each finding's closest match first (in finding order), then the
 * runners-up, without repeats.
 */
function pagePrecedents(views: FindingView[]): ReportPrecedent[] {
  const seen = new Set<string>();
  const out: ReportPrecedent[] = [];
  for (const rank of [1, 2, 3]) {
    for (const f of views) {
      const p = f.precedents.find((x) => x.rank === rank);
      const key = p?.text.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!p || seen.has(key!) || out.length >= PANEL.precedents) continue;
      seen.add(key!);
      out.push(p);
    }
  }
  return out;
}

/** Orders a page's findings (severity, then position on the page) and labels them "<page>.<n>". */
function toReportFindings(views: FindingView[], prefix: string): ReportFinding[] {
  const sorted = [...views].sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      (a.evidenceLocation?.y ?? Infinity) - (b.evidenceLocation?.y ?? Infinity) ||
      a.ruleId.localeCompare(b.ruleId),
  );
  return sorted.map((f, i) => ({
    id: f.id,
    label: `${prefix}.${i + 1}`,
    ruleId: f.ruleId,
    ruleTitle: f.rule.title,
    citation: f.rule.sourceCitation,
    category: f.rule.category,
    severity: f.severity,
    status: f.status as ReportFinding['status'],
    detectedBy: f.detectedBy,
    confidence: f.confidence,
    message: f.message,
    evidence: f.evidenceText,
    suggestedFix: f.suggestedFix,
    editedFix: f.editedFix,
    comment: f.authorComment,
    updatedBy: f.updatedBy,
    updatedAt: f.updatedAt,
    location: f.evidenceLocation?.view === 'desktop' ? f.evidenceLocation : null,
  }));
}

async function sliceJpeg(plan: ReportPlan, url: string): Promise<Buffer | null> {
  const m = /\/img\/(\d+)-(\d+)\.jpg$/.exec(url);
  if (!m) return null;
  const planned = plan.pages[Number(m[1]) - 1];
  if (planned?.kind !== 'screenshot') return null;
  const slice = planned.columns[Number(m[2])];
  if (!slice) return null;
  return sharp(planned.image.path)
    .extract({ left: 0, top: slice.top, width: planned.image.width, height: slice.height })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/** Resolves a DATA_DIR-relative screenshot path and reads its size; null if missing or outside DATA_DIR. */
async function imageInfo(dataDir: string, rel: string | null): Promise<ImageInfo | null> {
  if (!rel) return null;
  const root = resolve(dataDir);
  const path = resolve(root, rel);
  if (!path.startsWith(root + sep)) return null;
  try {
    const { width, height } = await sharp(path).metadata();
    return width && height ? { path, width, height } : null;
  } catch {
    return null;
  }
}

const px = (m: Record<string, number>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, `${v}px`]));

export function reportFilename(scan: ScanRow, now = new Date()): string {
  const host = new URL(scan.startUrl).host.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
  return `pre-mlr-report-${host}-${now.toISOString().slice(0, 10)}.pdf`;
}

export function loadScan(db: Db, id: string): ScanRow | undefined {
  return db.select().from(scans).where(eq(scans.id, id)).get();
}
