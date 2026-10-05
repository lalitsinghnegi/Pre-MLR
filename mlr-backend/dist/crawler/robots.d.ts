/** Larger robots.txt files are cut off here (Google applies a similar 500 KiB limit). */
export declare const MAX_ROBOTS_BYTES: number;
/** The body as text, reading at most `max` bytes (the rest is never downloaded). */
export declare function readCapped(res: Response, max: number): Promise<string>;
/** Fetches and caches robots.txt per origin. A missing or unreachable robots.txt allows everything. */
export declare class RobotsCache {
    private readonly userAgent;
    private readonly fetchImpl;
    private readonly timeoutMs;
    private readonly cache;
    constructor(userAgent: string, fetchImpl?: typeof fetch, timeoutMs?: number);
    isAllowed(url: string): Promise<boolean>;
    private load;
}
