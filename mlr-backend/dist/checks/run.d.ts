import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client.js';
import { type LinkCheckResult } from '../links/checker.js';
export interface RunChecksOptions {
    log: FastifyBaseLogger;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    /** Most link URLs to request per scan; the rest are left unchecked. */
    maxLinks?: number;
    /**
     * Re-checks links whose sites refused the plain HTTP check, in a real browser. Without it such
     * links are recorded as unverified (never as broken).
     */
    verifyInBrowser?: (links: LinkCheckResult[]) => Promise<LinkCheckResult[]>;
}
export interface RunChecksResult {
    findingsCreated: number;
    linksChecked: number;
    /** Rules that could not run (unknown check or invalid params); the scan still completes. */
    ruleErrors: {
        ruleId: string;
        error: string;
    }[];
}
export declare const RULES_ENGINE_ACTOR = "rules_engine";
/** Link checks, then every enabled deterministic rule in the scan's snapshot, then findings. */
export declare function runDeterministicChecks(db: Db, scanId: string, opts: RunChecksOptions): Promise<RunChecksResult>;
