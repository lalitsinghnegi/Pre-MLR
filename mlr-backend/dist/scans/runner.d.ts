import type { FastifyBaseLogger } from 'fastify';
import { type RunChecksOptions } from '../checks/run.js';
import { crawl as defaultCrawl } from '../crawler/crawler.js';
import type { Db } from '../db/client.js';
import type { LLMProvider } from '../llm/types.js';
import type { Embedder } from '../precedent/embed.js';
import type { NetworkGuard } from '../net/guard.js';
export type CrawlFn = typeof defaultCrawl;
export interface ScanRunnerOptions {
    /** Replace the Playwright crawler (tests). */
    crawl?: CrawlFn;
    /** Replace fetch for link checks (tests). */
    fetchImpl?: typeof fetch;
    maxLinks?: number;
    /** LLM provider for the analysis step; null/undefined skips it. */
    llm?: LLMProvider | null;
    llmConcurrency?: number;
    /** Embedder for attaching similar precedents to findings; null/undefined skips that step. */
    embedder?: Embedder | null;
    precedentMaxAgeMonths?: number;
    /** Which hosts the crawl and link checks may contact. */
    guard: NetworkGuard;
    /** Stop a scan after this long (default 30 minutes). */
    timeoutMs?: number;
    /** Replace the browser re-check of links refused by their sites (tests); null turns it off. */
    verifyInBrowser?: RunChecksOptions['verifyInBrowser'] | null;
}
/** Screenshot directory for a scan, relative to DATA_DIR. Built only from generated ids. */
export declare const scanDirRelative: (scanId: string) => string;
/**
 * In-process scan queue. Runs one scan at a time in the background: crawl, then link checks and
 * deterministic rules, then (if a provider is configured) LLM analysis, then (if an embedder is
 * configured) attaching similar precedents to the findings. Status and progress are written to the
 * database as it goes, so the API reads them from there; a scan is "completed" only once its
 * checks have run.
 */
export declare class ScanRunner {
    private readonly db;
    private readonly dataDir;
    private readonly log;
    private readonly opts;
    private readonly queue;
    private readonly abort;
    private draining;
    constructor(db: Db, dataDir: string, log: FastifyBaseLogger, opts: ScanRunnerOptions);
    /** Call once at startup: fail scans interrupted by a restart, re-queue ones that never started. */
    recover(): void;
    enqueue(scanId: string): void;
    /** Resolves when the queue is empty. */
    idle(): Promise<void>;
    close(): Promise<void>;
    private drain;
    private setPhase;
    private run;
}
