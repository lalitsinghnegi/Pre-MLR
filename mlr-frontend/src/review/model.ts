import {
  FINDING_STATUSES,
  RULE_CATEGORIES,
  SEVERITIES,
  type FindingStatus,
  type FindingView,
  type RuleCategory,
  type Severity,
} from '@pre-mlr/shared';

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
  info: 'Info',
};
export const STATUS_LABEL: Record<FindingStatus, string> = {
  open: 'Open',
  accepted: 'Accepted',
  rejected: 'Rejected',
  edited: 'Edited',
};
export const CATEGORY_LABEL: Record<RuleCategory, string> = {
  safety_information: 'Safety information',
  fair_balance: 'Fair balance',
  claims: 'Claims',
  references: 'References',
  branding: 'Branding',
  links: 'Links',
  legal_privacy: 'Legal & privacy',
  accessibility: 'Accessibility',
};
export { FINDING_STATUSES, RULE_CATEGORIES, SEVERITIES };

export const severityRank = (s: Severity) => SEVERITIES.indexOf(s);

/** "#3 /products" for a page finding, "Site-wide" otherwise. */
export function pageLabel(f: Pick<FindingView, 'page'>): string {
  if (!f.page) return 'Site-wide';
  const u = new URL(f.page.url);
  return `#${f.page.number} ${decodeURI(u.pathname)}${u.search}`;
}

/** The fix to show: the author's edit if there is one, else the engine's suggestion. */
export const displayFix = (f: Pick<FindingView, 'editedFix' | 'suggestedFix'>) =>
  f.editedFix ?? f.suggestedFix;

export interface Filters {
  search: string;
  severities: Severity[];
  statuses: FindingStatus[];
  category: RuleCategory | '';
  /** Page id, "site" for site-wide findings, or "" for all. */
  page: string;
}

export const EMPTY_FILTERS: Filters = {
  search: '',
  severities: [],
  statuses: [],
  category: '',
  page: '',
};

export function applyFilters(findings: FindingView[], f: Filters): FindingView[] {
  const q = f.search.trim().toLowerCase();
  return findings.filter(
    (x) =>
      (!f.severities.length || f.severities.includes(x.severity)) &&
      (!f.statuses.length || f.statuses.includes(x.status)) &&
      (!f.category || x.rule.category === f.category) &&
      (!f.page || (f.page === 'site' ? x.page === null : x.page?.id === f.page)) &&
      (!q ||
        [
          x.message,
          x.evidenceText,
          x.rule.title,
          x.ruleId,
          displayFix(x),
          x.authorComment,
          pageLabel(x),
        ].some((s) => s?.toLowerCase().includes(q))),
  );
}

export type GridRow =
  | { kind: 'group'; key: string; label: string; count: number; open: number; collapsed: boolean }
  | { kind: 'finding'; finding: FindingView };

/**
 * Rows for the grid. When grouped, each page gets a header row (in page order, site-wide first)
 * followed by its findings unless collapsed. AG Grid Community has no row grouping, so we do it here.
 */
export function buildRows(
  findings: FindingView[],
  grouped: boolean,
  collapsed: ReadonlySet<string>,
): GridRow[] {
  if (!grouped) return findings.map((finding) => ({ kind: 'finding', finding }));
  const groups = new Map<string, FindingView[]>();
  for (const f of findings) {
    const key = f.page?.id ?? 'site';
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const order = (fs: FindingView[]) => fs[0]!.page?.number ?? 0;
  return [...groups.entries()]
    .sort(([, a], [, b]) => order(a) - order(b))
    .flatMap(([key, fs]) => {
      const sorted = [...fs].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
      const header: GridRow = {
        kind: 'group',
        key,
        label: fs[0]!.page?.title
          ? `${pageLabel(fs[0]!)} · ${fs[0]!.page.title}`
          : pageLabel(fs[0]!),
        count: fs.length,
        open: fs.filter((f) => f.status === 'open').length,
        collapsed: collapsed.has(key),
      };
      return collapsed.has(key)
        ? [header]
        : [header, ...sorted.map((finding) => ({ kind: 'finding' as const, finding }))];
    });
}
