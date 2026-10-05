import { useState } from 'react';
import type { PrecedentBucket, PrecedentTrends, TrendGroup } from '@pre-mlr/shared';
import { BUCKET_LABEL, bucketsOf } from '../../precedents/model';

const W = 320;
const H = 72;
const GAP = 2;

/**
 * One small bar chart per category on a shared y-scale, so heights compare across panels. A single
 * series per panel needs no categorical palette; a table view carries every value.
 */
export function CategoryMultiples({ trends }: { trends: PrecedentTrends }) {
  const [asTable, setAsTable] = useState(false);
  const buckets = bucketsOf(trends);
  const periods = trends.overTime;
  const max = Math.max(1, ...periods.flatMap((p) => buckets.map((b) => p.counts[b])));
  const per = trends.interval === 'month' ? 'month' : 'quarter';

  return (
    <section className="card" aria-labelledby="over-time-h">
      <div className="section-head">
        <h2 id="over-time-h">Comments by category over time</h2>
        <button type="button" className="btn small" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Show charts' : 'Show table'}
        </button>
      </div>
      {asTable ? (
        <div className="table-scroll">
          <table className="data-table">
            <caption className="sr-only">Comments per {per} by category</caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                {buckets.map((b) => (
                  <th scope="col" key={b} className="num">
                    {BUCKET_LABEL[b]}
                  </th>
                ))}
                <th scope="col" className="num">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.period}>
                  <th scope="row">{p.period}</th>
                  {buckets.map((b) => (
                    <td key={b} className="num">
                      {p.counts[b] || <span className="muted">–</span>}
                    </td>
                  ))}
                  <td className="num">{p.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <p className="muted small">
            Comments per {per}, one panel per category, all on the same scale (tallest bar = {max}).
            Hover a bar for its count.
          </p>
          <div className="multiples">
            {buckets.map((b) => {
              const total = periods.reduce((s, p) => s + p.counts[b], 0);
              const slot = W / periods.length;
              return (
                <figure key={b} className={`multiple bucket-${b}`}>
                  <figcaption>
                    <span>{BUCKET_LABEL[b]}</span>
                    <span className="multiple-total">{total}</span>
                  </figcaption>
                  <svg
                    viewBox={`0 0 ${W} ${H}`}
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={`${BUCKET_LABEL[b]}: ${total} comments from ${periods[0]?.period} to ${periods.at(-1)?.period}`}
                  >
                    <line className="baseline" x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} />
                    {periods.map((p, i) => {
                      const n = p.counts[b];
                      const h = (n / max) * (H - 4);
                      return (
                        <g key={p.period} className="bar-slot">
                          <title>{`${p.period}: ${n} comment${n === 1 ? '' : 's'}`}</title>
                          {/* Full-height hit area, so thin bars are easy to hover. */}
                          <rect className="hit" x={i * slot} y={0} width={slot} height={H} />
                          {n > 0 && (
                            <rect
                              className="bar"
                              x={i * slot + GAP / 2}
                              y={H - h}
                              width={Math.max(1, slot - GAP)}
                              height={h}
                              rx={Math.min(2, (slot - GAP) / 2)}
                            />
                          )}
                        </g>
                      );
                    })}
                  </svg>
                  <div className="multiple-axis muted">
                    <span>{periods[0]?.period}</span>
                    <span>{periods.at(-1)?.period}</span>
                  </div>
                </figure>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/** Light → dark steps of one blue ramp; the last two need light text. */
const HEAT = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#1c5cab'];

/**
 * Rows (brand or reviewer function) by category, with each count printed and its cell shaded by
 * size relative to the largest cell in the table.
 */
export function HeatTable({
  title,
  rowHeader,
  groups,
  buckets,
  formatKey = (k) => k,
}: {
  title: string;
  rowHeader: string;
  groups: TrendGroup[];
  buckets: PrecedentBucket[];
  formatKey?: (key: string) => string;
}) {
  const max = Math.max(1, ...groups.flatMap((g) => buckets.map((b) => g.counts[b])));
  const id = `heat-${rowHeader.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section className="card" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <div className="table-scroll">
        <table className="data-table heat">
          <thead>
            <tr>
              <th scope="col">{rowHeader}</th>
              {buckets.map((b) => (
                <th scope="col" key={b} className="num">
                  {BUCKET_LABEL[b]}
                </th>
              ))}
              <th scope="col" className="num">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key}>
                <th scope="row">{formatKey(g.key)}</th>
                {buckets.map((b) => {
                  const n = g.counts[b];
                  const step = n
                    ? Math.min(HEAT.length - 1, Math.floor((n / max) * HEAT.length))
                    : -1;
                  return (
                    <td
                      key={b}
                      className={`num${step >= 3 ? ' on-dark' : ''}`}
                      style={step >= 0 ? { background: HEAT[step] } : undefined}
                    >
                      {n || <span className="muted">–</span>}
                    </td>
                  );
                })}
                <td className="num">{g.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
