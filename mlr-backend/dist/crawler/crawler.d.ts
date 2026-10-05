import type { PageFacts, PageLink } from '@pre-mlr/shared';
import { type NetworkGuard } from '../net/guard.js';
import { type GuardProxy } from '../net/proxy.js';
export declare const CRAWLER_USER_AGENT_TOKEN = "PreMLRChecker";
export declare const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 PreMLRChecker/0.1";
export declare const DESKTOP_VIEWPORT: {
    width: number;
    height: number;
};
export declare const MOBILE_VIEWPORT: {
    width: number;
    height: number;
};
export interface CrawlOptions {
    startUrl: string;
    maxPages: number;
    maxDepth: number;
    /** Absolute directory for this scan's screenshots. */
    screenshotDir: string;
    signal?: AbortSignal;
    navigationTimeoutMs?: number;
    /** For robots.txt; pass the guard's fetch in production. */
    fetchImpl?: typeof fetch;
    /** Decides which hosts the browser may contact (pages, subresources and redirects). */
    guard: NetworkGuard;
}
export interface CrawledPage {
    id: string;
    crawlIndex: number;
    url: string;
    depth: number;
    parentId: string | null;
    title: string | null;
    text: string | null;
    links: PageLink[];
    /** Null if the page failed to load or fact extraction failed. */
    facts: PageFacts | null;
    httpStatus: number | null;
    /** File names inside screenshotDir. */
    desktopScreenshot: string | null;
    mobileScreenshot: string | null;
    error: string | null;
}
/**
 * Breadth-first crawl of one site. Pages are visited one at a time; each recorded page is passed
 * to onPage before the next is fetched. Pages that fail to load or return HTTP >= 400 are recorded
 * with an error and no screenshots, and their links are not followed.
 */
export declare function crawl(opts: CrawlOptions, onPage: (page: CrawledPage) => Promise<void> | void): Promise<void>;
/**
 * Chromium whose every connection goes through the guard proxy (see net/proxy.ts). Loopback is
 * proxied too ("<-loopback>" removes Chromium's built-in localhost bypass), so local services are
 * only reachable when allowlisted.
 */
export declare function launchGuardedBrowser(guard: NetworkGuard): Promise<{
    browser: import("playwright").Browser;
    proxy: GuardProxy;
    close: () => Promise<void>;
}>;
