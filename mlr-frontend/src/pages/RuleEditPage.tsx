import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { parse, stringify } from 'yaml';
import {
  RULE_CATEGORIES,
  SEVERITIES,
  type CheckType,
  type RuleCategory,
  type RuleFields,
  type Severity,
} from '@pre-mlr/shared';
import { ApiError } from '../api/client';
import { useAddRuleVersion, useCreateRule, useIsRuleAdmin, useRule } from '../api/queries';
import { CATEGORY_LABEL, SEVERITY_LABEL } from '../review/model';
import { CHECK_TYPE_LABEL } from '../rules/model';

/** Form state: everything as the inputs hold it (params as YAML text, empty strings for nulls). */
interface Draft {
  ruleId: string;
  title: string;
  description: string;
  category: RuleCategory;
  severity: Severity;
  checkType: CheckType;
  enabledByDefault: boolean;
  sourceCitation: string;
  sourceUrl: string;
  sourceNote: string;
  lastVerified: string;
  promptTemplate: string;
  paramsYaml: string;
}

const EMPTY: Draft = {
  ruleId: '',
  title: '',
  description: '',
  category: 'claims',
  severity: 'major',
  checkType: 'deterministic',
  enabledByDefault: true,
  sourceCitation: '',
  sourceUrl: '',
  sourceNote: '',
  lastVerified: '',
  promptTemplate: '',
  paramsYaml: 'check: phrase-list\nlabel: \nphrases:\n  - \n',
};

const draftOf = (ruleId: string, v: RuleFields): Draft => ({
  ruleId,
  title: v.title,
  description: v.description,
  category: v.category,
  severity: v.severity,
  checkType: v.checkType,
  enabledByDefault: v.enabledByDefault,
  sourceCitation: v.sourceCitation,
  sourceUrl: v.sourceUrl ?? '',
  sourceNote: v.sourceNote ?? '',
  lastVerified: v.lastVerified ?? '',
  promptTemplate: v.promptTemplate ?? '',
  paramsYaml: Object.keys(v.params).length ? stringify(v.params) : '',
});

/** Draft → API fields, or an error message for settings that aren't a YAML mapping. */
function fieldsOf(d: Draft): RuleFields | string {
  let params: unknown;
  try {
    params = d.paramsYaml.trim() ? parse(d.paramsYaml) : {};
  } catch (err) {
    return `Settings are not valid YAML: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return 'Settings must be a YAML mapping (key: value lines).';
  }
  const orNull = (s: string) => s.trim() || null;
  return {
    title: d.title.trim(),
    description: d.description.trim(),
    category: d.category,
    severity: d.severity,
    checkType: d.checkType,
    enabledByDefault: d.enabledByDefault,
    sourceCitation: d.sourceCitation.trim(),
    sourceUrl: orNull(d.sourceUrl),
    sourceNote: orNull(d.sourceNote),
    lastVerified: orNull(d.lastVerified),
    promptTemplate: orNull(d.promptTemplate),
    params: params as Record<string, unknown>,
  };
}

export function RuleEditPage() {
  const { id } = useParams();
  const isAdmin = useIsRuleAdmin();
  if (!isAdmin) {
    return (
      <p role="alert">
        Only rule admins can create or edit rules. <Link to="/rules">Back to rules</Link>
      </p>
    );
  }
  return id ? <EditExisting id={id} /> : <RuleForm mode="create" initial={EMPTY} />;
}

function EditExisting({ id }: { id: string }) {
  const rule = useRule(id);
  if (rule.isPending) return <p className="muted">Loading…</p>;
  if (rule.isError) {
    return (
      <p className="error" role="alert">
        Could not load rule: {rule.error.message}
      </p>
    );
  }
  const latest = rule.data.versions[0]!;
  // Keyed by version: if someone else saves, reloading starts a fresh draft from their version.
  return (
    <RuleForm
      key={latest.version}
      mode="edit"
      initial={draftOf(id, latest)}
      baseVersion={latest.version}
    />
  );
}

function RuleForm({
  mode,
  initial,
  baseVersion,
}: {
  mode: 'create' | 'edit';
  initial: Draft;
  baseVersion?: number;
}) {
  const [d, setD] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const create = useCreateRule();
  const addVersion = useAddRuleVersion(initial.ruleId);
  const navigate = useNavigate();
  const mutation = mode === 'create' ? create : addVersion;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const conflict = mutation.error instanceof ApiError && mutation.error.status === 409;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fields = fieldsOf(d);
    if (typeof fields === 'string') return setProblem(fields);
    setProblem(null);
    const done = { onSuccess: () => navigate(`/rules/${d.ruleId}`) };
    if (mode === 'create') create.mutate({ ...fields, ruleId: d.ruleId.trim() }, done);
    else addVersion.mutate({ ...fields, expectedLatestVersion: baseVersion! }, done);
  };

  return (
    <form className="card rule-form" onSubmit={submit} aria-labelledby="rule-form-h">
      <h1 id="rule-form-h">
        {mode === 'create'
          ? 'New rule'
          : `Edit ${initial.title} (saves version ${baseVersion! + 1})`}
      </h1>
      {mode === 'edit' && (
        <p className="muted small">
          Saving creates a new version. Scans that already ran keep version {baseVersion}.
        </p>
      )}
      {mode === 'create' && (
        <Field id="rf-id" label="Rule id" hint="lower-case-with-dashes; can't be changed later">
          <input
            id="rf-id"
            value={d.ruleId}
            onChange={(e) => set('ruleId', e.target.value)}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={80}
          />
        </Field>
      )}
      <Field id="rf-title" label="Title">
        <input
          id="rf-title"
          value={d.title}
          onChange={(e) => set('title', e.target.value)}
          required
          maxLength={200}
        />
      </Field>
      <Field id="rf-desc" label="Description">
        <textarea
          id="rf-desc"
          rows={3}
          value={d.description}
          onChange={(e) => set('description', e.target.value)}
          required
          maxLength={5000}
        />
      </Field>
      <div className="form-row">
        <Field id="rf-cat" label="Category">
          <select
            id="rf-cat"
            value={d.category}
            onChange={(e) => set('category', e.target.value as RuleCategory)}
          >
            {RULE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="rf-sev" label="Severity">
          <select
            id="rf-sev"
            value={d.severity}
            onChange={(e) => set('severity', e.target.value as Severity)}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="rf-type" label="Check">
          <select
            id="rf-type"
            value={d.checkType}
            onChange={(e) => set('checkType', e.target.value as CheckType)}
          >
            {(['deterministic', 'llm'] as const).map((t) => (
              <option key={t} value={t}>
                {CHECK_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={d.enabledByDefault}
            onChange={(e) => set('enabledByDefault', e.target.checked)}
          />
          On by default in new scans
        </label>
      </div>
      <div className="form-row">
        <Field id="rf-cite" label="Source citation" className="grow">
          <input
            id="rf-cite"
            value={d.sourceCitation}
            onChange={(e) => set('sourceCitation', e.target.value)}
            required
            maxLength={500}
          />
        </Field>
        <Field id="rf-url" label="Source URL" className="grow">
          <input
            id="rf-url"
            type="url"
            value={d.sourceUrl}
            onChange={(e) => set('sourceUrl', e.target.value)}
          />
        </Field>
        <Field id="rf-verified" label="Last verified">
          <input
            id="rf-verified"
            type="date"
            value={d.lastVerified}
            onChange={(e) => set('lastVerified', e.target.value)}
          />
        </Field>
      </div>
      <Field id="rf-note" label="Source note" hint="optional; caveats or TODOs about the source">
        <input
          id="rf-note"
          value={d.sourceNote}
          onChange={(e) => set('sourceNote', e.target.value)}
          maxLength={2000}
        />
      </Field>
      {d.checkType === 'llm' && (
        <Field id="rf-prompt" label="Prompt template" hint="what the AI should check for this rule">
          <textarea
            id="rf-prompt"
            rows={4}
            value={d.promptTemplate}
            onChange={(e) => set('promptTemplate', e.target.value)}
            required
            maxLength={5000}
          />
        </Field>
      )}
      <Field
        id="rf-params"
        label="Settings (YAML)"
        hint={
          d.checkType === 'deterministic'
            ? 'check: the check type to run (e.g. phrase-list), plus its settings'
            : 'optional, e.g. excludePaths'
        }
      >
        <textarea
          id="rf-params"
          className="mono"
          rows={8}
          value={d.paramsYaml}
          onChange={(e) => set('paramsYaml', e.target.value)}
          spellCheck={false}
        />
      </Field>
      {(problem || mutation.isError) && (
        <div className="error" role="alert">
          <pre className="error-text">{problem ?? mutation.error?.message}</pre>
          {conflict && (
            <p>
              Someone else saved this rule while you were editing.{' '}
              <Link to={`/rules/${initial.ruleId}`}>Open the latest version</Link> and edit again.
            </p>
          )}
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={mutation.isPending}>
          {mode === 'create' ? 'Create rule' : 'Save new version'}
        </button>
        <Link to={mode === 'create' ? '/rules' : `/rules/${initial.ruleId}`}>Cancel</Link>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`field${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <span className="muted small hint">{hint}</span>}
    </div>
  );
}
