import { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { type Db } from './db/client.js';
import type { LLMProvider } from './llm/types.js';
import { type Embedder } from './precedent/embed.js';
import { ScanRunner, type CrawlFn } from './scans/runner.js';
export interface BuildAppOptions {
    config: Config;
    /** Inject a database (tests use ':memory:'). Defaults to config.DATABASE_URL. */
    db?: Db;
    /** Replace the Playwright crawler (tests). */
    crawl?: CrawlFn;
    /** Replace fetch for link checks (tests). */
    fetchImpl?: typeof fetch;
    /** Replace the configured LLM provider (tests); null disables the LLM step. */
    llm?: LLMProvider | null;
    /** Replace the configured embedder (tests); null disables precedent matching. */
    embedder?: Embedder | null;
}
/** Builds the app without listening, so tests can use `app.inject()`. */
export declare function buildApp({ config, db, crawl, fetchImpl, llm, embedder, }: BuildAppOptions): Promise<FastifyInstance>;
declare module 'fastify' {
    interface FastifyInstance {
        scanRunner: ScanRunner;
    }
}
