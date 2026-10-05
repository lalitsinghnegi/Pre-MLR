import { RULE_CATEGORIES } from '@pre-mlr/shared';
import { useRules } from '../api/queries';
import { CATEGORY_LABEL } from '../review/model';
import { CHECK_TYPE_LABEL, type RuleChoices } from '../rules/model';

/** Collapsible list of current rules with a checkbox each, starting from their defaults. */
export function RulesForScan({
  choices,
  onChange,
}: {
  choices: RuleChoices;
  onChange: (c: RuleChoices) => void;
}) {
  const rules = useRules();
  const active = (rules.data ?? []).filter((r) => !r.retiredAt);
  const isOn = (id: string, def: boolean) => choices[id] ?? def;
  const onCount = active.filter((r) => isOn(r.ruleId, r.latest.enabledByDefault)).length;

  return (
    <details className="rules-for-scan">
      <summary>
        Rules for this scan{' '}
        <span className="muted">
          ({rules.isPending ? 'loading…' : `${onCount} of ${active.length} on`})
        </span>
      </summary>
      {rules.isError && (
        <p className="error" role="alert">
          Could not load rules: {rules.error.message}
        </p>
      )}
      <p className="muted small">
        Changes apply to this scan only. The scan records the rule versions it ran with.
      </p>
      {RULE_CATEGORIES.map((cat) => {
        const inCat = active.filter((r) => r.latest.category === cat);
        if (!inCat.length) return null;
        return (
          <fieldset key={cat}>
            <legend>{CATEGORY_LABEL[cat]}</legend>
            {inCat.map((r) => (
              <label key={r.ruleId} className="checkbox">
                <input
                  type="checkbox"
                  checked={isOn(r.ruleId, r.latest.enabledByDefault)}
                  onChange={(e) => onChange({ ...choices, [r.ruleId]: e.target.checked })}
                />
                {r.latest.title}{' '}
                <span className="muted small">
                  v{r.latest.version} · {CHECK_TYPE_LABEL[r.latest.checkType]}
                  {r.latest.enabledByDefault ? '' : ' · off by default'}
                </span>
              </label>
            ))}
          </fieldset>
        );
      })}
    </details>
  );
}
