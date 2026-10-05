import { asc, eq } from 'drizzle-orm';
import { CRAWLER_USER_AGENT_TOKEN } from '../crawler/crawler.js';
import { RobotsCache } from '../crawler/robots.js';
import { isSameSite, normalizeUrl } from '../crawler/url.js';
import { linkChecks, pages, scans } from '../db/schema.js';
import { recordFindings } from '../findings/service.js';
import { MAX_BROWSER_CHECKS } from '../links/browser.js';
import { checkLinks } from '../links/checker.js';
import { scanRuleVersions } from '../rules/repository.js';
import { getCheck } from './registry.js';
export const RULES_ENGINE_ACTOR = 'rules_engine';
/** Link checks, then every enabled deterministic rule in the scan's snapshot, then findings. */
export async function runDeterministicChecks(db, scanId, opts) {
    const scan = db.select().from(scans).where(eq(scans.id, scanId)).get();
    if (!scan)
        throw new Error(`Scan ${scanId} not found`);
    const rows = db
        .select()
        .from(pages)
        .where(eq(pages.scanId, scanId))
        .orderBy(asc(pages.crawlIndex))
        .all();
    const checkPages = rows.map((r) => ({
        id: r.id,
        url: r.url,
        title: r.title,
        text: r.text,
        links: r.links,
        facts: r.facts,
        httpStatus: r.httpStatus,
        error: r.error,
    }));
    const statuses = await linkStatuses(db, scanId, scan.startUrl, checkPages, opts);
    const ctx = {
        pages: checkPages,
        product: scan.product,
        link: (url) => {
            const key = normalizeUrl(url);
            return key ? statuses.get(key) : undefined;
        },
    };
    const findings = [];
    const ruleErrors = [];
    for (const rule of scanRuleVersions(db, scanId).filter((r) => r.checkType === 'deterministic')) {
        opts.signal?.throwIfAborted();
        const check = getCheck(rule.params.check);
        const params = check?.params.safeParse(rule.params);
        if (!check || !params?.success) {
            const error = check
                ? `invalid params: ${params?.error?.message}`
                : `unknown check "${String(rule.params.check)}"`;
            ruleErrors.push({ ruleId: rule.ruleId, error });
            opts.log.warn({ scanId, ruleId: rule.ruleId, error }, 'rule skipped');
            continue;
        }
        try {
            for (const f of check.run(params.data, ctx)) {
                findings.push({ ...f, ruleId: rule.ruleId, detectedBy: 'rules_engine' });
            }
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            ruleErrors.push({ ruleId: rule.ruleId, error });
            opts.log.error({ scanId, ruleId: rule.ruleId, err }, 'rule failed');
        }
    }
    const { created } = recordFindings(db, scanId, findings, RULES_ENGINE_ACTOR);
    return { findingsCreated: created.length, linksChecked: statuses.size, ruleErrors };
}
/**
 * Links the site refused to answer automatically (bot protection) get a second look in a real
 * browser, up to MAX_BROWSER_CHECKS; any left over, or a failed browser check, count as unverified.
 */
async function recheckRefused(results, scanId, opts) {
    const refused = results.filter((r) => r.refused);
    if (!refused.length)
        return results;
    const unverified = (r) => ({
        ...r,
        ok: false,
        unverified: true,
    });
    const toBrowser = opts.verifyInBrowser ? refused.slice(0, MAX_BROWSER_CHECKS) : [];
    let rechecked = [];
    try {
        rechecked = opts.verifyInBrowser ? await opts.verifyInBrowser(toBrowser) : [];
    }
    catch (err) {
        opts.signal?.throwIfAborted();
        opts.log.warn({ scanId, err }, 'browser re-check of refused links failed');
    }
    const byUrl = new Map(rechecked.map((r) => [r.url, r]));
    opts.log.info({ scanId, refused: refused.length, recheckedInBrowser: rechecked.length }, 'links refused by their sites were re-checked');
    return results.map((r) => (r.refused ? (byUrl.get(r.url) ?? unverified(r)) : r));
}
/**
 * Status for every http(s) link on the scan's pages. Crawled pages reuse their own HTTP status;
 * other URLs are requested (up to maxLinks) and stored in link_checks. URLs on the scanned site
 * that its robots.txt disallows are left unchecked, as the crawler leaves them uncrawled.
 */
async function linkStatuses(db, scanId, startUrl, checkPages, opts) {
    const statuses = new Map();
    for (const p of checkPages) {
        const failed = p.error !== null || (p.httpStatus ?? 0) >= 400;
        statuses.set(p.url, { ok: !failed, httpStatus: p.httpStatus, error: p.error });
    }
    const wanted = new Set();
    for (const p of checkPages) {
        for (const l of p.links) {
            const url = normalizeUrl(l.href);
            if (url && !statuses.has(url))
                wanted.add(url);
        }
    }
    const robots = new RobotsCache(CRAWLER_USER_AGENT_TOKEN, opts.fetchImpl);
    const allowed = [];
    for (const url of wanted) {
        if (!isSameSite(url, startUrl) || (await robots.isAllowed(url)))
            allowed.push(url);
    }
    const maxLinks = opts.maxLinks ?? 500;
    const toCheck = allowed.slice(0, maxLinks);
    if (wanted.size > maxLinks) {
        opts.log.warn({ scanId, links: wanted.size, maxLinks }, 'too many links; some were not checked');
    }
    const results = await recheckRefused(await checkLinks(toCheck, { fetchImpl: opts.fetchImpl, signal: opts.signal }), scanId, opts);
    const now = new Date().toISOString();
    db.transaction((tx) => {
        for (const r of results) {
            const row = {
                ok: r.ok,
                httpStatus: r.httpStatus,
                error: r.error,
                finalUrl: r.finalUrl,
                contentType: r.contentType,
                unverified: !!r.unverified,
                checkedVia: r.checkedVia ?? 'http',
                checkedAt: now,
            };
            statuses.set(r.url, {
                ok: r.ok,
                httpStatus: r.httpStatus,
                error: r.error,
                unverified: row.unverified,
            });
            tx.insert(linkChecks)
                .values({ scanId, url: r.url, ...row })
                .onConflictDoUpdate({ target: [linkChecks.scanId, linkChecks.url], set: row })
                .run();
        }
    });
    return statuses;
}
//# sourceMappingURL=run.js.map