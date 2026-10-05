import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { BLOCKED_MESSAGE } from '../net/guard.js';
import { BLOCKED_HEADER, startGuardProxy } from '../net/proxy.js';
import { FACTS_SCRIPT } from './facts-script.js';
import { RobotsCache } from './robots.js';
import { isSameSite, looksLikeHtml, normalizeUrl } from './url.js';
export const CRAWLER_USER_AGENT_TOKEN = 'PreMLRChecker';
const UA_SUFFIX = `${CRAWLER_USER_AGENT_TOKEN}/0.1`;
export const DESKTOP_UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 ${UA_SUFFIX}`;
const MOBILE_UA = `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 ${UA_SUFFIX}`;
export const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
export const MOBILE_VIEWPORT = { width: 390, height: 844 };
/**
 * Breadth-first crawl of one site. Pages are visited one at a time; each recorded page is passed
 * to onPage before the next is fetched. Pages that fail to load or return HTTP >= 400 are recorded
 * with an error and no screenshots, and their links are not followed.
 */
export async function crawl(opts, onPage) {
    const startUrl = normalizeUrl(opts.startUrl);
    if (!startUrl)
        throw new Error(`Invalid start URL: ${opts.startUrl}`);
    const timeout = opts.navigationTimeoutMs ?? 30_000;
    const robots = new RobotsCache(CRAWLER_USER_AGENT_TOKEN, opts.fetchImpl ?? opts.guard.fetch);
    await mkdir(opts.screenshotDir, { recursive: true });
    const { browser, proxy, close } = await launchGuardedBrowser(opts.guard);
    try {
        const safe = { serviceWorkers: 'block', acceptDownloads: false };
        const desktop = await browser.newContext({
            ...safe,
            viewport: DESKTOP_VIEWPORT,
            userAgent: DESKTOP_UA,
        });
        const mobile = await browser.newContext({
            ...safe,
            viewport: MOBILE_VIEWPORT,
            userAgent: MOBILE_UA,
            isMobile: true,
            hasTouch: true,
        });
        for (const ctx of [desktop, mobile])
            await ctx.routeWebSocket(/.*/, (ws) => ws.close());
        desktop.setDefaultTimeout(timeout);
        mobile.setDefaultTimeout(timeout);
        const queue = [{ url: startUrl, depth: 0, parentId: null }];
        const seen = new Set([startUrl]); // enqueued or crawled
        let crawlIndex = 0;
        while (queue.length > 0 && crawlIndex < opts.maxPages) {
            opts.signal?.throwIfAborted();
            const item = queue.shift();
            if (!(await robots.isAllowed(item.url)))
                continue;
            const result = await visit(desktop, mobile, item, opts.screenshotDir, timeout, proxy).catch((err) => ({
                kind: 'page',
                finalUrl: item.url,
                page: { ...emptyPage(randomUUID()), httpStatus: null, error: errorMessage(err) },
            }));
            if (result.kind === 'skip')
                continue;
            if (result.finalUrl !== item.url) {
                // Redirected: record under the final URL, unless that page is already known.
                if (seen.has(result.finalUrl) || !isSameSite(result.finalUrl, startUrl))
                    continue;
                seen.add(result.finalUrl);
            }
            const page = {
                ...result.page,
                crawlIndex: crawlIndex++,
                url: result.finalUrl,
                depth: item.depth,
                parentId: item.parentId,
            };
            await onPage(page);
            if (page.error || item.depth >= opts.maxDepth)
                continue;
            for (const link of page.links) {
                const next = normalizeUrl(link.href);
                if (!next || seen.has(next) || !isSameSite(next, startUrl) || !looksLikeHtml(next))
                    continue;
                seen.add(next);
                queue.push({ url: next, depth: item.depth + 1, parentId: page.id });
            }
        }
    }
    finally {
        await close();
    }
}
/**
 * Chromium whose every connection goes through the guard proxy (see net/proxy.ts). Loopback is
 * proxied too ("<-loopback>" removes Chromium's built-in localhost bypass), so local services are
 * only reachable when allowlisted.
 */
export async function launchGuardedBrowser(guard) {
    const proxy = await startGuardProxy(guard);
    try {
        const browser = await chromium.launch({
            proxy: {
                server: proxy.server,
                bypass: '<-loopback>',
                username: proxy.username,
                password: proxy.password,
            },
        });
        return {
            browser,
            proxy,
            close: async () => {
                await browser.close();
                await proxy.close();
            },
        };
    }
    catch (err) {
        await proxy.close();
        throw err;
    }
}
/** Whether the proxy refused something during `run` (the browser only reports a tunnel error). */
const blockedDuring = (proxy, before) => proxy.blocked.length > before;
async function visit(desktop, mobile, item, screenshotDir, timeout, proxy) {
    const id = randomUUID();
    const empty = emptyPage(id);
    const page = await desktop.newPage();
    const before = proxy.blocked.length;
    try {
        let response;
        try {
            response = await page.goto(item.url, { waitUntil: 'load', timeout });
        }
        catch (err) {
            const error = blockedDuring(proxy, before)
                ? BLOCKED_MESSAGE
                : `Navigation failed: ${errorMessage(err)}`;
            return { kind: 'page', finalUrl: item.url, page: { ...empty, httpStatus: null, error } };
        }
        // A redirect to a private address: record the page as blocked, under its own URL.
        if (response?.headers()[BLOCKED_HEADER]) {
            return {
                kind: 'page',
                finalUrl: item.url,
                page: { ...empty, httpStatus: null, error: BLOCKED_MESSAGE },
            };
        }
        const finalUrl = normalizeUrl(page.url()) ?? item.url;
        const httpStatus = response?.status() ?? null;
        const contentType = (await response?.headerValue('content-type')) ?? '';
        if (contentType && !/html/i.test(contentType))
            return { kind: 'skip' };
        if (httpStatus !== null && httpStatus >= 400) {
            return {
                kind: 'page',
                finalUrl,
                page: { ...empty, httpStatus, error: `HTTP ${httpStatus}` },
            };
        }
        await settle(page);
        const { title, text, links } = await extract(page);
        // Facts are best-effort: a failure here must not lose the page.
        const facts = await page.evaluate(FACTS_SCRIPT).catch(() => null);
        const desktopScreenshot = `${id}-desktop.png`;
        await page.screenshot({ path: join(screenshotDir, desktopScreenshot), fullPage: true });
        let mobileScreenshot = `${id}-mobile.png`;
        let error = null;
        const mobilePage = await mobile.newPage();
        try {
            await mobilePage.goto(finalUrl, { waitUntil: 'load', timeout });
            await settle(mobilePage);
            await mobilePage.screenshot({ path: join(screenshotDir, mobileScreenshot), fullPage: true });
        }
        catch (err) {
            mobileScreenshot = null;
            error = `Mobile screenshot failed: ${errorMessage(err)}`;
        }
        finally {
            await mobilePage.close();
        }
        return {
            kind: 'page',
            finalUrl,
            page: {
                id,
                title,
                text,
                links,
                facts,
                httpStatus,
                desktopScreenshot,
                mobileScreenshot,
                error,
            },
        };
    }
    finally {
        await page.close();
    }
}
/** Give late network requests (fonts, images) a short chance to finish; never fails the page. */
async function settle(page) {
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => { });
}
/**
 * Runs in the browser. Kept as a plain JS string so no TS/esbuild transform can inject helpers
 * (e.g. tsx's `__name`) that don't exist in the page.
 */
const EXTRACT_SCRIPT = `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  return {
    text: document.body ? document.body.innerText : '',
    links: Array.from(document.querySelectorAll('a[href]')).map((a) => ({
      // a.href is resolved against the document base; non-http schemes come back unchanged.
      href: a.href || a.getAttribute('href') || '',
      text:
        clean(a.innerText) ||
        clean(a.getAttribute('aria-label')) ||
        clean(a.getAttribute('title')) ||
        clean(a.querySelector('img') && a.querySelector('img').getAttribute('alt')),
    })),
  };
})()`;
async function extract(page) {
    const title = (await page.title()).trim() || null;
    const { text, links } = await page.evaluate(EXTRACT_SCRIPT);
    return { title, text, links };
}
function emptyPage(id) {
    return {
        id,
        title: null,
        text: null,
        links: [],
        facts: null,
        desktopScreenshot: null,
        mobileScreenshot: null,
    };
}
function errorMessage(err) {
    return (err instanceof Error ? err.message : String(err)).split('\n')[0];
}
//# sourceMappingURL=crawler.js.map