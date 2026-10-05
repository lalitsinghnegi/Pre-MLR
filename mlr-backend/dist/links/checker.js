import { CRAWLER_USER_AGENT_TOKEN } from '../crawler/crawler.js';
/** Statuses that usually mean "no bots", not "no page". */
const REFUSAL_STATUSES = new Set([401, 403, 429]);
const USER_AGENT = `Mozilla/5.0 (compatible; ${CRAWLER_USER_AGENT_TOKEN}/0.1)`;
/**
 * Checks each URL with HEAD, falling back to GET when HEAD isn't supported or fails (many servers
 * mishandle HEAD). Redirects are followed; 2xx/3xx final responses count as ok.
 */
export async function checkLinks(urls, opts = {}) {
    const { concurrency = 4, timeoutMs = 10_000, fetchImpl = fetch, signal } = opts;
    const results = new Array(urls.length);
    let next = 0;
    const worker = async () => {
        while (next < urls.length) {
            signal?.throwIfAborted();
            const i = next++;
            results[i] = await checkOne(urls[i], fetchImpl, timeoutMs);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
    return results;
}
async function checkOne(url, fetchImpl, timeoutMs) {
    let head = null;
    try {
        head = await request(url, 'HEAD', fetchImpl, timeoutMs);
        if (head.ok)
            return head;
    }
    catch {
        // fall through to GET
    }
    try {
        return await request(url, 'GET', fetchImpl, timeoutMs);
    }
    catch (err) {
        if (head)
            return head;
        const message = err instanceof Error
            ? err.cause instanceof Error
                ? err.cause.message
                : err.message
            : String(err);
        return { url, ok: false, httpStatus: null, error: message, finalUrl: null, contentType: null };
    }
}
async function request(url, method, fetchImpl, timeoutMs) {
    const res = await fetchImpl(url, {
        method,
        redirect: 'follow',
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
        signal: AbortSignal.timeout(timeoutMs),
    });
    // We only need the status; don't download bodies.
    await res.body?.cancel().catch(() => { });
    return {
        url,
        ok: res.status < 400,
        httpStatus: res.status,
        error: res.status < 400 ? null : `HTTP ${res.status}`,
        finalUrl: res.url || url,
        contentType: res.headers.get('content-type'),
        // Cloudflare marks its bot challenges with cf-mitigated (often on a 403 or 503).
        refused: res.status >= 400 && (REFUSAL_STATUSES.has(res.status) || res.headers.has('cf-mitigated')),
        checkedVia: 'http',
    };
}
//# sourceMappingURL=checker.js.map