import { join, resolve } from 'node:path';
import { eq, inArray, sql } from 'drizzle-orm';
import { runDeterministicChecks } from '../checks/run.js';
import { verifyLinksInBrowser } from '../links/browser.js';
import { crawl as defaultCrawl } from '../crawler/crawler.js';
import { pages, scans } from '../db/schema.js';
import { runLlmAnalysis } from '../llm/analyze.js';
import { attachPrecedents } from '../precedent/retrieve.js';
import { AppError } from '../errors.js';
import { snapshotScanRules } from '../rules/repository.js';
/** Screenshot directory for a scan, relative to DATA_DIR. Built only from generated ids. */
export const scanDirRelative = (scanId) => join('scans', scanId);
/**
 * In-process scan queue. Runs one scan at a time in the background: crawl, then link checks and
 * deterministic rules, then (if a provider is configured) LLM analysis, then (if an embedder is
 * configured) attaching similar precedents to the findings. Status and progress are written to the
 * database as it goes, so the API reads them from there; a scan is "completed" only once its
 * checks have run.
 */
export class ScanRunner {
    db;
    dataDir;
    log;
    opts;
    queue = [];
    abort = new AbortController();
    draining = null;
    constructor(db, dataDir, log, opts) {
        this.db = db;
        this.dataDir = dataDir;
        this.log = log;
        this.opts = opts;
    }
    /** Call once at startup: fail scans interrupted by a restart, re-queue ones that never started. */
    recover() {
        this.db
            .update(scans)
            .set({ status: 'failed', error: 'Interrupted by server restart', finishedAt: now() })
            .where(eq(scans.status, 'running'))
            .run();
        const queued = this.db
            .select({ id: scans.id })
            .from(scans)
            .where(inArray(scans.status, ['queued']))
            .orderBy(scans.createdAt)
            .all();
        for (const { id } of queued)
            this.enqueue(id);
    }
    enqueue(scanId) {
        this.queue.push(scanId);
        this.draining ??= this.drain().finally(() => {
            this.draining = null;
        });
    }
    /** Resolves when the queue is empty. */
    async idle() {
        while (this.draining)
            await this.draining;
    }
    async close() {
        this.queue.length = 0;
        this.abort.abort(new Error('Server shutting down'));
        await this.idle();
    }
    async drain() {
        let scanId;
        while ((scanId = this.queue.shift()) && !this.abort.signal.aborted) {
            await this.run(scanId);
        }
    }
    setPhase(scanId, phase) {
        this.db.update(scans).set({ phase }).where(eq(scans.id, scanId)).run();
    }
    async run(scanId) {
        const scan = this.db.select().from(scans).where(eq(scans.id, scanId)).get();
        if (!scan || scan.status !== 'queued')
            return;
        this.db
            .update(scans)
            .set({ status: 'running', phase: 'crawling', startedAt: now() })
            .where(eq(scans.id, scanId))
            .run();
        // Freeze the rule versions now, so later rule edits never change what this scan was checked against.
        snapshotScanRules(this.db, scanId);
        this.log.info({ scanId, startUrl: scan.startUrl }, 'scan started');
        const relDir = scanDirRelative(scanId);
        const onPage = (p) => {
            this.db.transaction((tx) => {
                tx.insert(pages)
                    .values({
                    id: p.id,
                    scanId,
                    crawlIndex: p.crawlIndex,
                    url: p.url,
                    depth: p.depth,
                    parentPageId: p.parentId,
                    title: p.title,
                    text: p.text,
                    links: p.links,
                    facts: p.facts,
                    httpStatus: p.httpStatus,
                    desktopScreenshotPath: p.desktopScreenshot && join(relDir, p.desktopScreenshot),
                    mobileScreenshotPath: p.mobileScreenshot && join(relDir, p.mobileScreenshot),
                    error: p.error,
                    crawledAt: now(),
                })
                    .run();
                tx.update(scans)
                    .set({ pagesCrawled: sql `${scans.pagesCrawled} + 1` })
                    .where(eq(scans.id, scanId))
                    .run();
            });
        };
        // Stops on server shutdown or when the scan runs too long.
        const timeoutMs = this.opts.timeoutMs ?? 30 * 60_000;
        const deadline = AbortSignal.timeout(timeoutMs);
        const signal = AbortSignal.any([this.abort.signal, deadline]);
        const fetchImpl = this.opts.fetchImpl ?? this.opts.guard.fetch;
        try {
            await (this.opts.crawl ?? defaultCrawl)({
                startUrl: scan.startUrl,
                maxPages: scan.maxPages,
                maxDepth: scan.maxDepth,
                screenshotDir: resolve(this.dataDir, relDir),
                signal,
                fetchImpl,
                guard: this.opts.guard,
            }, onPage);
            this.setPhase(scanId, 'checking');
            const checks = await runDeterministicChecks(this.db, scanId, {
                log: this.log,
                fetchImpl,
                signal,
                maxLinks: this.opts.maxLinks,
                verifyInBrowser: this.opts.verifyInBrowser === undefined
                    ? (links) => verifyLinksInBrowser(links, this.opts.guard, { signal })
                    : (this.opts.verifyInBrowser ?? undefined),
            });
            this.log.info({ scanId, ...checks }, 'checks completed');
            if (this.opts.llm) {
                this.setPhase(scanId, 'analyzing');
                const llm = await runLlmAnalysis(this.db, scanId, {
                    provider: this.opts.llm,
                    dataDir: this.dataDir,
                    log: this.log,
                    concurrency: this.opts.llmConcurrency,
                    signal,
                });
                this.log.info({ scanId, ...llm }, 'LLM analysis completed');
            }
            if (this.opts.embedder) {
                this.setPhase(scanId, 'matching');
                // Precedents are advisory context: if matching fails, the scan still completes.
                try {
                    const matched = await attachPrecedents(this.db, scanId, {
                        embedder: this.opts.embedder,
                        maxAgeMonths: this.opts.precedentMaxAgeMonths ?? 36,
                    });
                    this.log.info({ scanId, ...matched }, 'precedents matched');
                }
                catch (err) {
                    this.log.warn({ scanId, err }, 'precedent matching failed; scan continues without it');
                }
            }
            this.db
                .update(scans)
                .set({ status: 'completed', phase: null, finishedAt: now() })
                .where(eq(scans.id, scanId))
                .run();
            this.log.info({ scanId }, 'scan completed');
        }
        catch (err) {
            // Users see a short reason; the details (paths, stack) go to the server log only.
            const message = deadline.aborted
                ? `Scan stopped: it ran longer than ${duration(timeoutMs)}.`
                : err instanceof AppError
                    ? err.message
                    : this.abort.signal.aborted
                        ? 'Scan stopped: the server shut down.'
                        : 'Scan failed because of an internal error. The details are in the server log.';
            this.db
                .update(scans)
                .set({ status: 'failed', phase: null, error: message, finishedAt: now() })
                .where(eq(scans.id, scanId))
                .run();
            this.log.error({ scanId, err }, 'scan failed');
        }
    }
}
const now = () => new Date().toISOString();
function duration(ms) {
    const [n, unit] = ms >= 60_000
        ? [Math.round(ms / 60_000), 'minute']
        : [Math.max(1, Math.round(ms / 1000)), 'second'];
    return `${n} ${unit}${n === 1 ? '' : 's'}`;
}
//# sourceMappingURL=runner.js.map