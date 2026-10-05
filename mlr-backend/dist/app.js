import cors from '@fastify/cors';
import Fastify from 'fastify';
import { registerAuth } from './auth/plugin.js';
import { AppError, ForbiddenError } from './errors.js';
import { createDb, runMigrations } from './db/client.js';
import { authRoutes } from './routes/auth.js';
import { findingRoutes } from './routes/findings.js';
import { healthRoutes } from './routes/health.js';
import { precedentRoutes } from './routes/precedents.js';
import { reportRoutes } from './routes/report.js';
import { ruleRoutes } from './routes/rules.js';
import { createProvider } from './llm/factory.js';
import { NetworkGuard } from './net/guard.js';
import { createEmbedder } from './precedent/embed.js';
import { syncRulePack } from './rules/pack.js';
import { scanRoutes } from './routes/scans.js';
import { sitemapRoutes } from './routes/sitemap.js';
import { ScanRunner } from './scans/runner.js';
/** Builds the app without listening, so tests can use `app.inject()`. */
export async function buildApp({ config, db, crawl, fetchImpl, llm, embedder, }) {
    const app = Fastify({
        logger: {
            level: config.LOG_LEVEL,
            // Never log credentials, even if a serializer or debug log includes headers.
            redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        },
    });
    const database = db ?? createDb(config.DATABASE_URL);
    runMigrations(database);
    if (config.RULE_PACK_DIR) {
        const synced = await syncRulePack(database, config.RULE_PACK_DIR);
        app.log.info(synced, 'rule pack loaded');
        if (synced.skipped.length) {
            app.log.warn({ skipped: synced.skipped }, 'rule pack: some YAML rules are older than versions edited in the app and were skipped; export the app versions to update the files');
        }
    }
    const provider = llm === undefined ? createProvider(config) : llm;
    if (provider?.name === 'anthropic') {
        app.log.warn({ model: provider.model, ...provider.settings }, 'LLM analysis is ON: page text and screenshots are sent to the Anthropic API. Use public or fictional sites only.');
    }
    const guard = new NetworkGuard({ allow: config.SCAN_PRIVATE_ALLOWLIST });
    const runner = new ScanRunner(database, config.DATA_DIR, app.log, {
        guard,
        timeoutMs: config.SCAN_TIMEOUT_MINUTES * 60_000,
        crawl,
        fetchImpl,
        maxLinks: config.LINK_CHECK_MAX,
        llm: provider,
        llmConcurrency: config.LLM_CONCURRENCY,
        embedder: embedder === undefined ? createEmbedder(config) : embedder,
        precedentMaxAgeMonths: config.PRECEDENT_MAX_AGE_MONTHS,
    });
    runner.recover();
    app.decorate('scanRunner', runner);
    app.addHook('onClose', async () => {
        await runner.close();
        await guard.close();
        database.$client.close();
    });
    // Service errors carry their HTTP status; anything else is a 500 from Fastify's default handler.
    // Service errors carry their HTTP status and a message meant for users. Fastify's own client
    // errors (bad JSON, body too large) keep theirs. Anything else is logged in full and answered
    // with a generic message, so internal details (SQL, paths, stack) never reach the client.
    app.setErrorHandler((err, req, reply) => {
        if (err instanceof AppError) {
            return reply.code(err.statusCode).send({ error: err.message, details: err.details });
        }
        const e = err;
        if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
            return reply.code(e.statusCode).send({ error: e.message });
        }
        req.log.error({ err }, 'unhandled error');
        return reply.code(500).send({ error: 'Internal error', requestId: req.id });
    });
    app.addHook('onSend', async (req, reply) => {
        if (!req.url.startsWith('/api/'))
            return;
        reply.header('x-content-type-options', 'nosniff');
        reply.header('referrer-policy', 'no-referrer');
        reply.header('x-frame-options', 'DENY');
        if (!reply.hasHeader('content-security-policy')) {
            reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
        }
        // Review data shouldn't sit in shared or browser caches; screenshots set their own policy.
        if (!reply.hasHeader('cache-control'))
            reply.header('cache-control', 'no-store');
    });
    // A second line of defence against cross-site requests (the session cookie is already
    // SameSite=Strict): a state-changing request from a browser must come from this app's origin.
    app.addHook('onRequest', async (req) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method))
            return;
        const origin = req.headers.origin;
        if (!origin)
            return; // not from a browser form or script (curl, tests, same-origin GET)
        let host = null;
        try {
            host = new URL(origin).host;
        }
        catch {
            // fall through: an unparseable Origin is refused
        }
        if (origin !== config.CORS_ORIGIN && host !== req.headers.host) {
            throw new ForbiddenError('Request refused: it came from another site.');
        }
    });
    await app.register(cors, {
        origin: config.CORS_ORIGIN,
        methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
        credentials: true,
    });
    // Before the routes: every /api request except health and sign-in needs a session.
    await registerAuth(app, database);
    await app.register(authRoutes(database, config));
    await app.register(healthRoutes(database));
    await app.register(scanRoutes(database, runner, config, guard));
    await app.register(sitemapRoutes(database));
    await app.register(reportRoutes(database, config));
    await app.register(findingRoutes(database, config));
    await app.register(precedentRoutes(database));
    await app.register(ruleRoutes(database));
    return app;
}
//# sourceMappingURL=app.js.map