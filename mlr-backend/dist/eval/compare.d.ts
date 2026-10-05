import { z } from 'zod';
import { type DetectedBy } from '@pre-mlr/shared';
export declare const ExpectedFindingsSchema: z.ZodObject<{
    site: z.ZodString;
    product: z.ZodOptional<z.ZodObject<{
        brandNames: z.ZodArray<z.ZodString>;
        establishedName: z.ZodString;
    }, z.core.$strip>>;
    enableRules: z.ZodDefault<z.ZodArray<z.ZodString>>;
    cleanPages: z.ZodDefault<z.ZodArray<z.ZodString>>;
    expected: z.ZodArray<z.ZodObject<{
        page: z.ZodString;
        rule: z.ZodString;
        evidence: z.ZodOptional<z.ZodString>;
        detectedBy: z.ZodEnum<{
            llm: "llm";
            rules_engine: "rules_engine";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type ExpectedFindings = z.infer<typeof ExpectedFindingsSchema>;
export type ExpectedFinding = ExpectedFindings['expected'][number];
export declare function loadExpectedFindings(path: string): Promise<ExpectedFindings>;
/** A finding reduced to what comparison needs. `page` is a URL path ("/" for site-wide findings). */
export interface ActualFinding {
    page: string;
    rule: string;
    evidence: string | null;
    detectedBy: DetectedBy;
}
export interface Comparison {
    matched: {
        expected: ExpectedFinding;
        actual: ActualFinding;
    }[];
    /** Expected but not found (false negatives). */
    missing: ExpectedFinding[];
    /** Found but not expected (false positives). */
    unexpected: ActualFinding[];
}
/**
 * Matches each expected finding to one unmatched actual finding with the same page and rule (and,
 * if given, evidence containing the expected text, case-insensitively). Entries with evidence are
 * matched first so a vaguer entry can't take their finding.
 */
export declare function compareFindings(expected: ExpectedFinding[], actual: ActualFinding[]): Comparison;
/** Human-readable summary for test failures and CLI output. */
export declare function formatComparison(c: Comparison): string;
/** URL path used to key findings: "/" for the root, no trailing slash, no ".html". */
export declare function pagePath(url: string): string;
