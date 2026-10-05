import { describe, expect, it } from 'vitest';
import {
  PANEL,
  clip,
  distributePanels,
  layoutFor,
  panelFindingHeight,
  panelPrecedentsHeight,
  planReport,
  precedentLine,
  sliceImage,
  wrapLines,
  type PlannedPage,
  type ReportPageInput,
} from '../src/report/plan.js';
import { rf } from './helpers/report-findings.js';

const layout = layoutFor('Letter');
const img = (width: number, height: number) => ({
  path: `/tmp/${width}x${height}.png`,
  width,
  height,
});

function page(
  number: number,
  desktopH: number | null,
  mobileH: number | null,
  extra: Partial<ReportPageInput> = {},
): ReportPageInput {
  return {
    id: `p${number}`,
    number,
    url: `https://example.com/${number}`,
    title: `Page ${number}`,
    httpStatus: 200,
    error: null,
    desktop: desktopH === null ? null : img(1440, desktopH),
    mobile: mobileH === null ? null : img(390, mobileH),
    findings: [],
    tip: null,
    ...extra,
  };
}

const describePage = (p: PlannedPage) =>
  p.kind === 'screenshot'
    ? `${p.view}#${p.page.number}${p.parts > 1 ? `.${p.part}/${p.parts}` : ''}`
    : p.kind === 'appendix'
      ? `appendix${p.part}`
      : p.kind;

/** Enough findings with long text to overflow one panel. */
const many = (count: number, pageNo = 1) =>
  Array.from({ length: count }, (_, i) =>
    rf({
      id: `m${pageNo}-${i}`,
      label: `${pageNo}.${i + 1}`,
      evidence: 'Evidence text that is fairly long. '.repeat(6),
      suggestedFix: 'A suggested fix that is also fairly long. '.repeat(6),
      comment: 'An author comment. '.repeat(8),
    }),
  );

describe('layoutFor', () => {
  it.each(['Letter', 'A4'] as const)(
    '%s landscape leaves room for screenshot and side panel',
    (size) => {
      const l = layoutFor(size);
      expect(l.page.width).toBeGreaterThan(l.page.height);
      expect(l.shot.width + l.gap + l.panelWidth).toBe(l.content.width);
      expect(l.shot.height).toBeGreaterThan(500);
    },
  );
});

describe('sliceImage', () => {
  const sliceHeight = Math.floor(layout.shot.height / (layout.shot.width / 1440));

  it('fits a viewport-sized desktop screenshot on one page at full width', () => {
    const { scale, pdfPages } = sliceImage({ width: 1440, height: 900 }, 1, layout);
    expect(scale).toBeCloseTo(layout.shot.width / 1440);
    expect(pdfPages).toEqual([[{ top: 0, height: 900 }]]);
  });

  it('shrinks a slightly-too-tall screenshot onto one page instead of adding a near-empty page', () => {
    const height = Math.floor(sliceHeight * 1.2);
    const { scale, pdfPages } = sliceImage({ width: 1440, height }, 1, layout);
    expect(pdfPages).toHaveLength(1);
    expect(height * scale).toBeLessThanOrEqual(layout.shot.height + 0.001);
  });

  it('splits a tall screenshot into contiguous slices covering the whole image', () => {
    const { pdfPages } = sliceImage({ width: 1440, height: 5000 }, 1, layout);
    const slices = pdfPages.flat();
    expect(pdfPages.length).toBe(Math.ceil(5000 / sliceHeight));
    slices.slice(1).forEach((s, i) => expect(s.top).toBe(slices[i]!.top + slices[i]!.height));
    expect(slices.at(-1)!.top + slices.at(-1)!.height).toBe(5000);
  });

  it('lays mobile slices out two per page and never enlarges the image', () => {
    const { scale, pdfPages } = sliceImage({ width: 390, height: 4000 }, 2, layout);
    expect(scale).toBeLessThanOrEqual(1);
    expect(pdfPages.slice(0, -1).every((cols) => cols.length === 2)).toBe(true);
    expect(390 * scale * 2 + layout.gap).toBeLessThanOrEqual(layout.shot.width + 0.001);
  });
});

describe('text estimates', () => {
  it('wraps words greedily and breaks overlong words', () => {
    expect(wrapLines('', 10)).toBe(0);
    expect(wrapLines('one two three', 10)).toBe(2);
    expect(wrapLines('x'.repeat(25), 10)).toBe(3);
  });

  it('clips with an ellipsis', () => {
    expect(clip('short', 10)).toBe('short');
    expect(clip('a much longer sentence', 10)).toBe('a much lo…');
    expect(clip(null, 10)).toBe('');
  });

  it('a finding with more text needs more panel height', () => {
    expect(panelFindingHeight(rf({ comment: 'x '.repeat(50) }))).toBeGreaterThan(
      panelFindingHeight(rf()),
    );
  });
});

describe('distributePanels', () => {
  it('puts the tip and all findings on the first part when they fit', () => {
    const p = page(1, 900, 844, { findings: [rf(), rf()], tip: 'Fix the claim.' });
    expect(distributePanels(p, 1, layout)).toEqual([
      {
        showTip: true,
        showPrecedents: false,
        findings: p.findings,
        continued: false,
        moreCount: 0,
        moreRef: null,
      },
    ]);
  });

  it('shows up to two past comments on the first part, and they take panel space', () => {
    const past = (n: number) => ({
      text: `Past comment ${n} about the same issue. `.repeat(3),
      brand: 'Fictorex',
      reviewerFunction: 'legal',
      commentedAt: '2025-03-04',
      outcome: 'resolved',
    });
    const findings = many(12);
    const without = distributePanels(page(1, 900, 844, { findings }), 2, layout);
    const withPast = distributePanels(
      page(1, 900, 844, { findings, precedents: [past(1), past(2), past(3)] }),
      2,
      layout,
    );
    expect(withPast.map((x) => x.showPrecedents)).toEqual([true, false]);
    expect(without.map((x) => x.showPrecedents)).toEqual([false, false]);
    const shown = (ps: typeof without) => ps.flatMap((x) => x.findings).length;
    expect(shown(withPast)).toBeLessThanOrEqual(shown(without));
    expect(panelPrecedentsHeight([past(1), past(2)])).toBeGreaterThan(
      panelPrecedentsHeight([past(1)]),
    );
    expect(panelPrecedentsHeight([])).toBe(0);
    // The printed line clips the text and names function, brand, month and outcome.
    const line = precedentLine({ ...past(1), text: 'y'.repeat(500) });
    expect(line).toMatch(/^“y+…” \(Legal, Fictorex, 2025-03, resolved\)$/);
    expect(line.length).toBeLessThan(PANEL.clip.precedent + 40);
  });

  it('continues findings onto later parts, then refers the rest to the appendix', () => {
    const findings = many(12);
    const panels = distributePanels(page(1, 900, 844, { findings }), 2, layout);
    expect(panels[0]!.findings.length).toBeGreaterThan(0);
    expect(panels[1]!.continued).toBe(true);
    const shown = panels.flatMap((x) => x.findings);
    expect(shown).toEqual(findings.slice(0, shown.length)); // order kept, nothing duplicated
    expect(panels[1]!.moreCount).toBe(findings.length - shown.length);
    expect(panels[1]!.moreCount).toBeGreaterThan(0);
    // Each panel's estimated height stays within the panel.
    const capacity = layout.shot.height - PANEL.padding - PANEL.header;
    for (const x of panels) {
      const used =
        x.findings.reduce((s, f) => s + panelFindingHeight(f), 0) +
        (x.moreCount ? PANEL.overflowNote : 0);
      expect(used).toBeLessThanOrEqual(capacity);
    }
  });
});

describe('planReport', () => {
  it('orders title, site map, summary, all desktop, all mobile, then the findings list', () => {
    const plan = planReport('Letter', [
      page(2, 900, 844, { findings: [rf()] }),
      page(1, 900, 844),
      page(3, 900, 844),
    ]);
    expect(plan.pages.map(describePage)).toEqual([
      'title',
      'sitemap',
      'summary',
      'desktop#1',
      'desktop#2',
      'desktop#3',
      'mobile#1',
      'mobile#2',
      'mobile#3',
      'appendix1',
    ]);
    expect(plan.pages.map((p) => p.pdfPage)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(plan.sections).toEqual({
      title: 1,
      sitemap: 2,
      summary: 3,
      desktop: { from: 4, to: 6 },
      mobile: { from: 7, to: 9 },
      appendix: { from: 10, to: 10 },
    });
  });

  it('adds continuation pages for tall screenshots', () => {
    const plan = planReport('Letter', [page(1, 5000, 844), page(2, 900, 844)]);
    const desktop = plan.pages.filter((p) => p.kind === 'screenshot' && p.view === 'desktop');
    expect(desktop.map(describePage)).toEqual([
      'desktop#1.1/4',
      'desktop#1.2/4',
      'desktop#1.3/4',
      'desktop#1.4/4',
      'desktop#2',
    ]);
    expect(plan.sections.appendix).toBeNull(); // no findings, no list
  });

  it('points overflow notes at the appendix page listing that page', () => {
    const plan = planReport(
      'Letter',
      [page(1, 900, 844, { findings: many(4, 1) }), page(2, 900, 844, { findings: many(14, 2) })],
      [rf({ label: 'S.1' })],
    );
    const appendix = plan.pages.filter((p) => p.kind === 'appendix');
    expect(appendix.length).toBeGreaterThan(1);
    const groupPage = (label: string) =>
      appendix.find((p) =>
        p.items.some((i) => i.kind === 'group' && i.label.startsWith(label) && !i.continued),
      )!.pdfPage;
    const shot2 = plan.pages.find(
      (p) => p.kind === 'screenshot' && p.view === 'desktop' && p.page.number === 2,
    )!;
    expect(shot2.kind === 'screenshot' && shot2.panel.moreCount).toBeGreaterThan(0);
    expect(shot2.kind === 'screenshot' && shot2.panel.moreRef).toBe(groupPage('#2'));
    // Site-wide findings come first; every finding is listed exactly once.
    const items = appendix.flatMap((p) => p.items);
    expect(items[0]).toEqual({ kind: 'group', label: 'Site-wide', continued: false });
    expect(items.filter((i) => i.kind === 'finding')).toHaveLength(1 + 4 + 14);
    expect(appendix.slice(1).every((p) => p.items[0]!.kind === 'group')).toBe(true); // each page starts with a (continued) header
  });

  it('lists pages without screenshots as not captured and skips them', () => {
    const plan = planReport('Letter', [
      page(1, 900, 844),
      page(2, null, null, { httpStatus: 404, error: 'HTTP 404' }),
      page(3, 900, null),
    ]);
    expect(plan.notCaptured.map((p) => p.number)).toEqual([2]);
    expect(plan.pages.map(describePage)).toEqual([
      'title',
      'sitemap',
      'summary',
      'desktop#1',
      'desktop#3',
      'mobile#1',
    ]);
  });
});
