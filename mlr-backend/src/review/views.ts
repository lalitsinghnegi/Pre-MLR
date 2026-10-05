import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type {
  FindingPrecedent,
  FindingView,
  ScanSummary,
  Severity,
  FindingStatus,
} from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
import {
  findingPrecedents,
  findings,
  llmAnalyses,
  pages,
  precedentClassifications,
  precedents,
  ruleVersions,
  scans,
  type ScanRow,
} from '../db/schema.js';

const SEVERITY_ORDER = sql`CASE ${findings.severity} WHEN 'critical' THEN 0 WHEN 'major' THEN 1 WHEN 'minor' THEN 2 ELSE 3 END`;

/** Findings joined with their page and rule version, ordered by page, then severity. */
export function findingViews(db: Pick<Db, 'select'>, where: SQL | undefined): FindingView[] {
  const rows = db
    .select({ f: findings, p: pages, r: ruleVersions })
    .from(findings)
    .leftJoin(pages, eq(pages.id, findings.pageId))
    .innerJoin(
      ruleVersions,
      and(eq(ruleVersions.ruleId, findings.ruleId), eq(ruleVersions.version, findings.ruleVersion)),
    )
    .where(where)
    .orderBy(
      asc(sql`coalesce(${pages.crawlIndex}, -1)`),
      asc(SEVERITY_ORDER),
      asc(findings.ruleId),
      asc(findings.createdAt),
    )
    .all();
  const tips = pageTips(db, [...new Set(rows.flatMap(({ p }) => (p ? [p.id] : [])))]);
  const similar = precedentsFor(
    db,
    rows.map(({ f }) => f.id),
  );
  return rows.map(({ f, p, r }) => ({
    ...f,
    page: p
      ? {
          id: p.id,
          number: p.crawlIndex + 1,
          url: p.url,
          title: p.title,
          screenshots: { desktop: !!p.desktopScreenshotPath, mobile: !!p.mobileScreenshotPath },
          tip: tips.get(p.id) ?? null,
        }
      : null,
    rule: {
      title: r.title,
      category: r.category,
      description: r.description,
      sourceCitation: r.sourceCitation,
      sourceUrl: r.sourceUrl,
      sourceNote: r.sourceNote,
    },
    precedents: similar.get(f.id) ?? [],
  }));
}

/** Attached precedents per finding, most similar first. Never includes reviewer pseudonyms. */
export function precedentsFor(
  db: Pick<Db, 'select'>,
  findingIds: string[],
): Map<string, FindingPrecedent[]> {
  const out = new Map<string, FindingPrecedent[]>();
  // Chunked to stay under SQLite's bound-parameter limit on large scans.
  for (let i = 0; i < findingIds.length; i += 500) {
    const rows = db
      .select({ fp: findingPrecedents, p: precedents, category: precedentClassifications.category })
      .from(findingPrecedents)
      .innerJoin(precedents, eq(precedents.id, findingPrecedents.precedentId))
      .leftJoin(precedentClassifications, eq(precedentClassifications.precedentId, precedents.id))
      .where(inArray(findingPrecedents.findingId, findingIds.slice(i, i + 500)))
      .orderBy(asc(findingPrecedents.findingId), asc(findingPrecedents.rank))
      .all();
    for (const { fp, p, category } of rows) {
      const list = out.get(fp.findingId) ?? [];
      list.push({
        id: p.id,
        text: p.commentText,
        site: p.site,
        brand: p.brand,
        commentedAt: p.commentedAt,
        reviewerFunction: p.reviewerFunction,
        outcome: p.status,
        category,
        rank: fp.rank,
        similarity: fp.similarity,
      });
      out.set(fp.findingId, list);
    }
  }
  return out;
}

/** Latest successful LLM page tip per page. */
export function pageTips(db: Pick<Db, 'select'>, pageIds: string[]): Map<string, string> {
  if (!pageIds.length) return new Map();
  const rows = db
    .select({ pageId: llmAnalyses.pageId, tip: llmAnalyses.pageTip })
    .from(llmAnalyses)
    .where(and(inArray(llmAnalyses.pageId, pageIds), eq(llmAnalyses.status, 'ok')))
    .orderBy(asc(llmAnalyses.createdAt))
    .all();
  return new Map(rows.flatMap((r) => (r.tip ? [[r.pageId, r.tip] as const] : [])));
}

export const findingViewsForScan = (db: Db, scanId: string) =>
  findingViews(db, eq(findings.scanId, scanId));
export const findingViewsByIds = (db: Db, ids: string[]) =>
  ids.length ? findingViews(db, inArray(findings.id, ids)) : [];
export const findingView = (db: Db, id: string): FindingView | undefined =>
  findingViews(db, eq(findings.id, id))[0];

/** Scans newest first, with finding counts. */
export function scanSummaries(db: Db): ScanSummary[] {
  const rows = db
    .select()
    .from(scans)
    .orderBy(sql`${scans.createdAt} DESC`)
    .all();
  const counts = db
    .select({
      scanId: findings.scanId,
      status: findings.status,
      severity: findings.severity,
      n: sql<number>`count(*)`,
    })
    .from(findings)
    .groupBy(findings.scanId, findings.status, findings.severity)
    .all();
  return rows.map((scan) =>
    summarize(
      scan,
      counts.filter((c) => c.scanId === scan.id),
    ),
  );
}

function summarize(
  scan: ScanRow,
  counts: { status: FindingStatus; severity: Severity; n: number }[],
): ScanSummary {
  const byStatus: ScanSummary['findings']['byStatus'] = {
    open: 0,
    accepted: 0,
    rejected: 0,
    edited: 0,
  };
  const openBySeverity: ScanSummary['findings']['openBySeverity'] = {
    critical: 0,
    major: 0,
    minor: 0,
    info: 0,
  };
  let total = 0;
  for (const c of counts) {
    total += c.n;
    byStatus[c.status] += c.n;
    if (c.status === 'open') openBySeverity[c.severity] += c.n;
  }
  // The scan row's columns are exactly the API's scan fields.
  return { ...scan, findings: { total, byStatus, openBySeverity } };
}
