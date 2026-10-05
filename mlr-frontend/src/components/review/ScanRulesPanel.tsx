import { Link } from 'react-router';
import { useScanRules } from '../../api/queries';
import { CATEGORY_LABEL } from '../../review/model';
import { CHECK_TYPE_LABEL } from '../../rules/model';

/** The rule versions this scan was frozen with, and whether each was on. */
export function ScanRulesPanel({ scanId }: { scanId: string }) {
  const { data, error } = useScanRules(scanId);
  const on = data?.filter((r) => r.enabled).length ?? 0;
  return (
    <details className="card scan-rules">
      <summary>
        Rules used <span className="muted">({data ? `${on} of ${data.length} on` : '…'})</span>
      </summary>
      {error && (
        <p className="error" role="alert">
          Could not load the scan's rules: {error.message}
        </p>
      )}
      <p className="muted small">
        The versions this scan ran with. Later rule edits don't change them.
      </p>
      {data && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">Version</th>
                <th scope="col">Category</th>
                <th scope="col">Check</th>
                <th scope="col">On</th>
                <th scope="col" className="num">
                  Findings
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.ruleId} className={r.enabled ? undefined : 'muted'}>
                  <td>
                    <Link to={`/rules/${r.ruleId}?version=${r.version}`}>{r.title}</Link>
                  </td>
                  <td>v{r.version}</td>
                  <td>{CATEGORY_LABEL[r.category]}</td>
                  <td>{CHECK_TYPE_LABEL[r.checkType]}</td>
                  <td>{r.enabled ? 'Yes' : 'No'}</td>
                  <td className="num">{r.findings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
