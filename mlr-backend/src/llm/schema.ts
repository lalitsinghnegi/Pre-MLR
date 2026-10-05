import { z } from 'zod';
import { SEVERITIES, type Severity } from '@pre-mlr/shared';

/**
 * Structured-output schema sent to the model. The SDK's Zod helper sends enums as description hints
 * rather than enforced constraints (and drops numeric bounds), so rule ids, severities and
 * confidence are all re-checked per finding in validateOutput.
 */
export function outputSchema(ruleIds: string[]) {
  const ids = ruleIds.length ? (ruleIds as [string, ...string[]]) : (['none'] as [string]);
  return z.object({
    findings: z.array(
      z.object({
        ruleId: z.enum(ids),
        severity: z.enum(SEVERITIES),
        evidenceQuote: z.string(),
        explanation: z.string(),
        suggestedRewrite: z.string().nullable(),
        confidence: z.number(),
      }),
    ),
    pageTip: z.string(),
  });
}

export interface ValidFinding {
  ruleId: string;
  severity: Severity;
  evidenceQuote: string;
  explanation: string;
  suggestedRewrite: string | null;
  confidence: number;
}

export interface Validation {
  findings: ValidFinding[];
  pageTip: string | null;
  /** Problems to report back to the model on the retry. Empty means fully valid. */
  problems: string[];
  /** True if the overall shape was unusable (nothing could be kept). */
  unusable: boolean;
}

/** Normalises text for verbatim-quote checks: case, whitespace, typographic quotes and dashes. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks the model output against the schema and the request: known rule ids, quotes that really
 * appear on the page, severity no higher than the rule's, confidence within 0..1.
 */
/** Shape check only; rule id and severity values are validated per finding so one bad finding can't sink the rest. */
const LooseOutput = z.object({
  findings: z.array(
    z.object({
      ruleId: z.string(),
      severity: z.string(),
      evidenceQuote: z.string(),
      explanation: z.string(),
      suggestedRewrite: z.string().nullable(),
      confidence: z.number(),
    }),
  ),
  pageTip: z.string(),
});

export function validateOutput(
  output: unknown,
  ctx: { ruleIds: string[]; ruleSeverity: Record<string, Severity>; pageText: string },
): Validation {
  const parsed = LooseOutput.safeParse(output);
  if (!parsed.success) {
    return {
      findings: [],
      pageTip: null,
      problems: [
        `The response did not match the required JSON schema: ${z.prettifyError(parsed.error)}`,
      ],
      unusable: true,
    };
  }
  const page = normalizeForMatch(ctx.pageText);
  const problems: string[] = [];
  const findings: ValidFinding[] = [];
  parsed.data.findings.forEach((f, i) => {
    const where = `findings[${i}] (${f.ruleId})`;
    const quote = normalizeForMatch(f.evidenceQuote);
    if (!ctx.ruleIds.includes(f.ruleId)) {
      problems.push(
        `${where}: rule id is not one of the provided rules (${ctx.ruleIds.join(', ')}).`,
      );
      return;
    }
    if (!(SEVERITIES as readonly string[]).includes(f.severity)) {
      problems.push(`${where}: severity must be one of ${SEVERITIES.join(', ')}.`);
      return;
    }
    if (quote.length < 3 || !page.includes(quote)) {
      problems.push(
        `${where}: evidenceQuote "${f.evidenceQuote.slice(0, 120)}" does not appear verbatim in the page text.`,
      );
      return;
    }
    if (!(f.confidence >= 0 && f.confidence <= 1)) {
      problems.push(`${where}: confidence must be between 0 and 1.`);
      return;
    }
    const max = ctx.ruleSeverity[f.ruleId]!;
    const given = f.severity as Severity;
    const severity = SEVERITIES.indexOf(given) < SEVERITIES.indexOf(max) ? max : given;
    findings.push({ ...f, severity, suggestedRewrite: f.suggestedRewrite?.trim() || null });
  });
  const pageTip = parsed.data.pageTip.trim() || null;
  if (!pageTip) problems.push('pageTip must not be empty.');
  return { findings, pageTip, problems, unusable: false };
}
