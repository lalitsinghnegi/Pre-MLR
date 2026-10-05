import {
  DISCLAIMER,
  RULE_CATEGORIES,
  SEVERITIES,
  type RuleCategory,
  type Severity,
} from '@pre-mlr/shared';
import {
  APPENDIX,
  PANEL,
  clip,
  precedentLine,
  type PanelContent,
  type PlannedPage,
  type Range,
  type ReportFinding,
  type ReportPageInput,
  type ReportPlan,
} from './plan.js';

export interface ReportMeta {
  scanId: string;
  startUrl: string;
  maxPages: number;
  maxDepth: number;
  pagesCrawled: number;
  startedAt: string | null;
  finishedAt: string | null;
  generatedAt: string;
  summary: ReportSummary;
}

export interface ReportSummary {
  /** Every included (non-rejected) finding, with its page label (null for site-wide). */
  findings: { finding: ReportFinding; page: { number: number; label: string } | null }[];
  /** Rejected findings, counted but not shown. */
  rejected: number;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#cf222e',
  major: '#bc4c00',
  minor: '#9a6700',
  info: '#0969da',
};
const CATEGORY_LABEL: Record<RuleCategory, string> = {
  safety_information: 'Safety information',
  fair_balance: 'Fair balance',
  claims: 'Claims',
  references: 'References',
  branding: 'Branding',
  links: 'Links',
  legal_privacy: 'Legal & privacy',
  accessibility: 'Accessibility',
};
const STATUS_LABEL = { open: 'Open', accepted: 'Accepted', edited: 'Edited' } as const;
const AUTOMATED = new Set(['rules_engine', 'llm']);

/** Origin the PDF renderer intercepts to serve screenshot slices; never hits the network. */
export const IMAGE_ORIGIN = 'http://report.invalid';
export const imageUrl = (pdfPage: number, column: number) =>
  `${IMAGE_ORIGIN}/img/${pdfPage}-${column}.jpg`;

const NOT_CAPTURED_LIMIT = 15;

export function renderReportHtml(plan: ReportPlan, meta: ReportMeta, sitemapSvg: string): string {
  const { layout } = plan;
  const css = `
    /* Page size and margins come from page.pdf(); an @page rule here would override them. */
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: Helvetica, Arial, sans-serif; color: #1f2328; font-size: 12px; }
    .page { width: ${layout.content.width}px; height: ${layout.content.height}px; overflow: hidden;
            break-after: page; position: relative; }
    .page:last-child { break-after: auto; }
    h1 { font-size: 26px; margin: 0 0 4px; }
    h2 { font-size: 18px; margin: 0 0 12px; }
    .muted { color: #57606a; }
    .disclaimer { border: 1px solid #d4a72c; background: #fff8c5; padding: 8px 12px; margin: 16px 0; font-size: 12px; }
    table.meta { border-collapse: collapse; margin: 12px 0; }
    table.meta th { text-align: left; padding: 3px 16px 3px 0; color: #57606a; font-weight: normal; }
    table.meta td { padding: 3px 0; }
    .cols { display: flex; gap: 32px; }
    .cols > div { flex: 1; min-width: 0; }
    ul.plain { margin: 0; padding-left: 16px; }
    ul.plain li { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sitemap { width: 100%; height: ${layout.content.height - 40}px; display: flex; align-items: center; justify-content: center; }
    .sitemap svg { width: 100%; height: 100%; }
    .heading { height: ${layout.headingHeight}px; display: flex; justify-content: space-between; gap: 16px;
               border-bottom: 1px solid #d0d7de; margin-bottom: ${layout.gap}px; }
    .heading .title { min-width: 0; }
    .heading .title div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .heading .name { font-size: 17px; font-weight: bold; margin-bottom: 2px; }
    .heading .url { font-size: 11px; color: #0969da; }
    .heading .where { text-align: right; white-space: nowrap; font-size: 11px; color: #57606a; }
    .heading .view { font-size: 13px; font-weight: bold; color: #1f2328; text-transform: uppercase; letter-spacing: 0.04em; }
    .body { display: flex; gap: ${layout.gap}px; height: ${layout.shot.height}px; }
    .shot { width: ${layout.shot.width}px; display: flex; gap: ${layout.gap}px; align-items: flex-start; }
    .shot img { display: block; border: 1px solid #d0d7de; }
    .shot-col { position: relative; }
    .marker { position: absolute; border: 2px solid #cf222e; border-radius: 2px; }
    .marker span { position: absolute; right: 100%; top: -2px; margin-right: 2px; white-space: nowrap; background: #cf222e; color: #fff; font-size: 10px; font-weight: bold;
                   line-height: 14px; min-width: 14px; padding: 0 3px; border-radius: 3px; text-align: center; }
    .panel { width: ${layout.panelWidth}px; border: 1px solid #d0d7de; border-radius: 6px; padding: 10px 11px; overflow: hidden;
             font-size: 10px; line-height: ${PANEL.lineHeight}px; }
    .panel h3 { margin: 0 0 8px; font-size: 12px; line-height: 14px; }
    .tip { background: #f6f8fa; border-left: 3px solid #54aeff; padding: 2px 6px; margin-bottom: ${PANEL.findingGap}px; }
    .tip b { display: block; }
    .prec { background: #fbf8ff; border-left: 3px solid #a475f9; padding: 0 6px; margin-bottom: ${PANEL.findingGap}px; color: #3b3f45; }
    .prec b { display: block; color: #1f2328; }
    .f { margin-bottom: ${PANEL.findingGap}px; }
    .f .head { font-weight: bold; }
    .num { display: inline-block; background: #cf222e; color: #fff; border-radius: 3px; padding: 0 3px; margin-right: 3px; }
    .sev { display: inline-block; font-size: 8px; font-weight: bold; letter-spacing: 0.04em; border: 1px solid; border-radius: 3px;
           padding: 0 3px; line-height: 11px; margin-right: 3px; vertical-align: 1px; }
    .ai { display: inline-block; font-size: 8px; font-weight: bold; color: #0a3069; background: #ddf4ff; border: 1px solid #54aeff;
          border-radius: 3px; padding: 0 3px; line-height: 11px; vertical-align: 1px; }
    .f .title { font-size: 10.5px; }
    .decision { color: #57606a; }
    .decision.open { color: #9a6700; }
    .label { color: #57606a; }
    .more { border-top: 1px dashed #d0d7de; padding-top: 6px; color: #57606a; }
    table.grid { border-collapse: collapse; margin: 6px 0 14px; font-size: 11px; }
    table.grid th, table.grid td { border: 1px solid #d0d7de; padding: 3px 8px; text-align: right; }
    table.grid th:first-child, table.grid td:first-child { text-align: left; }
    table.grid thead th { background: #f6f8fa; }
    .appendix { font-size: 10.5px; line-height: ${APPENDIX.lineHeight}px; }
    .appendix h3.group { font-size: 12px; margin: 8px 0 6px; padding-bottom: 2px; border-bottom: 1px solid #d0d7de; }
    .appendix .f { margin-bottom: ${APPENDIX.findingGap}px; }
    .appendix .row { padding-left: 14px; }
  `;
  const body = plan.pages.map((p) => renderPage(p, plan, meta, sitemapSvg)).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pre-MLR Check Report</title><style>${css}</style></head><body>${body}</body></html>`;
}

function renderPage(p: PlannedPage, plan: ReportPlan, meta: ReportMeta, svg: string): string {
  switch (p.kind) {
    case 'title':
      return titlePage(plan, meta);
    case 'sitemap':
      return `<section class="page"><h2>Site map</h2><div class="sitemap">${inlineSvg(svg)}</div></section>`;
    case 'summary':
      return summaryPage(meta.summary);
    case 'screenshot':
      return screenshotPage(p);
    case 'appendix':
      return appendixPage(p);
  }
}

function titlePage(plan: ReportPlan, meta: ReportMeta): string {
  const host = new URL(meta.startUrl).host;
  const range = (r: Range | null) =>
    r ? (r.from === r.to ? `page ${r.from}` : `pages ${r.from}–${r.to}`) : 'none';
  const shown = plan.notCaptured.slice(0, NOT_CAPTURED_LIMIT);
  const more = plan.notCaptured.length - shown.length;
  const notCaptured = plan.notCaptured.length
    ? `<ul class="plain">${shown
        .map(
          (p) =>
            `<li>#${p.number} ${esc(p.url)} <span class="muted">(${esc(failureReason(p))})</span></li>`,
        )
        .join('')}${more > 0 ? `<li class="muted">…and ${more} more</li>` : ''}</ul>`
    : '<p class="muted">All crawled pages were captured.</p>';

  return `<section class="page">
    <h1>Pre-MLR Check Report</h1>
    <div class="muted" style="font-size:15px">${esc(host)}</div>
    <div class="disclaimer">${esc(DISCLAIMER)}</div>
    <div class="cols">
      <div>
        <table class="meta">
          <tr><th>Start URL</th><td>${esc(meta.startUrl)}</td></tr>
          <tr><th>Scan ID</th><td>${esc(meta.scanId)}</td></tr>
          <tr><th>Scan started</th><td>${fmtDate(meta.startedAt)}</td></tr>
          <tr><th>Scan finished</th><td>${fmtDate(meta.finishedAt)}</td></tr>
          <tr><th>Limits</th><td>${meta.maxPages} pages, depth ${meta.maxDepth}</td></tr>
          <tr><th>Pages crawled</th><td>${meta.pagesCrawled}</td></tr>
          <tr><th>Report generated</th><td>${fmtDate(meta.generatedAt)}</td></tr>
        </table>
        <h3>Contents</h3>
        <table class="meta">
          <tr><th>Site map</th><td>page ${plan.sections.sitemap}</td></tr>
          <tr><th>Findings summary</th><td>page ${plan.sections.summary}</td></tr>
          <tr><th>Desktop screenshots (1440px)</th><td>${range(plan.sections.desktop)}</td></tr>
          <tr><th>Mobile screenshots (390px)</th><td>${range(plan.sections.mobile)}</td></tr>
          <tr><th>Findings list</th><td>${range(plan.sections.appendix)}</td></tr>
        </table>
        <p class="muted">Page numbers (#) match the numbers on the site map. Findings are labelled
        page.number (e.g. 3.2), and the number appears beside the finding and on the desktop screenshot.
        Rejected findings are not included.</p>
      </div>
      <div>
        <h3>Pages not captured (${plan.notCaptured.length})</h3>
        ${notCaptured}
      </div>
    </div>
  </section>`;
}

function screenshotPage(p: Extract<PlannedPage, { kind: 'screenshot' }>): string {
  const name = p.page.title?.trim() || new URL(p.page.url).pathname;
  const cont = p.parts > 1 ? ` · part ${p.part} of ${p.parts}` : '';
  const cols = p.columns
    .map((slice, col) => {
      const width = Math.round(p.image.width * p.scale);
      const height = Math.round(slice.height * p.scale);
      const markers = p.view === 'desktop' ? markersFor(p.page.findings, slice, p.scale) : '';
      return `<div class="shot-col" style="width:${width}px;height:${height}px"><img src="${imageUrl(p.pdfPage, col)}" width="${width}" height="${height}" alt="${esc(`${p.view} screenshot of ${p.page.url}`)}">${markers}</div>`;
    })
    .join('');
  return `<section class="page">
    <div class="heading">
      <div class="title">
        <div class="name">#${p.page.number} · ${esc(name)}</div>
        <div class="url">${esc(p.page.url)}</div>
      </div>
      <div class="where"><div class="view">${p.view}</div>${p.index} of ${p.total}${cont}</div>
    </div>
    <div class="body">
      <div class="shot">${cols}</div>
      ${panel(p.panel, p.page, p.page.findings.length)}
    </div>
  </section>`;
}

/**
 * Numbered boxes for findings whose evidence starts inside this slice of the desktop screenshot.
 * Findings pointing at the same box share one marker ("1,3"); numbers sit left of the box so they
 * never cover the line above.
 */
function markersFor(
  findings: ReportFinding[],
  slice: { top: number; height: number },
  scale: number,
): string {
  const boxes = new Map<
    string,
    { box: NonNullable<ReportFinding['location']>; numbers: string[] }
  >();
  for (const f of findings) {
    const box = f.location;
    if (!box || box.y < slice.top || box.y >= slice.top + slice.height) continue;
    const key = `${box.x},${box.y},${box.width},${box.height}`;
    const entry = boxes.get(key) ?? { box, numbers: [] };
    entry.numbers.push(localNumber(f));
    boxes.set(key, entry);
  }
  return [...boxes.values()]
    .map(({ box, numbers }) => {
      const top = (box.y - slice.top) * scale;
      const height = Math.min(box.height, slice.top + slice.height - box.y) * scale;
      return `<div class="marker" style="left:${(box.x * scale).toFixed(1)}px;top:${top.toFixed(1)}px;width:${Math.max(6, box.width * scale).toFixed(1)}px;height:${Math.max(6, height).toFixed(1)}px"><span>${numbers.join(',')}</span></div>`;
    })
    .join('');
}

const localNumber = (f: ReportFinding) => f.label.split('.').pop()!;

function panel(content: PanelContent, page: ReportPageInput, total: number): string {
  const heading = content.continued ? 'Findings (continued)' : `Findings on this page (${total})`;
  const parts = [`<h3>${heading}</h3>`];
  if (content.showTip && page.tip) {
    parts.push(
      `<div class="tip"><b>Page tip <span class="ai">AI</span></b>${esc(clip(page.tip, PANEL.clip.tip))}</div>`,
    );
  }
  const past = content.showPrecedents ? (page.precedents ?? []).slice(0, PANEL.precedents) : [];
  if (past.length) {
    parts.push(
      `<div class="prec"><b>Past MLR feedback (advisory; not a rule)</b>${past
        .map((p) => `<div>${esc(precedentLine(p))}</div>`)
        .join('')}</div>`,
    );
  }
  for (const f of content.findings) parts.push(panelFinding(f));
  if (!total && !content.showTip && !past.length)
    parts.push('<div class="muted">No open or decided findings on this page.</div>');
  if (content.moreCount) {
    const where = content.moreRef
      ? `see Findings list, page ${content.moreRef}`
      : 'see the Findings list';
    parts.push(
      `<div class="more">+${content.moreCount} more finding${content.moreCount === 1 ? '' : 's'} for this page; ${where}.</div>`,
    );
  }
  return `<aside class="panel">${parts.join('')}</aside>`;
}

function severityTag(sev: Severity): string {
  const c = SEVERITY_COLOR[sev];
  return `<span class="sev" style="color:${c};border-color:${c}">${sev.toUpperCase()}</span>`;
}

const aiTag = (f: ReportFinding) =>
  f.detectedBy === 'llm'
    ? ` <span class="ai">AI${f.confidence === null ? '' : ` ${Math.round(f.confidence * 100)}%`}</span>`
    : '';

function decision(f: ReportFinding): string {
  if (f.status === 'open') return '<span class="decision open">Open – pending review</span>';
  const who = AUTOMATED.has(f.updatedBy) ? '' : ` by ${esc(f.updatedBy)}`;
  return `<span class="decision">${STATUS_LABEL[f.status]}${who}, ${f.updatedAt.slice(0, 10)}</span>`;
}

function panelFinding(f: ReportFinding): string {
  const fix = f.editedFix ?? f.suggestedFix;
  const rows = [
    `<div class="head"><span class="num">${localNumber(f)}</span>${severityTag(f.severity)}<span class="title">${esc(f.ruleTitle)}</span>${aiTag(f)}</div>`,
    `<div>${decision(f)}</div>`,
  ];
  if (f.evidence) rows.push(`<div>“${esc(clip(f.evidence, PANEL.clip.evidence))}”</div>`);
  if (fix)
    rows.push(
      `<div><span class="label">${f.editedFix ? "Author's fix" : 'Fix'}:</span> ${esc(clip(fix, PANEL.clip.fix))}</div>`,
    );
  if (f.comment)
    rows.push(
      `<div><span class="label">Comment:</span> ${esc(clip(f.comment, PANEL.clip.comment))}</div>`,
    );
  return `<div class="f">${rows.join('')}</div>`;
}

function summaryPage(summary: ReportSummary): string {
  const all = summary.findings.map((x) => x.finding);
  const statuses = ['open', 'accepted', 'edited'] as const;
  const count = (pred: (f: ReportFinding) => boolean) => all.filter(pred).length;
  const decided = count((f) => f.status !== 'open');
  const reviewers = [
    ...new Set(
      all.filter((f) => f.status !== 'open' && !AUTOMATED.has(f.updatedBy)).map((f) => f.updatedBy),
    ),
  ];

  const sevRows = SEVERITIES.map(
    (sev) =>
      `<tr><td>${severityTag(sev)}</td>${statuses.map((st) => `<td>${count((f) => f.severity === sev && f.status === st)}</td>`).join('')}<td><b>${count((f) => f.severity === sev)}</b></td></tr>`,
  ).join('');
  const catRows = RULE_CATEGORIES.filter((c) => all.some((f) => f.category === c))
    .map(
      (c) =>
        `<tr><td>${CATEGORY_LABEL[c]}</td><td>${count((f) => f.category === c && f.status === 'open')}</td><td>${count((f) => f.category === c)}</td></tr>`,
    )
    .join('');

  const byPage = new Map<
    string,
    { label: string; number: number; open: number; critical: number }
  >();
  for (const { finding, page } of summary.findings) {
    if (!page || finding.status !== 'open') continue;
    const e = byPage.get(page.label) ?? {
      label: page.label,
      number: page.number,
      open: 0,
      critical: 0,
    };
    e.open++;
    if (finding.severity === 'critical') e.critical++;
    byPage.set(page.label, e);
  }
  const topPages = [...byPage.values()]
    .sort((a, b) => b.open - a.open || b.critical - a.critical || a.number - b.number)
    .slice(0, 8);

  return `<section class="page">
    <h2>Findings summary</h2>
    <p>${all.length} finding${all.length === 1 ? '' : 's'} included: ${count((f) => f.status === 'open')} open, ${count((f) => f.status === 'accepted')} accepted, ${count((f) => f.status === 'edited')} edited.
    <span class="muted">${summary.rejected} rejected finding${summary.rejected === 1 ? '' : 's'} not shown.</span></p>
    <div class="cols">
      <div>
        <h3>By severity and status</h3>
        <table class="grid"><thead><tr><th>Severity</th><th>Open</th><th>Accepted</th><th>Edited</th><th>Total</th></tr></thead><tbody>${sevRows}</tbody></table>
        <h3>By category</h3>
        ${catRows ? `<table class="grid"><thead><tr><th>Category</th><th>Open</th><th>Total</th></tr></thead><tbody>${catRows}</tbody></table>` : '<p class="muted">No findings.</p>'}
      </div>
      <div>
        <h3>Source</h3>
        <table class="grid"><tbody>
          <tr><td>Rules engine</td><td>${count((f) => f.detectedBy === 'rules_engine')}</td></tr>
          <tr><td>AI analysis <span class="ai">AI</span></td><td>${count((f) => f.detectedBy === 'llm')}</td></tr>
        </tbody></table>
        <h3>Author review</h3>
        <p>${decided} of ${all.length} decided (${all.length ? Math.round((decided / all.length) * 100) : 0}%).${reviewers.length ? ` Reviewers: ${reviewers.map(esc).join(', ')}.` : ''}</p>
        <h3>Pages with the most open findings</h3>
        ${topPages.length ? `<table class="grid"><thead><tr><th>Page</th><th>Open</th><th>Critical</th></tr></thead><tbody>${topPages.map((p) => `<tr><td>${esc(clip(p.label, 60))}</td><td>${p.open}</td><td>${p.critical}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No open findings.</p>'}
      </div>
    </div>
    <div class="disclaimer">${esc(DISCLAIMER)} Findings are suggestions for the author; AI findings in particular must be checked against the page.</div>
  </section>`;
}

function appendixPage(p: Extract<PlannedPage, { kind: 'appendix' }>): string {
  const body = p.items
    .map((item) => {
      if (item.kind === 'group')
        return `<h3 class="group">${esc(item.label)}${item.continued ? ' (continued)' : ''}</h3>`;
      const f = item.finding;
      const field = (label: string, text: string | null) =>
        text
          ? `<div class="row"><span class="label">${label}:</span> ${esc(clip(text, APPENDIX.clip))}</div>`
          : '';
      return `<div class="f">
        <div class="head"><b>${esc(f.label)}</b> ${severityTag(f.severity)}<b>${esc(f.ruleTitle)}</b>${aiTag(f)} <span class="muted">${esc(CATEGORY_LABEL[f.category])}</span></div>
        <div class="row">${decision(f)}</div>
        ${field('Finding', f.message)}${field('Evidence', f.evidence)}${field('Suggested fix', f.suggestedFix)}${field("Author's fix", f.editedFix)}${field('Comment', f.comment)}${field('Source', f.citation)}
      </div>`;
    })
    .join('');
  const cont = p.parts > 1 ? ` <span class="muted">(${p.part} of ${p.parts})</span>` : '';
  return `<section class="page appendix"><h2>Findings list${cont}</h2>${body}</section>`;
}

/** Strips the XML prolog/doctype and fixed size so the SVG scales to its container. */
function inlineSvg(svg: string): string {
  const start = svg.indexOf('<svg');
  return svg
    .slice(start)
    .replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1')
    .replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1');
}

function failureReason(p: { httpStatus: number | null; error: string | null }): string {
  if (p.httpStatus && p.httpStatus >= 400) return `HTTP ${p.httpStatus}`;
  return p.error ?? 'screenshot missing';
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Playwright footer template (rendered in the bottom margin of every page). */
export function footerTemplate(generatedAt: string): string {
  return `<div style="width:100%; font-family: Helvetica, Arial, sans-serif; font-size:8px; color:#57606a; padding:0 40px 14px; display:flex; justify-content:space-between; gap:16px;">
    <span>${esc(DISCLAIMER)}</span>
    <span style="white-space:nowrap">Generated ${fmtDate(generatedAt)} · Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;
}
