import { useSearchParams } from 'react-router';
import { TREND_INTERVALS, type CandidateRules, type PrecedentTrends } from '@pre-mlr/shared';
import { useCandidateRules, usePrecedentTrends, useRuleCandidates } from '../api/queries';
import { CategoryMultiples, HeatTable } from '../components/precedents/charts';
import { PromoteButton } from '../components/precedents/PromoteButton';
import { bucketsOf, titleCase } from '../precedents/model';

const IMPORT_CMD =
  'npm run precedent:import -w mlr-backend -- --file <export.xlsx|csv> --site <host>';
const CLASSIFY_CMD = 'npm run precedent:classify -w mlr-backend';

export function PrecedentsPage() {
  const [params, setParams] = useSearchParams();
  const filter = {
    brand: params.get('brand') ?? undefined,
    reviewerFunction: params.get('function') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
  };
  const interval = params.get('interval') === 'quarter' ? 'quarter' : 'month';
  const trends = usePrecedentTrends({ ...filter, interval });
  const candidates = useCandidateRules(filter);

  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const t = trends.data;
  return (
    <>
      <h1>Precedent trends</h1>
      <p className="notice">
        Historic MLR review comments, classified by an LLM against the rule pack&apos;s categories.
        This is advisory context only: it carries less authority than the rules, and classifications
        can be wrong.
      </p>

      <div className="filter-row" role="group" aria-label="Filters">
        <div className="field">
          <label htmlFor="f-brand">Brand</label>
          <select
            id="f-brand"
            value={filter.brand ?? ''}
            onChange={(e) => set('brand', e.target.value)}
          >
            <option value="">All brands</option>
            {t?.filterOptions.brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-function">Reviewer function</label>
          <select
            id="f-function"
            value={filter.reviewerFunction ?? ''}
            onChange={(e) => set('function', e.target.value)}
          >
            <option value="">All functions</option>
            {t?.filterOptions.reviewerFunctions.map((f) => (
              <option key={f} value={f}>
                {titleCase(f)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-from">From</label>
          <input
            id="f-from"
            type="date"
            value={filter.from ?? ''}
            min={t?.filterOptions.firstDate ?? undefined}
            max={t?.filterOptions.lastDate ?? undefined}
            onChange={(e) => set('from', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="f-to">To</label>
          <input
            id="f-to"
            type="date"
            value={filter.to ?? ''}
            min={t?.filterOptions.firstDate ?? undefined}
            max={t?.filterOptions.lastDate ?? undefined}
            onChange={(e) => set('to', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="f-interval">Group by</label>
          <select
            id="f-interval"
            value={interval}
            onChange={(e) => set('interval', e.target.value)}
          >
            {TREND_INTERVALS.map((i) => (
              <option key={i} value={i}>
                {titleCase(i)}
              </option>
            ))}
          </select>
        </div>
        {[...params.keys()].length > 0 && (
          <button type="button" className="btn" onClick={() => setParams({}, { replace: true })}>
            Clear filters
          </button>
        )}
      </div>

      {trends.isPending ? (
        <p className="muted">Loading…</p>
      ) : trends.isError ? (
        <p className="error" role="alert">
          Could not load trends: {trends.error.message}
        </p>
      ) : (
        <div
          className={trends.isPlaceholderData ? 'stale' : undefined}
          aria-busy={trends.isFetching}
        >
          <Trends trends={t!} candidates={candidates.data} candidatesError={candidates.error} />
        </div>
      )}
    </>
  );
}

function Trends({
  trends: t,
  candidates,
  candidatesError,
}: {
  trends: PrecedentTrends;
  candidates: CandidateRules | undefined;
  candidatesError: Error | null;
}) {
  if (!t.filterOptions.brands.length) {
    return (
      <div className="card">
        <p>No historic comments have been imported yet. Import a proofing-tool export with:</p>
        <pre>{IMPORT_CMD}</pre>
      </div>
    );
  }
  const buckets = bucketsOf(t);
  return (
    <>
      <dl className="stat-tiles">
        <div>
          <dt>Comments</dt>
          <dd>{t.totals.comments}</dd>
        </div>
        <div>
          <dt>Classified</dt>
          <dd>{t.totals.classified}</dd>
        </div>
        <div>
          <dt>No matching rule</dt>
          <dd>{t.totals.noMatchingRule}</dd>
        </div>
        <div>
          <dt>Unclassified</dt>
          <dd>{t.totals.unclassified}</dd>
        </div>
      </dl>
      {t.classifiers.length > 0 && (
        <p className="muted small">Classified by {t.classifiers.join(', ')}.</p>
      )}
      {t.totals.unclassified > 0 && (
        <p className="notice">
          {t.totals.unclassified} comment{t.totals.unclassified === 1 ? ' is' : 's are'} not
          classified yet. Run <code>{CLASSIFY_CMD}</code> to classify them.
        </p>
      )}

      {t.totals.comments === 0 ? (
        <p className="muted">No comments match these filters.</p>
      ) : (
        <>
          <CategoryMultiples trends={t} />
          <HeatTable title="By brand" rowHeader="Brand" groups={t.byBrand} buckets={buckets} />
          <HeatTable
            title="By reviewer function"
            rowHeader="Function"
            groups={t.byReviewerFunction}
            buckets={buckets}
            formatKey={titleCase}
          />
        </>
      )}

      <section className="card" aria-labelledby="candidates-h">
        <h2 id="candidates-h">Candidate new rules</h2>
        <p className="muted small">
          Recurring themes among comments that no current rule covers. Each one is a suggestion for
          the rule owners to review, not a rule.
        </p>
        {candidatesError ? (
          <p className="error" role="alert">
            Could not load candidates: {candidatesError.message}
          </p>
        ) : !candidates ? (
          <p className="muted">Loading…</p>
        ) : candidates.candidates.length === 0 ? (
          <p className="muted">
            No recurring themes ({candidates.noMatchTotal} comment
            {candidates.noMatchTotal === 1 ? '' : 's'} with no matching rule in this range).
          </p>
        ) : (
          <>
            <p className="small">
              {candidates.clustered} of {candidates.noMatchTotal} comments with no matching rule
              fall into {candidates.candidates.length} recurring theme
              {candidates.candidates.length === 1 ? '' : 's'}.
            </p>
            <ol className="candidates">
              {candidates.candidates.map((c) => (
                <li key={c.precedentIds[0]}>
                  <h3>
                    {titleCase(c.label)} <span className="muted">· {c.count} comments</span>
                  </h3>
                  <p className="small muted">
                    {c.proofs} proofs · {c.brands.join(', ')} ·{' '}
                    {c.reviewerFunctions.map(titleCase).join(', ')} · {c.firstSeen} to {c.lastSeen}
                  </p>
                  <p className="small">Key words: {c.terms.join(', ')}</p>
                  <ul className="examples">
                    {c.examples.map((e) => (
                      <li key={e.id}>
                        <q>{e.text}</q>{' '}
                        <span className="muted small">
                          ({e.brand}, {e.commentedAt})
                        </span>
                      </li>
                    ))}
                  </ul>
                  <PromoteButton
                    precedentIds={c.precedentIds}
                    suggestedTitle={titleCase(c.label)}
                  />
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <RuleCandidatesSection />
    </>
  );
}

/** Proposals made so far by rule admins (from the grid or from the themes above). */
function RuleCandidatesSection() {
  const { data, error } = useRuleCandidates();
  return (
    <section className="card" aria-labelledby="rule-candidates-h">
      <h2 id="rule-candidates-h">Rule candidates</h2>
      <p className="muted small">
        Proposals from rule admins, for the rule owners to review. A candidate is not a rule and is
        not checked in scans.
      </p>
      {error ? (
        <p className="error" role="alert">
          Could not load rule candidates: {error.message}
        </p>
      ) : !data ? (
        <p className="muted">Loading…</p>
      ) : data.length === 0 ? (
        <p className="muted">No rule candidates yet.</p>
      ) : (
        <ul className="candidates rule-candidates">
          {data.map((c) => (
            <li key={c.id}>
              <h3>{c.title}</h3>
              <p className="small muted">
                Proposed by {c.createdBy} on {c.createdAt.slice(0, 10)} · {c.precedentIds.length}{' '}
                source comment{c.precedentIds.length === 1 ? '' : 's'}
                {c.findingId ? ' · from a scan finding' : ''}
              </p>
              {c.note && <p className="small">{c.note}</p>}
              <ul className="examples">
                {c.examples.map((e) => (
                  <li key={e.id}>
                    <q>{e.text}</q>{' '}
                    <span className="muted small">
                      ({e.brand}, {e.commentedAt})
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
