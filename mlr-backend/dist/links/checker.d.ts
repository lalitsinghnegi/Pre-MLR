export interface LinkCheckResult {
    url: string;
    ok: boolean;
    httpStatus: number | null;
    error: string | null;
    finalUrl: string | null;
    contentType: string | null;
    /**
     * The site refused an automated request (401/403/429 or a bot challenge), so the link may well
     * work in a browser. Such links are re-checked in a real browser before being called broken.
     */
    refused?: boolean;
    /** Still refused after the browser check: neither confirmed working nor broken. */
    unverified?: boolean;
    checkedVia?: 'http' | 'browser';
}
export interface CheckLinksOptions {
    concurrency?: number;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}
/**
 * Checks each URL with HEAD, falling back to GET when HEAD isn't supported or fails (many servers
 * mishandle HEAD). Redirects are followed; 2xx/3xx final responses count as ok.
 */
export declare function checkLinks(urls: string[], opts?: CheckLinksOptions): Promise<LinkCheckResult[]>;
