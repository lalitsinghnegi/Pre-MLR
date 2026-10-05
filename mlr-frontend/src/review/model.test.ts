import { describe, expect, it } from 'vitest';
import { finding } from '../test/api';
import { EMPTY_FILTERS, applyFilters, buildRows, displayFix, pageLabel } from './model';

describe('pageLabel', () => {
  it('shows page number and path, or Site-wide', () => {
    expect(pageLabel(finding({ pageNumber: 3 }))).toBe('#3 /page-3');
    expect(pageLabel(finding({ pageNumber: 1 }))).toBe('#1 /');
    expect(pageLabel(finding({ pageNumber: null }))).toBe('Site-wide');
  });
});

describe('displayFix', () => {
  it("prefers the author's edit", () => {
    expect(displayFix({ suggestedFix: 'a', editedFix: null })).toBe('a');
    expect(displayFix({ suggestedFix: 'a', editedFix: 'b' })).toBe('b');
  });
});

describe('applyFilters', () => {
  const list = [
    finding({ id: 'a', severity: 'critical', status: 'open', pageNumber: 1 }),
    finding({
      id: 'b',
      severity: 'minor',
      status: 'accepted',
      pageNumber: 2,
      rule: { ...finding().rule, category: 'accessibility', title: 'Images have alt text' },
    }),
    finding({
      id: 'c',
      severity: 'major',
      status: 'open',
      pageNumber: null,
      evidenceText: null,
      message: 'No privacy link',
    }),
  ];
  const ids = (f: Partial<typeof EMPTY_FILTERS>) =>
    applyFilters(list, { ...EMPTY_FILTERS, ...f }).map((x) => x.id);

  it('filters by severity, status, category and page', () => {
    expect(ids({})).toEqual(['a', 'b', 'c']);
    expect(ids({ severities: ['critical', 'major'] })).toEqual(['a', 'c']);
    expect(ids({ statuses: ['accepted'] })).toEqual(['b']);
    expect(ids({ category: 'accessibility' })).toEqual(['b']);
    expect(ids({ page: 'site' })).toEqual(['c']);
    expect(ids({ page: 'p2' })).toEqual(['b']);
  });

  it('searches message, evidence, rule, page and fix text', () => {
    expect(ids({ search: 'PRIVACY' })).toEqual(['c']);
    expect(ids({ search: 'alt text' })).toEqual(['b']);
    expect(ids({ search: '#2' })).toEqual(['b']);
    expect(ids({ search: 'nothing matches' })).toEqual([]);
  });
});

describe('buildRows', () => {
  const list = [
    finding({ id: 'x', pageNumber: 2, severity: 'minor' }),
    finding({ id: 'y', pageNumber: 2, severity: 'critical', status: 'accepted' }),
    finding({ id: 'z', pageNumber: null }),
    finding({ id: 'w', pageNumber: 1 }),
  ];
  const shape = (rows: ReturnType<typeof buildRows>) =>
    rows.map((r) => (r.kind === 'group' ? `[${r.label} ${r.count}/${r.open}]` : r.finding.id));

  it('returns plain rows when not grouped', () => {
    expect(shape(buildRows(list, false, new Set()))).toEqual(['x', 'y', 'z', 'w']);
  });

  it('groups by page (site-wide first), severity within a page, with counts', () => {
    expect(shape(buildRows(list, true, new Set()))).toEqual([
      '[Site-wide 1/1]',
      'z',
      '[#1 / · Page 1 1/1]',
      'w',
      '[#2 /page-2 · Page 2 2/1]',
      'y',
      'x',
    ]);
  });

  it('collapses groups', () => {
    expect(shape(buildRows(list, true, new Set(['p2'])))).toEqual([
      '[Site-wide 1/1]',
      'z',
      '[#1 / · Page 1 1/1]',
      'w',
      '[#2 /page-2 · Page 2 2/1]',
    ]);
  });
});
