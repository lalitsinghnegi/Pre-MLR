import { z } from 'zod';
import { type Severity } from '@pre-mlr/shared';
/**
 * Structured-output schema sent to the model. The SDK's Zod helper sends enums as description hints
 * rather than enforced constraints (and drops numeric bounds), so rule ids, severities and
 * confidence are all re-checked per finding in validateOutput.
 */
export declare function outputSchema(ruleIds: string[]): z.ZodObject<{
    findings: z.ZodArray<z.ZodObject<{
        ruleId: z.ZodEnum<{
            [x: string]: string;
        }>;
        severity: z.ZodEnum<{
            critical: "critical";
            major: "major";
            minor: "minor";
            info: "info";
        }>;
        evidenceQuote: z.ZodString;
        explanation: z.ZodString;
        suggestedRewrite: z.ZodNullable<z.ZodString>;
        confidence: z.ZodNumber;
    }, z.core.$strip>>;
    pageTip: z.ZodString;
}, z.core.$strip>;
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
export declare function normalizeForMatch(s: string): string;
export declare function validateOutput(output: unknown, ctx: {
    ruleIds: string[];
    ruleSeverity: Record<string, Severity>;
    pageText: string;
}): Validation;
