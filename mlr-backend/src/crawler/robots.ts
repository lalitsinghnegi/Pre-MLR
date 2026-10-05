import { createRequire } from 'node:module';

interface Robot {
  isAllowed(url: string, ua?: string): boolean | undefined;
}

// robots-parser is CommonJS (`module.exports = fn`) but its typings declare an ES default export,
// which doesn't type-check under NodeNext. Load it via require with an explicit signature.
const robotsParser = createRequire(import.meta.url)('robots-parser') as (
  url: string,
  contents: string,
) => Robot;

/** Larger robots.txt files are cut off here (Google applies a similar 500 KiB limit). */
export const MAX_ROBOTS_BYTES = 512 * 1024;

/** The body as text, reading at most `max` bytes (the rest is never downloaded). */
export async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value.subarray(0, max - size));
    size += Math.min(value.length, max - size);
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Fetches and caches robots.txt per origin. A missing or unreachable robots.txt allows everything. */
export class RobotsCache {
  private readonly cache = new Map<string, Promise<Robot | null>>();

  constructor(
    private readonly userAgent: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async isAllowed(url: string): Promise<boolean> {
    const origin = new URL(url).origin;
    let robot = this.cache.get(origin);
    if (!robot) {
      robot = this.load(origin);
      this.cache.set(origin, robot);
    }
    return (await robot)?.isAllowed(url, this.userAgent) ?? true;
  }

  private async load(origin: string): Promise<Robot | null> {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const res = await this.fetchImpl(robotsUrl, {
        headers: { 'user-agent': this.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return null;
      return robotsParser(robotsUrl, await readCapped(res, MAX_ROBOTS_BYTES));
    } catch {
      return null;
    }
  }
}
