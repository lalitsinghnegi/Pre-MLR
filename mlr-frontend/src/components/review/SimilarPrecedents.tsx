import type { FindingView } from '@pre-mlr/shared';
import { titleCase } from '../../precedents/model';
import { PromoteButton } from '../precedents/PromoteButton';

/** Historic MLR comments similar to a finding: advisory context, ranked below the rule itself. */
export function SimilarPrecedents({ finding }: { finding: FindingView }) {
  return (
    <section className="precedents" aria-labelledby={`prec-${finding.id}`}>
      <h3 id={`prec-${finding.id}`}>Similar past MLR comments</h3>
      <p className="small muted">
        Advisory: historic reviewer feedback on other materials, matched by similarity. It carries
        less authority than the rule above and is not a decision.
      </p>
      {finding.precedents.length === 0 ? (
        <p className="small muted">No similar past comments found.</p>
      ) : (
        <ol>
          {finding.precedents.map((p) => (
            <li key={p.id}>
              <q>{p.text}</q>
              <div className="small muted">
                {[
                  p.reviewerFunction && titleCase(p.reviewerFunction),
                  p.brand,
                  p.site,
                  p.commentedAt,
                  p.outcome && `outcome: ${p.outcome}`,
                  `${Math.round(p.similarity * 100)}% similar`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              <PromoteButton precedentIds={[p.id]} suggestedTitle={p.text} findingId={finding.id} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
