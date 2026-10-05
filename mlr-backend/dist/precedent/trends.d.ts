import { type CandidateRules, type PrecedentBucket, type PrecedentFilter, type PrecedentTrends } from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
type Interval = PrecedentTrends['interval'];
declare function rowsFor(db: Db, f: PrecedentFilter): {
    p: {
        id: string;
        importId: string;
        sourceCommentId: string | null;
        site: string | null;
        brand: string;
        country: string | null;
        proofName: string | null;
        proofVersion: string | null;
        pageRef: string | null;
        commentText: string;
        reviewerPseudonym: string | null;
        reviewerFunction: string | null;
        status: string | null;
        commentedAt: string;
        fingerprint: string;
        createdAt: string;
    };
    c: {
        precedentId: string;
        status: "failed" | "ok";
        category: string | null;
        ruleId: string | null;
        confidence: number | null;
        noMatchingRule: boolean;
        topic: string | null;
        provider: string;
        model: string;
        promptVersion: string;
        rulePackHash: string;
        error: string | null;
        classifiedBy: string;
        classifiedAt: string;
    } | null;
}[];
type Row = ReturnType<typeof rowsFor>[number];
export declare function bucketOf(c: Row['c']): PrecedentBucket;
/** "2025-03" or "2025-Q1" for a YYYY-MM-DD date. */
export declare function periodOf(date: string, interval: Interval): string;
/** Every period from first to last, inclusive. */
export declare function periodRange(first: string, last: string, interval: Interval): string[];
/**
 * Comment counts by category over time, by brand and by reviewer function. Aggregated in JS
 * (precedent sets are small) so no database-specific date functions are needed.
 */
export declare function precedentTrends(db: Db, f: PrecedentFilter & {
    interval: Interval;
}): PrecedentTrends;
/** Recurring themes among comments no rule covers: candidates for new rules. */
export declare function candidateRules(db: Db, f: PrecedentFilter & {
    minSize: number;
}): CandidateRules;
export {};
