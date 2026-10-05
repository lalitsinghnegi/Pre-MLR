import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PageSummarySchema, ScanSchema, type Scan } from '@pre-mlr/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { CrawlFn } from '../src/scans/runner.js';
import { createDb, runMigrations, type Db } from '../src/db/client.js';
import { linkChecks, pages, scans } from '../src/db/schema.js';
import { signIn, type Api } from './helpers/auth.js';
import { serveStatic, type StaticSite } from './helpers/static-server.js';

const FIXTURE = join(import.meta.dirname, 'fixtures/crawl-site');

/** Link checks may only reach the local fixture server; everything else is a 404. */
const localOnlyFetch: typeof fetch = (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  return url.startsWith('http://127.0.0.1:')
    ? fetch(input, init)
    : Promise.resolve(new Response(null, { status: 404 }));
};

describe('scans API', { timeout: 60_000 }, () => {
  let site: StaticSite;
  let dataDir: string;
  let app: FastifyInstance;
  let api: Api;
  let db: Db;

  beforeAll(async () => {
    site = await serveStatic(FIXTURE);
  });
  afterAll(() => site?.close());

  async function start(crawl?: CrawlFn, seed?: (db: Db) => void, env: Record<string, string> = {}) {
    dataDir = await mkdtemp(join(tmpdir(), 'pre-mlr-api-'));
    db = createDb(':memory:');
    if (seed) {
      runMigrations(db);
      seed(db);
    }
    app = await buildApp({
      config: loadConfig({
        LOG_LEVEL: 'silent',
        DATA_DIR: dataDir,
        SCAN_PRIVATE_ALLOWLIST: new URL(site.url).host,
        ...env,
      }),
      db,
      crawl,
      fetchImpl: localOnlyFetch,
    });
    api = await signIn(app, db);
  }
  afterEach(async () => {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const getScan = async (id: string) =>
    ScanSchema.parse((await api({ method: 'GET', url: `/api/scans/${id}` })).json());

  async function waitForScan(id: string): Promise<Scan> {
    await app.scanRunner.idle();
    return getScan(id);
  }

  it('starts a scan, reports progress, and stores pages with screenshots', async () => {
    await start();
    const res = await api({
      method: 'POST',
      url: '/api/scans',
      payload: { startUrl: `${site.url}/`, maxPages: 4, maxDepth: 2 },
    });
    expect(res.statusCode).toBe(202);
    const created = ScanSchema.parse(res.json());
    expect(created).toMatchObject({ status: 'queued', maxPages: 4, maxDepth: 2, pagesCrawled: 0 });

    const done = await waitForScan(created.id);
    expect(done).toMatchObject({ status: 'completed', pagesCrawled: 4, error: null });
    expect(done.startedAt).not.toBeNull();
    expect(done.finishedAt).not.toBeNull();

    const pagesRes = await api({ method: 'GET', url: `/api/scans/${created.id}/pages` });
    const list = PageSummarySchema.array().parse(pagesRes.json());
    expect(list.map((p) => new URL(p.url).pathname)).toEqual([
      '/',
      '/about',
      '/products',
      '/missing',
    ]);
    expect(list[0]).toMatchObject({ depth: 0, parentPageId: null, title: 'Home | Crawl Fixture' });
    expect(list[0]!.screenshots).toEqual({ desktop: true, mobile: true });
    expect(list[3]).toMatchObject({
      httpStatus: 404,
      screenshots: { desktop: false, mobile: false },
    });

    // Link checks skip the scanned site's robots-disallowed URLs (/private/secret).
    const checked = db
      .select()
      .from(linkChecks)
      .all()
      .map((l) => new URL(l.url).pathname);
    expect(checked).not.toContain('/private/secret');

    // Screenshot paths are stored relative to DATA_DIR and the files exist there.
    const row = db
      .select()
      .from(pages)
      .all()
      .find((p) => p.crawlIndex === 0)!;
    expect(row.desktopScreenshotPath).toBe(join('scans', created.id, `${row.id}-desktop.png`));
    expect(existsSync(join(dataDir, row.desktopScreenshotPath!))).toBe(true);
    expect(existsSync(join(dataDir, row.mobileScreenshotPath!))).toBe(true);
  });

  it('applies default limits', async () => {
    await start(async () => {});
    const res = await api({
      method: 'POST',
      url: '/api/scans',
      payload: { startUrl: 'https://example.com' },
    });
    expect(res.json()).toMatchObject({ maxPages: 25, maxDepth: 3 });
  });

  it.each([
    [{}],
    [{ startUrl: 'not a url' }],
    [{ startUrl: 'ftp://example.com/' }],
    [{ startUrl: 'file:///etc/passwd' }],
    [{ startUrl: 'https://example.com', maxPages: 0 }],
    [{ startUrl: 'https://example.com', maxPages: 201 }],
    [{ startUrl: 'https://example.com', maxDepth: 11 }],
    [{ startUrl: 'https://example.com', maxDepth: 1.5 }],
  ])('rejects invalid input %j', async (payload) => {
    await start(async () => {});
    const res = await api({ method: 'POST', url: '/api/scans', payload });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for unknown scans', async () => {
    await start(async () => {});
    expect((await api({ method: 'GET', url: '/api/scans/nope' })).statusCode).toBe(404);
    expect((await api({ method: 'GET', url: '/api/scans/nope/pages' })).statusCode).toBe(404);
  });

  it('marks a scan failed when the crawl throws', async () => {
    await start(async () => {
      throw new Error('browser exploded');
    });
    const { id } = (
      await api({
        method: 'POST',
        url: '/api/scans',
        payload: { startUrl: 'https://example.com' },
      })
    ).json();
    // Users get a short reason; the raw error (which can include paths) stays in the server log.
    expect(await waitForScan(id)).toMatchObject({
      status: 'failed',
      error: 'Scan failed because of an internal error. The details are in the server log.',
    });
  });

  it('runs scans one at a time in order', async () => {
    const order: string[] = [];
    let active = 0;
    await start(
      async ({ startUrl }) => {
        expect(++active).toBe(1);
        order.push(startUrl);
        await new Promise((r) => setTimeout(r, 20));
        active--;
      },
      undefined,
      { MAX_ACTIVE_SCANS_PER_USER: '5' },
    );
    for (const n of [1, 2, 3]) {
      await api({
        method: 'POST',
        url: '/api/scans',
        payload: { startUrl: `https://example.com/${n}` },
      });
    }
    await app.scanRunner.idle();
    expect(order).toEqual([
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
    ]);
  });

  it('on startup, fails interrupted scans and resumes queued ones', async () => {
    const base = {
      startUrl: 'https://example.com/',
      maxPages: 5,
      maxDepth: 1,
      createdAt: new Date().toISOString(),
    };
    const crawled: string[] = [];
    await start(
      async ({ startUrl }) => {
        crawled.push(startUrl);
      },
      (seedDb) => {
        seedDb
          .insert(scans)
          .values([
            { ...base, id: 'was-running', status: 'running' },
            { ...base, id: 'was-queued', status: 'queued', startUrl: 'https://example.com/q' },
          ])
          .run();
      },
    );
    expect(await getScan('was-running')).toMatchObject({
      status: 'failed',
      error: 'Interrupted by server restart',
    });
    expect(await waitForScan('was-queued')).toMatchObject({ status: 'completed' });
    expect(crawled).toEqual(['https://example.com/q']);
  });

  describe('limits and targets', () => {
    /** A crawl that holds its scan "running" until released. */
    function blockingCrawl() {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      return { crawl: (async () => gate) as CrawlFn, release };
    }
    const post = (as: Api, startUrl = 'https://example.com/') =>
      as({ method: 'POST', url: '/api/scans', payload: { startUrl } });

    it('limits scans per user and across everyone', async () => {
      const { crawl, release } = blockingCrawl();
      await start(crawl, undefined, { MAX_QUEUED_SCANS: '3', MAX_ACTIVE_SCANS_PER_USER: '2' });
      const other = await signIn(app, db, 'author', 'Sam Other');
      expect((await post(api)).statusCode).toBe(202);
      expect((await post(api)).statusCode).toBe(202);
      const mine = await post(api);
      expect(mine.statusCode).toBe(429);
      expect(mine.json().error).toBe(
        'You already have 2 scans waiting or running. Try again when one finishes.',
      );
      expect((await post(other)).statusCode).toBe(202);
      const full = await post(other);
      expect(full.statusCode).toBe(429);
      expect(full.json().error).toMatch(/The scan queue is full \(3 scans waiting or running\)/);
      release();
      await app.scanRunner.idle();
      expect((await post(api)).statusCode).toBe(202);
      await app.scanRunner.idle();
    });

    it('refuses internal start URLs unless allowlisted', async () => {
      await start(async () => {});
      for (const url of [
        'http://127.0.0.1:8000/',
        'http://169.254.169.254/latest/meta-data/',
        'http://[::1]/',
        'http://10.0.0.8/',
      ]) {
        const res = await post(api, url);
        expect(res.statusCode, url).toBe(400);
        expect(res.json().error).toMatch(
          /^Blocked: private network address: scans can't reach internal hosts/,
        );
      }
      expect((await post(api, `${site.url}/`)).statusCode).toBe(202);
      await app.scanRunner.idle();
    });

    it('stops a scan that runs too long', async () => {
      const { createScan } = await import('../src/scans/create.js');
      const { ScanRunner } = await import('../src/scans/runner.js');
      const { NetworkGuard } = await import('../src/net/guard.js');
      await start(async () => {});
      const guard = new NetworkGuard();
      const runner = new ScanRunner(db, dataDir, app.log, {
        guard,
        timeoutMs: 50,
        crawl: async ({ signal }) =>
          new Promise((_, reject) =>
            signal!.addEventListener('abort', () => reject(signal!.reason)),
          ),
      });
      const row = createScan(
        db,
        runner,
        { startUrl: 'https://example.com/', maxPages: 1, maxDepth: 0 },
        'tester',
      );
      await runner.idle();
      expect(db.select().from(scans).where(eq(scans.id, row.id)).get()).toMatchObject({
        status: 'failed',
        error: 'Scan stopped: it ran longer than 1 second.',
      });
      await guard.close();
    });
  });
});
