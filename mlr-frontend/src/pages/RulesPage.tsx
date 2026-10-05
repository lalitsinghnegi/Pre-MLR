import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { RULE_CATEGORIES, type RuleSummary } from '@pre-mlr/shared';
import { useIsRuleAdmin, useRules } from '../api/queries';
import { SeverityBadge } from '../components/review/Badges';
import { CATEGORY_LABEL } from '../review/model';
import { CHECK_TYPE_LABEL, originLabel } from '../rules/model';

export function RulesPage() {
  const rules = useRules();
  const isAdmin = useIsRuleAdmin();
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [showRetired, setShowRetired] = useState(false);

  const shown = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (rules.data ?? [])
      .filter((r) => showRetired || !r.retiredAt)
      .filter((r) => !category || r.latest.category === category)
      .filter((r) => !q || r.ruleId.includes(q) || r.latest.title.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          RULE_CATEGORIES.indexOf(a.latest.category) - RULE_CATEGORIES.indexOf(b.latest.category) ||
          a.latest.title.localeCompare(b.latest.title),
      );
  }, [rules.data, text, category, showRetired]);

  return (
    <>
      <div className="section-head">
        <h1>Rules</h1>
        {isAdmin && (
          <Link to="/rules/new" className="btn primary">
            New rule
          </Link>
        )}
      </div>
      <p className="muted">
        The rules scans check against. Every change is saved as a new version; scans keep the
        versions they ran with.
      </p>
      <div className="filter-row" role="group" aria-label="Filters">
        <div className="field">
          <label htmlFor="r-text">Search</label>
          <input
            id="r-text"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Title or id"
          />
        </div>
        <div className="field">
          <label htmlFor="r-cat">Category</label>
          <select id="r-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {RULE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showRetired}
            onChange={(e) => setShowRetired(e.target.checked)}
          />
          Show retired rules
        </label>
      </div>
      {rules.isPending ? (
        <p className="muted">Loading…</p>
      ) : rules.isError ? (
        <p className="error" role="alert">
          Could not load rules: {rules.error.message}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">
              {shown.length} rule{shown.length === 1 ? '' : 's'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">Category</th>
                <th scope="col">Severity</th>
                <th scope="col">Check</th>
                <th scope="col">On by default</th>
                <th scope="col">Version</th>
                <th scope="col" className="num">
                  Scans
                </th>
                <th scope="col" className="num">
                  Findings
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <RuleRow key={r.ruleId} rule={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function RuleRow({ rule: r }: { rule: RuleSummary }) {
  return (
    <tr className={r.retiredAt ? 'retired' : undefined}>
      <td>
        <Link to={`/rules/${r.ruleId}`}>{r.latest.title}</Link>
        <div className="muted small">
          {r.ruleId}
          {r.retiredAt && <span className="badge retired-badge">Retired</span>}
        </div>
      </td>
      <td>{CATEGORY_LABEL[r.latest.category]}</td>
      <td>
        <SeverityBadge severity={r.latest.severity} />
      </td>
      <td>{CHECK_TYPE_LABEL[r.latest.checkType]}</td>
      <td>{r.latest.enabledByDefault ? 'Yes' : 'No'}</td>
      <td>
        v{r.latest.version}
        <div className="muted small">{originLabel(r.latest)}</div>
      </td>
      <td className="num">{r.scans}</td>
      <td className="num">{r.findings}</td>
    </tr>
  );
}
