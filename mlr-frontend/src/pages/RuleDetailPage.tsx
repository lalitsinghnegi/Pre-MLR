import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { stringify } from 'yaml';
import type { RuleDetail } from '@pre-mlr/shared';
import { urls } from '../api/client';
import { useIsRuleAdmin, useRule, useRuleAudit, useSetRetired } from '../api/queries';
import { SeverityBadge } from '../components/review/Badges';
import { CATEGORY_LABEL } from '../review/model';
import { CHECK_TYPE_LABEL, diffLines, FIELD_LABEL, originLabel } from '../rules/model';

type Version = RuleDetail['versions'][number];

export function RuleDetailPage() {
  const { id = '' } = useParams();
  const rule = useRule(id);
  const isAdmin = useIsRuleAdmin();
  const [params] = useSearchParams();

  if (rule.isPending) return <p className="muted">Loading…</p>;
  if (rule.isError) {
    return (
      <p className="error" role="alert">
        Could not load rule: {rule.error.message}
      </p>
    );
  }
  const d = rule.data;
  const latest = d.versions[0]!;
  // ?version=N (from a finding) shows that version; otherwise the latest.
  const asked = Number(params.get('version'));
  const shown = d.versions.find((v) => v.version === asked) ?? latest;

  return (
    <>
      <p>
        <Link to="/rules">← All rules</Link>
      </p>
      <div className="section-head">
        <div>
          <h1>{shown.title}</h1>
          <p className="muted">
            {d.ruleId} · version {shown.version}
            {shown.version !== latest.version && (
              <>
                {' '}
                (latest is <Link to={`/rules/${d.ruleId}`}>v{latest.version}</Link>)
              </>
            )}
            {d.retiredAt && (
              <span className="badge retired-badge">Retired {d.retiredAt.slice(0, 10)}</span>
            )}
          </p>
        </div>
        {isAdmin && <AdminActions detail={d} />}
      </div>

      <VersionDetails v={shown} />

      <section className="card" aria-labelledby="versions-h">
        <h2 id="versions-h">Versions</h2>
        <ol className="versions" reversed>
          {d.versions.map((v) => (
            <li key={v.version} aria-current={v.version === shown.version ? 'true' : undefined}>
              <div className="version-head">
                <Link to={`/rules/${d.ruleId}?version=${v.version}`}>
                  <strong>v{v.version}</strong>
                </Link>{' '}
                <span className="muted small">
                  {v.createdAt.slice(0, 16).replace('T', ' ')} UTC · {v.createdBy} ·{' '}
                  {originLabel(v)} · {v.scans} scan{v.scans === 1 ? '' : 's'}, {v.findings} finding
                  {v.findings === 1 ? '' : 's'}
                </span>{' '}
                <a className="small" href={urls.ruleYaml(d.ruleId, v.version)} download>
                  Download YAML
                </a>
              </div>
              {v.changes.length > 0 && (
                <ul className="changes">
                  {v.changes.map((c) => (
                    <li key={c.field}>
                      <strong>{FIELD_LABEL[c.field] ?? c.field}:</strong>{' '}
                      <Change from={c.from} to={c.to} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="card" aria-labelledby="usage-h">
        <h2 id="usage-h">Scans that used this rule</h2>
        {d.usage.length === 0 ? (
          <p className="muted">No scans yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Scan</th>
                  <th scope="col">Started</th>
                  <th scope="col">Version</th>
                  <th scope="col">On in this scan</th>
                  <th scope="col" className="num">
                    Findings
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.usage.map((u) => (
                  <tr key={u.scanId}>
                    <td>
                      <Link to={`/scans/${u.scanId}`}>{hostOf(u.startUrl)}</Link>
                    </td>
                    <td>{u.createdAt.slice(0, 16).replace('T', ' ')}</td>
                    <td>v{u.version}</td>
                    <td>{u.enabled ? 'Yes' : 'No'}</td>
                    <td className="num">{u.findings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <History id={d.ruleId} />
    </>
  );
}

function VersionDetails({ v }: { v: Version }) {
  return (
    <section className="card" aria-label="Rule details">
      <div className="preview-badges">
        <SeverityBadge severity={v.severity} /> <span>{CATEGORY_LABEL[v.category]}</span> ·{' '}
        <span>{CHECK_TYPE_LABEL[v.checkType]}</span> ·{' '}
        <span>{v.enabledByDefault ? 'On by default' : 'Off by default'}</span>
      </div>
      <dl className="details">
        <dt>Description</dt>
        <dd>{v.description}</dd>
        <dt>Source</dt>
        <dd>
          {v.sourceUrl ? (
            <a href={v.sourceUrl} target="_blank" rel="noreferrer">
              {v.sourceCitation}
            </a>
          ) : (
            v.sourceCitation
          )}
          {v.lastVerified && <span className="muted"> · last verified {v.lastVerified}</span>}
          {v.sourceNote && <span className="source-note">{v.sourceNote}</span>}
        </dd>
        {v.promptTemplate && (
          <>
            <dt>Prompt template</dt>
            <dd>
              <pre>{v.promptTemplate}</pre>
            </dd>
          </>
        )}
        <dt>Settings</dt>
        <dd>
          <pre>{Object.keys(v.params).length ? stringify(v.params) : '(none)'}</pre>
        </dd>
      </dl>
    </section>
  );
}

function Change({ from, to }: { from: unknown; to: unknown }) {
  const show = (x: unknown) =>
    x === null || x === undefined
      ? '(empty)'
      : typeof x === 'object'
        ? stringify(x).trim()
        : String(x);
  const multiline = [from, to].some((x) => typeof x === 'object' && x !== null);
  if (!multiline) {
    return (
      <>
        <del>{show(from)}</del> → <ins>{show(to)}</ins>
      </>
    );
  }
  const SIGN = { same: ' ', removed: '-', added: '+', gap: ' ' } as const;
  return (
    <pre className="diff" aria-label="Changes">
      {diffLines(show(from), show(to)).map((l, i) => (
        <span key={i} className={`diff-${l.kind}`}>
          {l.kind === 'removed' && <span className="sr-only">Removed: </span>}
          {l.kind === 'added' && <span className="sr-only">Added: </span>}
          {SIGN[l.kind]} {l.text}
        </span>
      ))}
    </pre>
  );
}

function AdminActions({ detail: d }: { detail: RuleDetail }) {
  const retire = useSetRetired(d.ruleId);
  const [confirming, setConfirming] = useState(false);
  const retired = !!d.retiredAt;
  return (
    <div className="admin-actions">
      <Link to={`/rules/${d.ruleId}/edit`} className="btn">
        Edit
      </Link>
      {confirming ? (
        <span role="group" aria-label="Confirm retire">
          <span className="small">New scans will leave this rule out. Old scans keep it. </span>
          <button
            type="button"
            className="btn reject"
            onClick={() => retire.mutate(true, { onSettled: () => setConfirming(false) })}
          >
            Retire rule
          </button>{' '}
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </span>
      ) : retired ? (
        <button type="button" className="btn" onClick={() => retire.mutate(false)}>
          Restore
        </button>
      ) : (
        <button type="button" className="btn" onClick={() => setConfirming(true)}>
          Retire…
        </button>
      )}
      {retire.isError && (
        <p className="error small" role="alert">
          {retire.error.message}
        </p>
      )}
    </div>
  );
}

function History({ id }: { id: string }) {
  const { data } = useRuleAudit(id);
  return (
    <section className="card history" aria-labelledby="rule-history-h">
      <h2 id="rule-history-h">History</h2>
      <ol>
        {data?.map((a) => (
          <li key={a.id}>
            <span className="muted">{a.at.slice(0, 16).replace('T', ' ')} UTC</span> ·{' '}
            <strong>{a.actor}</strong>{' '}
            {a.action === 'version_created'
              ? `created version ${String(a.changes.version?.[1])}`
              : a.action}
          </li>
        ))}
      </ol>
    </section>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
