import type { NetworkGuard } from '../net/guard.js';
import type { LinkCheckResult } from './checker.js';
/** Most links re-checked in the browser per scan (each takes a page load). */
export declare const MAX_BROWSER_CHECKS = 30;
/**
 * Re-checks links whose sites refused the plain HTTP check, by loading them in the crawler's
 * guarded browser (bot protection usually lets a real browser through). Only upgrades results:
 * a page that loads is ok; 404/410 is broken; anything else (still refused, timeouts, downloads
 * that give no status) is "unverified", never "broken".
 */
export declare function verifyLinksInBrowser(links: LinkCheckResult[], guard: NetworkGuard, opts?: {
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<LinkCheckResult[]>;
