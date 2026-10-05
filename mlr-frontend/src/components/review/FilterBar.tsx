import { useId } from 'react';
import type { FindingStatus, FindingView, Severity } from '@pre-mlr/shared';
import {
  CATEGORY_LABEL,
  EMPTY_FILTERS,
  FINDING_STATUSES,
  RULE_CATEGORIES,
  SEVERITIES,
  SEVERITY_LABEL,
  STATUS_LABEL,
  pageLabel,
  type Filters,
} from '../../review/model';

interface Props {
  findings: FindingView[];
  filters: Filters;
  onChange: (f: Filters) => void;
  grouped: boolean;
  onGroupedChange: (g: boolean) => void;
  shown: number;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FilterBar({ findings, filters, onChange, grouped, onGroupedChange, shown }: Props) {
  const pages = [...new Map(findings.map((f) => [f.page?.id ?? 'site', f])).entries()].sort(
    ([, a], [, b]) => (a.page?.number ?? 0) - (b.page?.number ?? 0),
  );
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  // Selects are labelled with htmlFor rather than a wrapping <label>, which would fold the
  // option text into their accessible name.
  const categoryId = useId();
  const pageId = useId();

  return (
    <section className="filter-bar" aria-label="Filter findings">
      <label className="field">
        <span>Search</span>
        <input
          type="search"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Text, rule, page…"
        />
      </label>

      <fieldset className="chips">
        <legend>Severity</legend>
        {SEVERITIES.map((s: Severity) => (
          <label key={s} className="chip">
            <input
              type="checkbox"
              checked={filters.severities.includes(s)}
              onChange={() => set({ severities: toggle(filters.severities, s) })}
            />
            {SEVERITY_LABEL[s]}
          </label>
        ))}
      </fieldset>

      <fieldset className="chips">
        <legend>Status</legend>
        {FINDING_STATUSES.map((s: FindingStatus) => (
          <label key={s} className="chip">
            <input
              type="checkbox"
              checked={filters.statuses.includes(s)}
              onChange={() => set({ statuses: toggle(filters.statuses, s) })}
            />
            {STATUS_LABEL[s]}
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label htmlFor={categoryId}>Category</label>
        <select
          id={categoryId}
          value={filters.category}
          onChange={(e) => set({ category: e.target.value as Filters['category'] })}
        >
          <option value="">All categories</option>
          {RULE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={pageId}>Page</label>
        <select id={pageId} value={filters.page} onChange={(e) => set({ page: e.target.value })}>
          <option value="">All pages</option>
          {pages.map(([key, f]) => (
            <option key={key} value={key}>
              {pageLabel(f)}
            </option>
          ))}
        </select>
      </div>

      <label className="chip toggle">
        <input
          type="checkbox"
          checked={grouped}
          onChange={(e) => onGroupedChange(e.target.checked)}
        />
        Group by page
      </label>

      <div className="filter-summary">
        <span aria-live="polite">
          Showing {shown} of {findings.length} findings
        </span>
        {JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS) && (
          <button type="button" className="link-button" onClick={() => onChange(EMPTY_FILTERS)}>
            Clear filters
          </button>
        )}
      </div>
    </section>
  );
}
