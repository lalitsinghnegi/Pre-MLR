import type { FastifyBaseLogger } from 'fastify';
import type { LLMProvider } from '../llm/types.js';
import { type Comparison, type ExpectedFinding } from './compare.js';
import { type Summary } from './metrics.js';
import { type ModelConfig } from './models.js';
export interface EvalOptions {
    siteDir: string;
    expectedFile: string;
    models: ModelConfig[];
    runs: number;
    /** Stop starting new runs once actual spend exceeds this. */
    maxCostUsd: number;
    concurrency?: number;
    log: FastifyBaseLogger;
    /** Override provider construction (tests). */
    providerFactory?: (config: ModelConfig) => LLMProvider;
    onProgress?: (message: string) => void;
}
export interface RunResult {
    run: number;
    comparison: Comparison;
    tp: number;
    fp: number;
    fn: number;
    precision: number | null;
    recall: number | null;
    pages: number;
    failedPages: number;
    retries: number;
    latencyMsPerPage: number[];
    scanMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    servedModels: string[];
}
export interface ModelResult {
    config: ModelConfig;
    runs: RunResult[];
    precision: Summary;
    recall: Summary;
    tp: Summary;
    fp: Summary;
    fn: Summary;
    failedPages: Summary;
    retries: Summary;
    latencyMeanMs: Summary;
    latencyP95Ms: Summary;
    scanMs: Summary;
    inputTokens: Summary;
    outputTokens: Summary;
    costUsd: Summary;
}
export interface EvalResult {
    site: string;
    startedAt: string;
    expectedLlm: ExpectedFinding[];
    models: ModelResult[];
    totalCostUsd: number;
    /** Set when the budget stopped the evaluation early. */
    stoppedEarly: string | null;
}
/**
 * Crawls the site once (crawl + deterministic checks don't depend on the model), then for each model
 * and run analyses a fresh copy of the scan with the cache off, and scores the LLM findings against
 * the expected file's `llm` entries.
 */
export declare function runEval(opts: EvalOptions): Promise<EvalResult>;
