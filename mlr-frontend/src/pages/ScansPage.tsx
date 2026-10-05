import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { SCAN_LIMITS, type ScanSummary } from '@pre-mlr/shared';
import { urls } from '../api/client';
import {
  useCreateScan,
  useDeleteScan,
  useMe,
  useRerunScan,
  useRules,
  useScans,
} from '../api/queries';
import { RulesForScan } from '../components/RulesForScan';
import { overridesOf, type RuleChoices } from '../rules/model';

export function ScansPage() {
  return (
    <>
      <h1>Scans</h1>
      <NewScanForm />
      <ScanList />
    </>
  );
}

function NewScanForm() {
  const navigate = useNavigate();
  const create = useCreateScan();
  const [startUrl, setStartUrl] = useState('');
  const [maxPages, setMaxPages] = useState<number>(SCAN_LIMITS.maxPages.default);
  const [maxDepth, setMaxDepth] = useState<number>(SCAN_LIMITS.maxDepth.default);
  const [brands, setBrands] = useState('');
  const [established, setEstablished] = useState('');
  const [ruleChoices, setRuleChoices] = useState<RuleChoices>({});
  const rules = useRules();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const brandNames = brands
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);
    const overrides = overridesOf(
      ruleChoices,
      new Map((rules.data ?? []).map((r) => [r.ruleId, r.latest.enabledByDefault])),
    );
    const scan = await create
      .mutateAsync({
        startUrl: startUrl.trim(),
        maxPages,
        maxDepth,
        ...(overrides.enable.length || overrides.disable.length ? { rules: overrides } : {}),
        ...(brandNames.length && established.trim()
          ? { product: { brandNames, establishedName: established.trim() } }
          : {}),
      })
      .catch(() => null);
    if (scan) navigate(`/scans/${scan.id}`);
  };

  return (
    <form className="card new-scan" onSubmit={submit} aria-labelledby="new-scan-title">
      <h2 id="new-scan-title">New scan</h2>
      <p className="muted small">
        Use public or fictional sites only (e.g. the Examplin test site: npm run serve:examplin).
      </p>
      <div className="form-row">
        <label className="field grow">
          <span>Start URL</span>
          <input
            type="url"
            required
            placeholder="https://example.com/"
            value={startUrl}
            onChange={(e) => setStartUrl(e.target.value)}
          />
        </label>
        <label className="field narrow">
          <span>Max pages</span>
          <input
            type="number"
            min={1}
            max={SCAN_LIMITS.maxPages.max}
            required
            value={maxPages}
            onChange={(e) => setMaxPages(Number(e.target.value))}
          />
        </label>
        <label className="field narrow">
          <span>Max depth</span>
          <input
            type="number"
            min={0}
            max={SCAN_LIMITS.maxDepth.max}
            required
            value={maxDepth}
            onChange={(e) => setMaxDepth(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="form-row">
        <label className="field grow">
          <span>Brand name(s), comma-separated (optional)</span>
          <input
            value={brands}
            onChange={(e) => setBrands(e.target.value)}
            placeholder="Examplin"
          />
        </label>
        <label className="field grow">
          <span>Established name (optional)</span>
          <input
            value={established}
            onChange={(e) => setEstablished(e.target.value)}
            placeholder="examplitide"
          />
        </label>
      </div>
      <p className="muted small">
        Brand rules (established name, trademark symbol) run only when both names are given.
      </p>
      <RulesForScan choices={ruleChoices} onChange={setRuleChoices} />
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={create.isPending}>
          {create.isPending ? 'Starting…' : 'Start scan'}
        </button>
        {create.isError && (
          <p role="alert" className="error">
            {create.error.message}
          </p>
        )}
      </div>
    </form>
  );
}

function ScanList() {
  const { data, isLoading, error } = useScans();
  if (isLoading) return <p>Loading scans…</p>;
  if (error)
    return (
      <p role="alert" className="error">
        Could not load scans: {error.message}
      </p>
    );
  if (!data?.length) return <p className="muted">No scans yet.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="sr-only">Scans, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Site</th>
            <th scope="col">Status</th>
            <th scope="col">Pages</th>
            <th scope="col">Open findings</th>
            <th scope="col">Critical open</th>
            <th scope="col">Started</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((s) => (
            <ScanRow key={s.id} scan={s} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScanRow({ scan }: { scan: ScanSummary }) {
  const host = new URL(scan.startUrl).host;
  const navigate = useNavigate();
  const me = useMe().data;
  const rerun = useRerunScan();
  const remove = useDeleteScan();
  const [confirming, setConfirming] = useState(false);
  const busy = scan.status === 'queued' || scan.status === 'running';
  // The server decides; this only hides buttons that would be refused.
  const mayDelete =
    !!me && (me.role === 'rule_admin' || (scan.createdBy !== null && scan.createdBy === me.name));
  const error = rerun.error ?? remove.error;
  return (
    <tr>
      <th scope="row">
        <Link to={`/scans/${scan.id}`}>{host}</Link>
        <div className="muted small">{scan.startUrl}</div>
      </th>
      <td>
        <span className={`badge scan-${scan.status}`}>{scan.status}</span>
        {scan.phase && <div className="muted small">{scan.phase}…</div>}
        {scan.status === 'failed' && scan.error && <div className="error small">{scan.error}</div>}
      </td>
      <td>
        {scan.pagesCrawled}
        {scan.status === 'running' ? ` / ${scan.maxPages}` : ''}
      </td>
      <td>
        {scan.findings.byStatus.open} of {scan.findings.total}
      </td>
      <td>{scan.findings.openBySeverity.critical}</td>
      <td className="small">{scan.createdAt.slice(0, 16).replace('T', ' ')} UTC</td>
      <td className="actions">
        <div className="row-actions">
          <Link to={`/scans/${scan.id}`} className="btn small">
            Review
          </Link>
          {scan.status === 'completed' && (
            <a href={urls.report(scan.id)} className="btn small">
              PDF
            </a>
          )}
          {!busy && (
            <button
              type="button"
              className="btn small"
              disabled={rerun.isPending}
              onClick={() =>
                rerun.mutate(scan.id, { onSuccess: (fresh) => navigate(`/scans/${fresh.id}`) })
              }
              aria-label={`Run the ${host} scan again`}
            >
              {rerun.isPending ? 'Starting…' : 'Run again'}
            </button>
          )}
          {mayDelete && scan.status !== 'running' && !confirming && (
            <button
              type="button"
              className="btn small reject"
              onClick={() => setConfirming(true)}
              aria-label={`Delete the ${host} scan`}
            >
              Delete…
            </button>
          )}
          {confirming && (
            <span className="confirm" role="group" aria-label={`Confirm deleting the ${host} scan`}>
              <span className="small">Delete this scan, its findings and screenshots?</span>
              <button
                type="button"
                className="btn small reject"
                disabled={remove.isPending}
                onClick={() => remove.mutate(scan.id, { onSettled: () => setConfirming(false) })}
              >
                Delete
              </button>
              <button type="button" className="btn small" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          )}
          {error && (
            <span role="alert" className="error small">
              {error.message}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
