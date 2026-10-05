import type { Db } from '../db/client.js';
import { type Embedder } from './embed.js';
export declare const TOP_K = 3;
/** Embeds the given precedents that have no vector yet for this embedder; returns how many. */
export declare function ensureEmbeddings(db: Db, embedder: Embedder, items: {
    id: string;
    text: string;
}[]): Promise<number>;
export interface AttachOptions {
    embedder: Embedder;
    maxAgeMonths: number;
    now?: Date;
}
export interface AttachResult {
    findings: number;
    /** Findings that got at least one precedent. */
    matched: number;
    attached: number;
    embedded: number;
}
/** YYYY-MM-DD, `months` before `now`. */
export declare function cutoffDate(now: Date, months: number): string;
/**
 * Attaches up to three similar historic comments to each finding of a scan, as advisory evidence.
 * Candidates are precedents classified into the finding's rule category and commented within the
 * last `maxAgeMonths`; they are ranked by cosine similarity of sentence embeddings (finding: rule
 * title, message and evidence; precedent: comment text), nudged up for the scan's brand or site,
 * and dropped below the embedder's minimum similarity. Re-running replaces the scan's matches.
 */
export declare function attachPrecedents(db: Db, scanId: string, opts: AttachOptions): Promise<AttachResult>;
/** Comment wording without numbers, redaction placeholders or punctuation, for spotting repeats. */
export declare const gistOf: (text: string) => string;
