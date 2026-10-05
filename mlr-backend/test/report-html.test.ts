import { describe, expect, it } from 'vitest';
import { DISCLAIMER } from '@pre-mlr/shared';
import { footerTemplate, renderReportHtml, type ReportMeta } from '../src/report/html.js';
import { planReport, type ReportFinding, type ReportPageInput } from '../src/report/plan.js';
import { rf } from './helpers/report-findings.js';

const accepted = rf({
  id: 'a',
  label: '1.1',
  status: 'accepted',
  updatedBy: 'Pat Reviewer',
  updatedAt: '2026-10-02T09:00:00Z',
  location: { x: 100, y: 200, width: 400, height: 30 },
});
const edited = rf({
  id: 'e',
  label: '1.2',
  ruleTitle: 'Images have alt text',
  category: 'accessibility',
  severity: 'minor',
  status: 'edited',
  editedFix: 'Add alt="Breathing easily"',
  comment: '<b>Agreed</b>',
  updatedBy: 'Pat Reviewer',
  location: { x: 100, y: 200, width: 400, height: 30 }, // same box as 1.1
});
const ai = rf({
  id: 'i',
  label: '1.3',
  ruleTitle: 'No implied off-label use',
  severity: 'critical',
  detectedBy: 'llm',
  confidence: 0.85,
  evidence: '<script>x</script> seasonal allergies',
  location: { x: 50, y: 5000, width: 300, height: 20 },
});
const siteWide = rf({
  id: 's',
  label: 'S.1',
  ruleTitle: 'Privacy policy link is present',
  category: 'legal_privacy',
  severity: 'minor',
  evidence: null,
});

const pages: ReportPageInput[] = [
  {
    id: 'a',
    number: 1,
    url: 'https://example.com/?q=<script>',
    title: '<img src=x onerror=alert(1)> & "Home"',
    httpStatus: 200,
    error: null,
    desktop: { path: '/x.png', width: 1440, height: 900 },
    mobile: { path: '/y.png', width: 390, height: 844 },
    findings: [accepted, edited, ai],
    tip: 'Rebalance the hero & ISI.',
  },
  {
    id: 'b',
    number: 2,
    url: 'https://example.com/gone',
    title: null,
    httpStatus: 404,
    error: 'HTTP 404',
    desktop: null,
    mobile: null,
    findings: [],
    tip: null,
  },
];

const summary: ReportMeta['summary'] = {
  rejected: 2,
  findings: [
    { finding: siteWide, page: null },
    ...[accepted, edited, ai].map((finding: ReportFinding) => ({
      finding,
      page: { number: 1, label: '#1 / · Home' },
    })),
  ],
};
const meta: ReportMeta = {
  scanId: 'scan-1',
  startUrl: 'https://example.com/',
  maxPages: 25,
  maxDepth: 3,
  pagesCrawled: 2,
  startedAt: '2026-10-03T10:00:00.000Z',
  finishedAt: '2026-10-03T10:05:00.000Z',
  generatedAt: '2026-10-03T11:00:00.000Z',
  summary,
};
const svg =
  '<?xml version="1.0"?>\n<!DOCTYPE svg>\n<svg width="300pt" height="200pt" viewBox="0 0 300 200"><g/></svg>';
const html = renderReportHtml(planReport('Letter', pages, [siteWide]), meta, svg);
const sections = html.split('<section class="page').slice(1);

describe('renderReportHtml', () => {
  it('renders one section per planned page: title, site map, summary, desktop, mobile, findings list', () => {
    expect(sections).toHaveLength(6);
    expect(sections[2]).toContain('Findings summary');
    expect(sections[5]).toContain('Findings list');
  });

  it('escapes crawled and author text', () => {
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Agreed</b>');
    expect(html).toContain('&lt;b&gt;Agreed&lt;/b&gt;');
  });

  it('lists all sections in the contents on the title page', () => {
    expect(sections[0]).toMatch(/Findings summary<\/th><td>page 3</);
    expect(sections[0]).toMatch(/Desktop screenshots \(1440px\)<\/th><td>page 4</);
    expect(sections[0]).toMatch(/Mobile screenshots \(390px\)<\/th><td>page 5</);
    expect(sections[0]).toMatch(/Findings list<\/th><td>page 6</);
    expect(sections[0]).toContain('Rejected findings are not included');
  });

  it('summarises counts by severity, status, category and source, and counts rejected findings', () => {
    const s = sections[2]!;
    expect(s).toContain('4 findings included: 2 open, 1 accepted, 1 edited.');
    expect(s).toContain('2 rejected findings not shown.');
    expect(s).toMatch(/CRITICAL<\/span><\/td><td>1<\/td><td>0<\/td><td>0<\/td><td><b>1<\/b>/);
    expect(s).toMatch(/MINOR<\/span><\/td><td>1<\/td><td>0<\/td><td>1<\/td><td><b>2<\/b>/);
    expect(s).toMatch(/Accessibility<\/td><td>0<\/td><td>1</);
    expect(s).toMatch(/AI analysis <span class="ai">AI<\/span><\/td><td>1</);
    expect(s).toContain('2 of 4 decided (50%). Reviewers: Pat Reviewer.');
    expect(s).toContain(DISCLAIMER);
  });

  it('fills the desktop side panel with the tip and findings, decisions, edited fixes and severity labels', () => {
    const desktop = sections[3]!;
    expect(desktop).toContain('Findings on this page (3)');
    expect(desktop).toContain(
      'Page tip <span class="ai">AI</span></b>Rebalance the hero &amp; ISI.',
    );
    expect(desktop).toContain('Accepted by Pat Reviewer, 2026-10-02');
    expect(desktop).toContain('Open – pending review');
    expect(desktop).toContain("Author's fix:</span> Add alt=&quot;Breathing easily&quot;");
    expect(desktop).toMatch(/class="sev" style="color:#cf222e;border-color:#cf222e">CRITICAL</);
    expect(desktop).toContain('<span class="ai">AI 85%</span>');
  });

  it('draws numbered markers on the desktop screenshot only, merging findings that share a box', () => {
    const desktop = sections[3]!;
    expect(desktop.match(/class="marker"/g)).toHaveLength(1); // 1.3 is below this 900px slice
    expect(desktop).toMatch(
      /class="marker" style="left:[\d.]+px;top:[\d.]+px;[^"]+"><span>1,2<\/span>/,
    );
    expect(sections[4]).not.toContain('class="marker"'); // mobile
    expect(sections[4]).toContain('Findings on this page (3)'); // same panel on mobile
  });

  it('lists every included finding in full in the appendix, site-wide first', () => {
    const list = sections[5]!;
    expect(list.indexOf('Site-wide')).toBeLessThan(list.indexOf('#1 / · '));
    for (const label of ['S.1', '1.1', '1.2', '1.3']) expect(list).toContain(`<b>${label}</b>`);
    expect(list).toContain('Source:</span> 21 CFR 202.1(e)(6)(i)');
  });
});

describe('footerTemplate', () => {
  it('includes the disclaimer and page numbering', () => {
    const f = footerTemplate(meta.generatedAt);
    expect(f).toContain(DISCLAIMER);
    expect(f).toContain('<span class="pageNumber"></span> of <span class="totalPages"></span>');
  });
});
