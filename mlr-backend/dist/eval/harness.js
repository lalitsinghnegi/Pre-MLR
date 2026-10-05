import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { CreateScanRequestSchema } from '@pre-mlr/shared';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { findings, llmAnalyses, pages, scans } from '../db/schema.js';
import { runLlmAnalysis } from '../llm/analyze.js';
import { snapshotScanRules } from '../rules/repository.js';
import { createScan } from '../scans/create.js';
import { serveStatic } from '../dev/static-server.js';
import { compareFindings, loadExpectedFindings, pagePath, } from './compare.js';
import { percentile, precision, recall, summarize } from './metrics.js';
import { providerFor } from './models.js';
/** Recorded as the creator of the harness's scans. */
const EVAL_ACTOR = 'eval-harness';
/**
 * Crawls the site once (crawl + deterministic checks don't depend on the model), then for each model
 * and run analyses a fresh copy of the scan with the cache off, and scores the LLM findings against
 * the expected file's `llm` entries.
 */
export async function runEval(opts) {
    const spec = await loadExpectedFindings(opts.expectedFile);
    const expectedLlm = spec.expected.filter((e) => e.detectedBy === 'llm');
    const site = await serveStatic(opts.siteDir);
    const dataDir = await mkdtemp(join(tmpdir(), 'pre-mlr-eval-'));
    const db = createDb(':memory:');
    const progress = opts.onProgress ?? (() => { });
    // Link checks stay on the local site; nothing else is contacted during the crawl.
    const fetchImpl = (input, init) => String(input).startsWith(site.url)
        ? fetch(input, init)
        : Promise.reject(new TypeError('fetch failed'));
    const app = await buildApp({
        config: loadConfig({
            LOG_LEVEL: 'silent',
            DATA_DIR: dataDir,
            SCAN_PRIVATE_ALLOWLIST: new URL(site.url).host,
        }),
        db,
        fetchImpl,
        llm: null,
        embedder: null,
    });
    try {
        progress(`Crawling ${spec.site} once…`);
        const baseId = createScan(db, app.scanRunner, CreateScanRequestSchema.parse({
            startUrl: `${site.url}/`,
            product: spec.product,
            rules: { enable: spec.enableRules },
        }), EVAL_ACTOR).id;
        await app.scanRunner.idle();
        const base = db.select().from(scans).where(eq(scans.id, baseId)).get();
        if (base.status !== 'completed')
            throw new Error(`Base scan ${base.status}: ${base.error}`);
        const results = [];
        let totalCostUsd = 0;
        let stoppedEarly = null;
        outer: for (const config of opts.models) {
            const provider = (opts.providerFactory ?? providerFor)(config);
            const runs = [];
            for (let run = 1; run <= opts.runs; run++) {
                if (totalCostUsd > opts.maxCostUsd) {
                    stoppedEarly = `Budget of $${opts.maxCostUsd} exceeded ($${totalCostUsd.toFixed(4)} spent); later runs skipped.`;
                    if (runs.length)
                        results.push(aggregate(config, runs));
                    break outer;
                }
                progress(`${config.id}: run ${run}/${opts.runs}…`);
                const scanId = cloneScan(db, baseId, spec.enableRules);
                const started = Date.now();
                await runLlmAnalysis(db, scanId, {
                    provider,
                    dataDir,
                    log: opts.log,
                    concurrency: opts.concurrency ?? 2,
                    useCache: false,
                });
                const result = scoreRun(db, scanId, expectedLlm, run, Date.now() - started);
                totalCostUsd += result.costUsd ?? 0;
                runs.push(result);
            }
            results.push(aggregate(config, runs));
        }
        return {
            site: spec.site,
            startedAt: new Date().toISOString(),
            expectedLlm,
            models: results,
            totalCostUsd,
            stoppedEarly,
        };
    }
    finally {
        await app.close();
        await site.close();
        await rm(dataDir, { recursive: true, force: true });
    }
}
/** A new scan with copies of the base scan's pages (screenshots are shared files). */
function cloneScan(db, baseId, enableRules) {
    const id = randomUUID();
    const base = db.select().from(scans).where(eq(scans.id, baseId)).get();
    const rows = db.select().from(pages).where(eq(pages.scanId, baseId)).all();
    const newIds = new Map(rows.map((p) => [p.id, randomUUID()]));
    db.transaction((tx) => {
        tx.insert(scans)
            .values({ ...base, id, createdAt: new Date().toISOString() })
            .run();
        for (const p of [...rows].sort((a, b) => a.crawlIndex - b.crawlIndex)) {
            tx.insert(pages)
                .values({
                ...p,
                id: newIds.get(p.id),
                scanId: id,
                parentPageId: p.parentPageId ? newIds.get(p.parentPageId) : null,
            })
                .run();
        }
    });
    snapshotScanRules(db, id, { enable: enableRules });
    return id;
}
function scoreRun(db, scanId, expected, run, scanMs) {
    const urlById = new Map(db
        .select()
        .from(pages)
        .where(eq(pages.scanId, scanId))
        .all()
        .map((p) => [p.id, p.url]));
    const actual = db
        .select()
        .from(findings)
        .where(and(eq(findings.scanId, scanId), eq(findings.detectedBy, 'llm')))
        .all()
        .map((f) => ({
        page: f.pageId ? pagePath(urlById.get(f.pageId)) : '/',
        rule: f.ruleId,
        evidence: f.evidenceText,
        detectedBy: 'llm',
    }));
    const comparison = compareFindings(expected, actual);
    const analyses = db.select().from(llmAnalyses).where(eq(llmAnalyses.scanId, scanId)).all();
    const tp = comparison.matched.length;
    const fp = comparison.unexpected.length;
    const fn = comparison.missing.length;
    const costs = analyses.map((a) => a.costUsd);
    return {
        run,
        comparison,
        tp,
        fp,
        fn,
        precision: precision(tp, fp),
        recall: recall(tp, fn),
        pages: analyses.length,
        failedPages: analyses.filter((a) => a.status === 'error').length,
        retries: analyses.filter((a) => a.attempts > 1).length,
        latencyMsPerPage: analyses.map((a) => a.latencyMs),
        scanMs,
        inputTokens: analyses.reduce((s, a) => s + a.inputTokens + a.cacheReadTokens + a.cacheWriteTokens, 0),
        outputTokens: analyses.reduce((s, a) => s + a.outputTokens, 0),
        costUsd: costs.some((c) => c === null) ? null : costs.reduce((s, c) => s + (c ?? 0), 0),
        servedModels: [...new Set(analyses.flatMap((a) => (a.servedModel ? [a.servedModel] : [])))],
    };
}
function aggregate(config, runs) {
    const pick = (f) => summarize(runs.map(f));
    return {
        config,
        runs,
        precision: pick((r) => r.precision),
        recall: pick((r) => r.recall),
        tp: pick((r) => r.tp),
        fp: pick((r) => r.fp),
        fn: pick((r) => r.fn),
        failedPages: pick((r) => r.failedPages),
        retries: pick((r) => r.retries),
        latencyMeanMs: pick((r) => r.latencyMsPerPage.length
            ? r.latencyMsPerPage.reduce((a, b) => a + b, 0) / r.latencyMsPerPage.length
            : null),
        latencyP95Ms: pick((r) => percentile(r.latencyMsPerPage, 95)),
        scanMs: pick((r) => r.scanMs),
        inputTokens: pick((r) => r.inputTokens),
        outputTokens: pick((r) => r.outputTokens),
        costUsd: pick((r) => r.costUsd),
    };
}
//# sourceMappingURL=harness.js.map