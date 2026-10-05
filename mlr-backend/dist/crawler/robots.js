import { createRequire } from 'node:module';
// robots-parser is CommonJS (`module.exports = fn`) but its typings declare an ES default export,
// which doesn't type-check under NodeNext. Load it via require with an explicit signature.
const robotsParser = createRequire(import.meta.url)('robots-parser');
/** Larger robots.txt files are cut off here (Google applies a similar 500 KiB limit). */
export const MAX_ROBOTS_BYTES = 512 * 1024;
/** The body as text, reading at most `max` bytes (the rest is never downloaded). */
export async function readCapped(res, max) {
    if (!res.body)
        return '';
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < max) {
        const { done, value } = await reader.read();
        if (done)
            break;
        chunks.push(value.subarray(0, max - size));
        size += Math.min(value.length, max - size);
    }
    await reader.cancel().catch(() => { });
    return new TextDecoder().decode(Buffer.concat(chunks));
}
/** Fetches and caches robots.txt per origin. A missing or unreachable robots.txt allows everything. */
export class RobotsCache {
    userAgent;
    fetchImpl;
    timeoutMs;
    cache = new Map();
    constructor(userAgent, fetchImpl = fetch, timeoutMs = 10_000) {
        this.userAgent = userAgent;
        this.fetchImpl = fetchImpl;
        this.timeoutMs = timeoutMs;
    }
    async isAllowed(url) {
        const origin = new URL(url).origin;
        let robot = this.cache.get(origin);
        if (!robot) {
            robot = this.load(origin);
            this.cache.set(origin, robot);
        }
        return (await robot)?.isAllowed(url, this.userAgent) ?? true;
    }
    async load(origin) {
        const robotsUrl = `${origin}/robots.txt`;
        try {
            const res = await this.fetchImpl(robotsUrl, {
                headers: { 'user-agent': this.userAgent },
                signal: AbortSignal.timeout(this.timeoutMs),
            });
            if (!res.ok)
                return null;
            return robotsParser(robotsUrl, await readCapped(res, MAX_ROBOTS_BYTES));
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=robots.js.map