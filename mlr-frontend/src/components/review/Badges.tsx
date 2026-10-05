import type { FindingStatus, Severity } from '@pre-mlr/shared';
import { SEVERITY_LABEL, STATUS_LABEL } from '../../review/model';

// Text labels always accompany colour, so meaning never depends on colour alone.
export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge sev-${severity}`}>{SEVERITY_LABEL[severity]}</span>;
}

export function StatusBadge({ status }: { status: FindingStatus }) {
  return <span className={`badge status-${status}`}>{STATUS_LABEL[status]}</span>;
}

/** Marks findings from the LLM layer, with its confidence; rules-engine findings show nothing. */
export function SourceTag({
  detectedBy,
  confidence,
}: {
  detectedBy: 'rules_engine' | 'llm';
  confidence: number | null;
}) {
  if (detectedBy !== 'llm') return null;
  const pct = confidence === null ? '' : ` ${Math.round(confidence * 100)}%`;
  return (
    <span className="tag ai" title="Suggested by the LLM layer; advisory, check against the page">
      AI{pct}
    </span>
  );
}
