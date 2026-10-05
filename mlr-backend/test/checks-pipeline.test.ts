import { signIn, type Api } from './helpers/auth.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { runDeterministicChecks } from '../src/checks/run.js';
import { loadConfig } from '../src/config.js';
import { createDb, type Db } from '../src/db/client.js';
import { findings, linkChecks, pages } from '../src/db/schema.js';
import { serveStatic, type StaticSite } from './helpers/static-server.js';

const FIXTURE = join(import.meta.dirname, 'fixtures/facts-site');

describe('scan → checks → findings (Playwright, facts fixture)', { timeout: 60_000 }, () => {
  let site: StaticSite;
  let app: FastifyInstance;
  let api: Api;
  let db: Db;
  let dataDir: string;
  let scanId: string;
  const outside: string[] = [];

  beforeAll(async () => {
    site = await serveStatic(FIXTURE);
    dataDir = await mkdtemp(join(tmpdir(), 'pre-mlr-checks-'));
    db = createDb(':memory:');
    const fetchImpl: typeof fetch = (input, init) => {
      const url = String(input);
      if (url.startsWith(site.url)) return fetch(input, init);
      outside.push(url);
      return Promise.resolve(new Response(null, { status: 404 }));
    };
    app = await buildApp({
      config: loadConfig({
        LOG_LEVEL: 'silent',
        DATA_DIR: dataDir,
        SCAN_PRIVATE_ALLOWLIST: new URL(site.url).host,
      }),
      db,
      fetchImpl,
    });
    api = await signIn(app, db);
    const res = await api({
      method: 'POST',
      url: '/api/scans',
      payload: {
        startUrl: `${site.url}/`,
        maxPages: 5,
        maxDepth: 1,
        product: { brandNames: ['Examplin'], establishedName: 'examplinumab' },
      },
    });
    scanId = res.json().id;
    await app.scanRunner.idle();
  });
  afterAll(async () => {
    await app?.close();
    await site?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const homeFindings = () => {
    const home = db
      .select()
      .from(pages)
      .where(eq(pages.scanId, scanId))
      .all()
      .find((p) => p.crawlIndex === 0)!;
    return db.select().from(findings).where(eq(findings.pageId, home.id)).all();
  };

  it('completes the scan with the product profile stored', async () => {
    const scan = (await api({ method: 'GET', url: `/api/scans/${scanId}` })).json();
    expect(scan).toMatchObject({ status: 'completed', product: { brandNames: ['Examplin'] } });
  });

  it('stores page facts from the desktop view', () => {
    const home = db
      .select()
      .from(pages)
      .where(eq(pages.scanId, scanId))
      .all()
      .find((p) => p.crawlIndex === 0)!;
    const texts = home.facts!.blocks.map((b) => b.text);
    expect(texts).toContain('Important Safety Information');
    expect(texts).not.toContain('Screen reader only text');
    expect(texts).not.toContain('Hidden paragraph');
    expect(home.facts!.images.map((i) => i.alt)).toEqual([null, '']);
  });

  it('flags exactly the planted problems on the home page', () => {
    const got = homeFindings()
      .map((f) => f.ruleId)
      .sort();
    expect(got).toEqual([
      'ae-reporting-statement', // ISI without the MedWatch statement
      'alt-text', // 120×80 image without alt
      'broken-links', // /x is a 404
      'established-name', // "Examplin" without "examplinumab"
      'footer-date-code', // no copyright/date/job code
      'isi-readability', // 9px #bbb on #f4f4f4
      'pi-link-present', // no Prescribing Information link
      'privacy-link', // no privacy link
      'superlatives', // "the best choice"
      'unreferenced-claims', // "2x faster" without a marker ("62% ... ¹" has a <sup>)
    ]);
    // Not flagged: ISI present, trademark on first mention, no comparative wording.
  });

  it('records evidence, location and rule version', () => {
    const byRule = new Map(homeFindings().map((f) => [f.ruleId, f]));
    expect(byRule.get('isi-readability')).toMatchObject({
      ruleVersion: 1,
      severity: 'major',
      detectedBy: 'rules_engine',
      status: 'open',
      evidenceText: 'Serious side effects may occur.',
      evidenceLocation: { view: 'desktop' },
    });
    expect(byRule.get('superlatives')!.evidenceText).toBe(
      'Examplin is the best choice for busy people.',
    );
    expect(byRule.get('unreferenced-claims')!.evidenceText).toBe(
      'Symptoms cleared 2x faster with treatment.',
    );
    expect(byRule.get('alt-text')!.evidenceLocation).toMatchObject({
      view: 'desktop',
      width: 120,
      height: 80,
    });
  });

  it('checked links without leaving the fixture site, and skipped LLM and disabled rules', () => {
    expect(outside).toEqual([]);
    const ruleIds = new Set(
      db
        .select()
        .from(findings)
        .all()
        .map((f) => f.ruleId),
    );
    expect(ruleIds.has('med-guide-link')).toBe(false); // disabled by default
    expect(ruleIds.has('risk-benefit-balance')).toBe(false); // LLM: Prompt 9
  });

  it('is idempotent: re-running checks adds nothing', async () => {
    const before = db.select().from(findings).all().length;
    const res = await runDeterministicChecks(db, scanId, {
      log: app.log,
      fetchImpl: () => Promise.reject(new Error('no network')),
    });
    expect(res).toMatchObject({ findingsCreated: 0, ruleErrors: [] });
    expect(db.select().from(findings).all()).toHaveLength(before);
    expect(db.select().from(linkChecks).all().length).toBe(0); // only crawled pages were linked
  });
});
