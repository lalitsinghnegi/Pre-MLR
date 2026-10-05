import type { ReportFinding } from '../../src/report/plan.js';

let n = 0;
/** A report finding with readable defaults. */
export function rf(o: Partial<ReportFinding> = {}): ReportFinding {
  n++;
  return {
    id: `rf${n}`,
    label: `1.${n}`,
    ruleId: 'superlatives',
    ruleTitle: 'No unsupported absolute or superlative language',
    citation: '21 CFR 202.1(e)(6)(i)',
    category: 'claims',
    severity: 'major',
    status: 'open',
    detectedBy: 'rules_engine',
    confidence: null,
    message: 'Absolute or superlative language: "best".',
    evidence: 'Examplin is the best inhaler.',
    suggestedFix: 'Rephrase without this language.',
    editedFix: null,
    comment: null,
    updatedBy: 'rules_engine',
    updatedAt: '2026-10-03T10:00:00.000Z',
    location: null,
    ...o,
  };
}
