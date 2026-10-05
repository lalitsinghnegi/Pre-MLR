import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client.js';
import { type LLMProvider } from './types.js';
export declare const LLM_ACTOR = "llm";
export interface AnalyzeOptions {
    provider: LLMProvider;
    dataDir: string;
    log: FastifyBaseLogger;
    concurrency?: number;
    signal?: AbortSignal;
    /** Reuse earlier analyses of identical page content (default true; the eval harness turns it off). */
    useCache?: boolean;
}
export interface AnalyzeResult {
    pagesAnalyzed: number;
    cached: number;
    failed: number;
    findingsCreated: number;
    costUsd: number;
}
/**
 * Runs the scan's enabled LLM rules over each eligible page: one call per page (or a cache hit),
 * validated output, one retry with feedback on invalid output, findings recorded as detectedBy
 * "llm". A failing page is recorded with its error; the scan carries on.
 */
export declare function runLlmAnalysis(db: Db, scanId: string, opts: AnalyzeOptions): Promise<AnalyzeResult>;
/** Typed SDK errors first (most specific to least), then anything else. */
export declare function describeError(err: unknown): string;
