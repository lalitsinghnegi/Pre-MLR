import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { precedentClassifications, precedents } from '../db/schema.js';

/**
 * Answer key: source comment id → intended category, "off_rule:<topic>" for comments no rule
 * covers. Other values (e.g. "invalid", "duplicate" for rows the importer rejects) are ignored.
 */
export type ClassificationLabels = Record<string, string>;

export interface ClassificationScore {
  /** Labelled comments found in the database with a classification. */
  scored: number;
  correct: number;
  accuracy: number;
  /** Of the comments flagged "no matching rule", how many really have none. */
  noMatchPrecision: number;
  /** Of the comments that really have no rule, how many were flagged. */
  noMatchRecall: number;
  failed: number;
  mistakes: { sourceCommentId: string; expected: string; got: string; text: string }[];
}

const NONE = 'no_matching_rule';

/** Compares stored classifications with an answer key (e.g. the synthetic dataset's labels file). */
export function scoreClassifications(db: Db, labels: ClassificationLabels): ClassificationScore {
  const rows = db
    .select({ p: precedents, c: precedentClassifications })
    .from(precedents)
    .innerJoin(precedentClassifications, eq(precedentClassifications.precedentId, precedents.id))
    .all();
  let scored = 0;
  let correct = 0;
  let failed = 0;
  let flagged = 0;
  let flaggedRight = 0;
  let actualNone = 0;
  const mistakes: ClassificationScore['mistakes'] = [];
  for (const { p, c } of rows) {
    const label = p.sourceCommentId ? labels[p.sourceCommentId] : undefined;
    if (!label || label === 'invalid' || label === 'duplicate') continue;
    const expected = label.startsWith('off_rule:') ? NONE : label;
    const got = c.status !== 'ok' ? 'failed' : c.noMatchingRule ? NONE : (c.category ?? 'failed');
    scored++;
    if (got === 'failed') failed++;
    if (expected === NONE) actualNone++;
    if (got === NONE) {
      flagged++;
      if (expected === NONE) flaggedRight++;
    }
    if (got === expected) correct++;
    else mistakes.push({ sourceCommentId: p.sourceCommentId!, expected, got, text: p.commentText });
  }
  const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 1000 : 0);
  mistakes.sort((a, b) => a.sourceCommentId.localeCompare(b.sourceCommentId));
  return {
    scored,
    correct,
    accuracy: ratio(correct, scored),
    noMatchPrecision: ratio(flaggedRight, flagged),
    noMatchRecall: ratio(flaggedRight, actualNone),
    failed,
    mistakes,
  };
}
