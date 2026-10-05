import { signIn, type Api } from './helpers/auth.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb, type Db } from '../src/db/client.js';
import { findings, pages, scanRules } from '../src/db/schema.js';
import {
  compareFindings,
  formatComparison,
  loadExpectedFindings,
  pagePath,
  type ActualFinding,
  type ExpectedFindings,
} from '../src/eval/compare.js';
import { DEFAULT_RULE_PACK_DIR, loadRulePack } from '../src/rules/pack.js';
import { serveStatic, type StaticSite } from './helpers/static-server.js';

const SITE_DIR = join(import.meta.dirname, '../../test-sites/examplin');

describe('Examplin test site: scan matches expected findings', { timeout: 120_000 }, () => {
  let site: StaticSite;
  let app: FastifyInstance;
  let api: Api;
  let db: Db;
  let dataDir: string;
  let scanId: string;
  let spec: ExpectedFindings;
  let actual: ActualFinding[];
  const external: string[] = [];

  beforeAll(async () => {
    spec = await loadExpectedFindings(join(SITE_DIR, 'expected-findings.yaml'));
    site = await serveStatic(SITE_DIR);
    dataDir = await mkdtemp(join(tmpdir(), 'pre-mlr-examplin-'));
    db = createDb(':memory:');
    // Only the local site is reachable; anything else (the .invalid support site) fails like DNS would.
    const fetchImpl: typeof fetch = (input, init) => {
      const url = String(input);
      if (url.startsWith(site.url)) return fetch(input, init);
      external.push(url);
      return Promise.reject(
        new TypeError('fetch failed', {
          cause: new Error(`getaddrinfo ENOTFOUND ${new URL(url).host}`),
        }),
      );
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
        maxPages: 25,
        maxDepth: 3,
        product: spec.product,
        rules: { enable: spec.enableRules },
      },
    });
    expect(res.statusCode).toBe(202);
    scanId = res.json().id;
    await app.scanRunner.idle();

    const urlById = new Map(
      db
        .select()
        .from(pages)
        .where(eq(pages.scanId, scanId))
        .all()
        .map((p) => [p.id, p.url]),
    );
    actual = db
      .select()
      .from(findings)
      .where(eq(findings.scanId, scanId))
      .all()
      .map((f) => ({
        page: f.pageId ? pagePath(urlById.get(f.pageId)!) : '/',
        rule: f.ruleId,
        evidence: f.evidenceText,
        detectedBy: f.detectedBy,
      }));
  });
  afterAll(async () => {
    await app?.close();
    await site?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('crawls all 8 pages and completes', async () => {
    const scan = (await api({ method: 'GET', url: `/api/scans/${scanId}` })).json();
    expect(scan).toMatchObject({ status: 'completed', pagesCrawled: 8 });
    const paths = db
      .select()
      .from(pages)
      .where(eq(pages.scanId, scanId))
      .all()
      .map((p) => pagePath(p.url));
    expect(paths.sort()).toEqual([
      '/',
      '/dosing',
      '/faq',
      '/how-it-works',
      '/privacy',
      '/results',
      '/savings',
      '/side-effects',
    ]);
  });

  it('enables the per-scan rule overrides from the expected file', () => {
    const enabled = db
      .select()
      .from(scanRules)
      .where(eq(scanRules.scanId, scanId))
      .all()
      .filter((r) => r.enabled);
    expect(enabled.map((r) => r.ruleId)).toEqual(expect.arrayContaining(spec.enableRules));
  });

  it('finds exactly the expected deterministic findings', () => {
    const expected = spec.expected.filter((e) => e.detectedBy === 'rules_engine');
    const result = compareFindings(expected, actual);
    // On failure, the message lists what was missed and what was extra.
    expect(formatComparison(result)).toBe(
      formatComparison({ ...result, missing: [], unexpected: [] }),
    );
    expect(result.matched).toHaveLength(expected.length);
  });

  it('flags nothing on the clean control pages', () => {
    for (const page of spec.cleanPages) {
      expect(
        actual.filter((f) => f.page === page),
        page,
      ).toEqual([]);
    }
  });

  it('only contacted the fictional .invalid domain outside the site', () => {
    expect(external.every((u) => new URL(u).hostname.endsWith('.invalid'))).toBe(true);
    expect(external.length).toBeGreaterThan(0);
  });

  it('plants at least one expected finding for every rule in the pack', async () => {
    const pack = await loadRulePack(DEFAULT_RULE_PACK_DIR);
    const covered = new Set(spec.expected.map((e) => e.rule));
    const uncovered = pack.rules.map((r) => r.ruleId).filter((id) => !covered.has(id));
    expect(uncovered, 'add a planted flaw and an expected entry for each new rule').toEqual([]);
    for (const e of spec.expected) {
      const rule = pack.rules.find((r) => r.ruleId === e.rule);
      expect(rule, `unknown rule ${e.rule}`).toBeDefined();
      expect(e.detectedBy, e.rule).toBe(rule!.checkType === 'llm' ? 'llm' : 'rules_engine');
    }
  });
});
