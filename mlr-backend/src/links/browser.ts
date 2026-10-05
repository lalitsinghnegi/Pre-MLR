import type { Response } from 'playwright';
import { DESKTOP_UA, launchGuardedBrowser } from '../crawler/crawler.js';
import type { NetworkGuard } from '../net/guard.js';
import type { LinkCheckResult } from './checker.js';

/** Most links re-checked in the browser per scan (each takes a page load). */
export const MAX_BROWSER_CHECKS = 30;

/**
 * Re-checks links whose sites refused the plain HTTP check, by loading them in the crawler's
 * guarded browser (bot protection usually lets a real browser through). Only upgrades results:
 * a page that loads is ok; 404/410 is broken; anything else (still refused, timeouts, downloads
 * that give no status) is "unverified", never "broken".
 */
export async function verifyLinksInBrowser(
  links: LinkCheckResult[],
  guard: NetworkGuard,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<LinkCheckResult[]> {
  if (!links.length) return [];
  const { browser, close } = await launchGuardedBrowser(guard);
  try {
    // The crawler's normal desktop user agent: the default one says "HeadlessChrome", which
    // bot protection refuses outright.
    const ctx = await browser.newContext({
      userAgent: DESKTOP_UA,
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
    await ctx.routeWebSocket(/.*/, (ws) => ws.close());
    const out: LinkCheckResult[] = [];
    for (const link of links) {
      opts.signal?.throwIfAborted();
      const page = await ctx.newPage();
      // A download (e.g. a PDF) aborts goto, but its response status is still seen here.
      let main: Response | null = null;
      page.on('response', (r) => {
        if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) main = r;
      });
      const response = await page
        .goto(link.url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs ?? 20_000 })
        .catch(() => null);
      const final: Response | null = response ?? main;
      const status = final?.status() ?? null;
      const challenged = !!final?.headers()['cf-mitigated'];
      await page.close();
      if (status !== null && status < 400 && !challenged) {
        out.push({
          ...link,
          ok: true,
          httpStatus: status,
          error: null,
          finalUrl: final!.url(),
          refused: false,
          checkedVia: 'browser',
        });
      } else if (status === 404 || status === 410) {
        out.push({
          ...link,
          ok: false,
          httpStatus: status,
          error: `HTTP ${status}`,
          finalUrl: final!.url(),
          refused: false,
          checkedVia: 'browser',
        });
      } else {
        out.push({ ...link, ok: false, unverified: true, checkedVia: 'browser' });
      }
    }
    return out;
  } finally {
    await close();
  }
}
