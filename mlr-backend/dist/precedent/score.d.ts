import type { Db } from '../db/client.js';
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
    mistakes: {
        sourceCommentId: string;
        expected: string;
        got: string;
        text: string;
    }[];
}
/** Compares stored classifications with an answer key (e.g. the synthetic dataset's labels file). */
export declare function scoreClassifications(db: Db, labels: ClassificationLabels): ClassificationScore;
