import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { DetectedBySchema, ProductProfileSchema, type DetectedBy } from '@pre-mlr/shared';

export const ExpectedFindingsSchema = z
  .object({
    site: z.string(),
    product: ProductProfileSchema.optional(),
    enableRules: z.array(z.string()).default([]),
    cleanPages: z.array(z.string()).default([]),
    expected: z.array(
      z
        .object({
          page: z.string().startsWith('/'),
          rule: z.string(),
          evidence: z.string().optional(),
          detectedBy: DetectedBySchema,
        })
        .strict(),
    ),
  })
  .strict();
export type ExpectedFindings = z.infer<typeof ExpectedFindingsSchema>;
export type ExpectedFinding = ExpectedFindings['expected'][number];

export async function loadExpectedFindings(path: string): Promise<ExpectedFindings> {
  return ExpectedFindingsSchema.parse(parse(await readFile(path, 'utf8')));
}

/** A finding reduced to what comparison needs. `page` is a URL path ("/" for site-wide findings). */
export interface ActualFinding {
  page: string;
  rule: string;
  evidence: string | null;
  detectedBy: DetectedBy;
}

export interface Comparison {
  matched: { expected: ExpectedFinding; actual: ActualFinding }[];
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
export function compareFindings(expected: ExpectedFinding[], actual: ActualFinding[]): Comparison {
  const remaining = [...actual];
  const matched: Comparison['matched'] = [];
  const missing: ExpectedFinding[] = [];
  const ordered = [...expected].sort((a, b) => Number(!a.evidence) - Number(!b.evidence));

  for (const e of ordered) {
    const i = remaining.findIndex(
      (a) =>
        a.page === e.page &&
        a.rule === e.rule &&
        (!e.evidence || (a.evidence ?? '').toLowerCase().includes(e.evidence.toLowerCase())),
    );
    if (i === -1) missing.push(e);
    else matched.push({ expected: e, actual: remaining.splice(i, 1)[0]! });
  }
  return { matched, missing, unexpected: remaining };
}

/** Human-readable summary for test failures and CLI output. */
export function formatComparison(c: Comparison): string {
  const line = (f: { page: string; rule: string; evidence?: string | null }) =>
    `  ${f.page.padEnd(16)} ${f.rule.padEnd(24)} ${f.evidence ? JSON.stringify(f.evidence) : ''}`;
  return [
    `matched ${c.matched.length}, missing ${c.missing.length}, unexpected ${c.unexpected.length}`,
    ...(c.missing.length ? ['MISSING (expected, not found):', ...c.missing.map(line)] : []),
    ...(c.unexpected.length
      ? ['UNEXPECTED (found, not expected):', ...c.unexpected.map(line)]
      : []),
  ].join('\n');
}

/** URL path used to key findings: "/" for the root, no trailing slash, no ".html". */
export function pagePath(url: string): string {
  const p = new URL(url).pathname.replace(/\.html?$/, '').replace(/\/+$/, '');
  return p || '/';
}
