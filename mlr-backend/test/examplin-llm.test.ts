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
import { findings, llmAnalyses, pages } from '../src/db/schema.js';
import {
  compareFindings,
  formatComparison,
  loadExpectedFindings,
  pagePath,
  type ExpectedFindings,
} from '../src/eval/compare.js';
import { MockProvider } from '../src/llm/mock.js';
import { serveStatic, type StaticSite } from './helpers/static-server.js';

const SITE_DIR = join(import.meta.dirname, '../../test-sites/examplin');

describe('Examplin with the LLM layer (mock provider)', { timeout: 120_000 }, () => {
  let site: StaticSite;
  let app: FastifyInstance;
  let api: Api;
  let db: Db;
  let dataDir: string;
  let scanId: string;
  let spec: ExpectedFindings;

  beforeAll(async () => {
    spec = await loadExpectedFindings(join(SITE_DIR, 'expected-findings.yaml'));
    site = await serveStatic(SITE_DIR);
    dataDir = await mkdtemp(join(tmpdir(), 'pre-mlr-examplin-llm-'));
    db = createDb(':memory:');
    const fetchImpl: typeof fetch = (input, init) =>
      String(input).startsWith(site.url)
        ? fetch(input, init)
        : Promise.reject(new TypeError('fetch failed'));
    app = await buildApp({
      config: loadConfig({
        LOG_LEVEL: 'silent',
        DATA_DIR: dataDir,
        SCAN_PRIVATE_ALLOWLIST: new URL(site.url).host,
      }),
      db,
      fetchImpl,
      llm: new MockProvider(),
    });
    api = await signIn(app, db);
    const res = await api({
      method: 'POST',
      url: '/api/scans',
      payload: {
        startUrl: `${site.url}/`,
        product: spec.product,
        rules: { enable: spec.enableRules },
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

  const actual = () => {
    const urlById = new Map(
      db
        .select()
        .from(pages)
        .where(eq(pages.scanId, scanId))
        .all()
        .map((p) => [p.id, p.url]),
    );
    return db
      .select()
      .from(findings)
      .where(eq(findings.scanId, scanId))
      .all()
      .map((f) => ({
        page: f.pageId ? pagePath(urlById.get(f.pageId)!) : '/',
        rule: f.ruleId,
        evidence: f.evidenceText,
        detectedBy: f.detectedBy,
        location: f.evidenceLocation,
      }));
  };

  it('completes with every planted finding, deterministic and LLM, and nothing extra', async () => {
    expect((await api({ method: 'GET', url: `/api/scans/${scanId}` })).json()).toMatchObject({
      status: 'completed',
      phase: null,
    });
    const result = compareFindings(spec.expected, actual());
    expect(formatComparison(result)).toBe(
      formatComparison({ ...result, missing: [], unexpected: [] }),
    );
  });

  it('locates LLM evidence on the screenshot', () => {
    const llm = actual().filter((f) => f.detectedBy === 'llm');
    expect(llm.map((f) => f.rule).sort()).toEqual(['off-label-implied', 'risk-benefit-balance']);
    expect(llm.every((f) => f.location?.view === 'desktop')).toBe(true);
  });

  it('analyses every page except excluded ones and exposes page tips in the review API', async () => {
    const rows = db.select().from(llmAnalyses).where(eq(llmAnalyses.scanId, scanId)).all();
    expect(rows).toHaveLength(7); // 8 pages minus /privacy
    expect(rows.every((r) => r.status === 'ok' && r.pageTip)).toBe(true);
    const views = (await api({ method: 'GET', url: `/api/scans/${scanId}/findings` })).json();
    const dosing = views.find((f: { ruleId: string }) => f.ruleId === 'off-label-implied');
    expect(dosing.page.tip).toMatch(/Mock analysis: review 1 possible issue/);
  });
});
