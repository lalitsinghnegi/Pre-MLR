import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { DetectedBySchema, ProductProfileSchema } from '@pre-mlr/shared';
export const ExpectedFindingsSchema = z
    .object({
    site: z.string(),
    product: ProductProfileSchema.optional(),
    enableRules: z.array(z.string()).default([]),
    cleanPages: z.array(z.string()).default([]),
    expected: z.array(z
        .object({
        page: z.string().startsWith('/'),
        rule: z.string(),
        evidence: z.string().optional(),
        detectedBy: DetectedBySchema,
    })
        .strict()),
})
    .strict();
export async function loadExpectedFindings(path) {
    return ExpectedFindingsSchema.parse(parse(await readFile(path, 'utf8')));
}
/**
 * Matches each expected finding to one unmatched actual finding with the same page and rule (and,
 * if given, evidence containing the expected text, case-insensitively). Entries with evidence are
 * matched first so a vaguer entry can't take their finding.
 */
export function compareFindings(expected, actual) {
    const remaining = [...actual];
    const matched = [];
    const missing = [];
    const ordered = [...expected].sort((a, b) => Number(!a.evidence) - Number(!b.evidence));
    for (const e of ordered) {
        const i = remaining.findIndex((a) => a.page === e.page &&
            a.rule === e.rule &&
            (!e.evidence || (a.evidence ?? '').toLowerCase().includes(e.evidence.toLowerCase())));
        if (i === -1)
            missing.push(e);
        else
            matched.push({ expected: e, actual: remaining.splice(i, 1)[0] });
    }
    return { matched, missing, unexpected: remaining };
}
/** Human-readable summary for test failures and CLI output. */
export function formatComparison(c) {
    const line = (f) => `  ${f.page.padEnd(16)} ${f.rule.padEnd(24)} ${f.evidence ? JSON.stringify(f.evidence) : ''}`;
    return [
        `matched ${c.matched.length}, missing ${c.missing.length}, unexpected ${c.unexpected.length}`,
        ...(c.missing.length ? ['MISSING (expected, not found):', ...c.missing.map(line)] : []),
        ...(c.unexpected.length
            ? ['UNEXPECTED (found, not expected):', ...c.unexpected.map(line)]
            : []),
    ].join('\n');
}
/** URL path used to key findings: "/" for the root, no trailing slash, no ".html". */
export function pagePath(url) {
    const p = new URL(url).pathname.replace(/\.html?$/, '').replace(/\/+$/, '');
    return p || '/';
}
//# sourceMappingURL=compare.js.map