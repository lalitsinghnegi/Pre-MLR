import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FindingViewSchema, ScanSummarySchema, type FindingView } from '@pre-mlr/shared';
import { auditFor } from '../src/audit/log.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb, type Db } from '../src/db/client.js';
import { pages, scans } from '../src/db/schema.js';
import { recordFindings } from '../src/findings/service.js';
import { snapshotScanRules } from '../src/rules/repository.js';
import { signIn, type Api } from './helpers/auth.js';

describe('review API', () => {
  let app: FastifyInstance;
  let api: Api;
  let db: Db;
  let dataDir: string;
  let ids: string[];

  beforeEach(async () => {
    sessions.clear();
    dataDir = await mkdtemp(join(tmpdir(), 'pre-mlr-review-'));
    db = createDb(':memory:');
    app = await buildApp({
      config: loadConfig({ LOG_LEVEL: 'silent', DATA_DIR: dataDir }),
      db,
      crawl: async () => {},
    });
    api = await signIn(app, db);

    const now = new Date().toISOString();
    db.insert(scans)
      .values([
        {
          id: 's1',
          startUrl: 'https://examplin.test/',
          maxPages: 5,
          maxDepth: 1,
          status: 'completed',
          createdAt: '2026-10-01T00:00:00Z',
        },
        {
          id: 's2',
          startUrl: 'https://other.test/',
          maxPages: 5,
          maxDepth: 1,
          status: 'running',
          createdAt: '2026-10-02T00:00:00Z',
        },
      ])
      .run();
    await mkdir(join(dataDir, 'scans/s1'), { recursive: true });
    await writeFile(
      join(dataDir, 'scans/s1/home-desktop.png'),
      Buffer.from('89504e470d0a1a0a', 'hex'),
    );
    db.insert(pages)
      .values([
        {
          id: 'home',
          scanId: 's1',
          crawlIndex: 0,
          depth: 0,
          url: 'https://examplin.test/',
          title: 'Home',
          crawledAt: now,
          desktopScreenshotPath: 'scans/s1/home-desktop.png',
          mobileScreenshotPath: 'scans/s1/missing.png',
        },
        {
          id: 'about',
          scanId: 's1',
          crawlIndex: 1,
          depth: 1,
          url: 'https://examplin.test/about',
          title: 'About',
          crawledAt: now,
          desktopScreenshotPath: '../../../etc/hosts',
        },
        {
          id: 'other',
          scanId: 's2',
          crawlIndex: 0,
          depth: 0,
          url: 'https://other.test/',
          crawledAt: now,
        },
      ])
      .run();
    snapshotScanRules(db, 's1');
    ids = recordFindings(
      db,
      's1',
      [
        {
          pageId: 'about',
          ruleId: 'alt-text',
          detectedBy: 'rules_engine',
          message: 'No alt',
          evidenceText: 'img.png',
        },
        {
          pageId: 'home',
          ruleId: 'superlatives',
          detectedBy: 'rules_engine',
          message: 'Superlative',
          evidenceText: 'the best',
          suggestedFix: 'an effective',
        },
        { pageId: 'home', ruleId: 'isi-present', detectedBy: 'rules_engine', message: 'No ISI' },
        {
          pageId: null,
          ruleId: 'privacy-link',
          detectedBy: 'rules_engine',
          message: 'No privacy link',
        },
      ],
      'rules_engine',
    ).created.map((f) => f.id);
  });
  afterEach(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const get = async (url: string) => api({ method: 'GET', url });
  /** A signed-in session per reviewer name, created on first use. */
  const sessions = new Map<string, Api>();
  const as = async (name: string) => {
    if (!sessions.has(name)) sessions.set(name, await signIn(app, db, 'author', name));
    return sessions.get(name)!;
  };
  const patch = async (id: string, payload: object, reviewer?: string) =>
    (reviewer ? await as(reviewer) : api)({
      method: 'PATCH',
      url: `/api/findings/${id}`,
      payload,
    });
  const findingsOf = async (scanId: string) =>
    FindingViewSchema.array().parse((await get(`/api/scans/${scanId}/findings`)).json());

  it('lists scans newest first with finding counts', async () => {
    const list = ScanSummarySchema.array().parse((await get('/api/scans')).json());
    expect(list.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(list[1]!.findings).toEqual({
      total: 4,
      byStatus: { open: 4, accepted: 0, rejected: 0, edited: 0 },
      openBySeverity: { critical: 1, major: 1, minor: 2, info: 0 },
    });
    expect(list[0]!.findings.total).toBe(0);
  });

  it('returns findings with page and rule details, site-wide first, then by page and severity', async () => {
    const list = await findingsOf('s1');
    expect(list.map((f) => [f.page?.number ?? null, f.ruleId])).toEqual([
      [null, 'privacy-link'],
      [1, 'isi-present'], // critical before major
      [1, 'superlatives'],
      [2, 'alt-text'],
    ]);
    expect(list[2]).toMatchObject({
      page: {
        id: 'home',
        number: 1,
        url: 'https://examplin.test/',
        title: 'Home',
        screenshots: { desktop: true, mobile: true },
      },
      rule: {
        title: 'No unsupported absolute or superlative language',
        category: 'claims',
        sourceCitation: '21 CFR 202.1(e)(6)(i)',
      },
    });
    expect((await get('/api/scans/nope/findings')).statusCode).toBe(404);
  });

  it('PATCH applies a change, records the reviewer and returns the updated view', async () => {
    const id = ids[1]!;
    const res = await patch(
      id,
      { editedFix: 'A proven option', expectedRevision: 1 },
      'Alice Reviewer',
    );
    expect(res.statusCode).toBe(200);
    const view: FindingView = FindingViewSchema.parse(res.json());
    expect(view).toMatchObject({
      status: 'edited',
      editedFix: 'A proven option',
      suggestedFix: 'an effective',
      revision: 2,
      updatedBy: 'Alice Reviewer',
    });
    expect(view.page?.id).toBe('home');
    expect(auditFor(db, 'finding', id).map((a) => [a.action, a.actor])).toEqual([
      ['created', 'rules_engine'],
      ['status_changed', 'Alice Reviewer'],
      ['fix_edited', 'Alice Reviewer'],
    ]);
  });

  it('PATCH records the signed-in user, ignores a claimed reviewer header, and validates input', async () => {
    const spoofed = await api({
      method: 'PATCH',
      url: `/api/findings/${ids[0]}`,
      payload: { status: 'accepted' },
      headers: { 'x-reviewer': 'Mallory' },
    });
    expect(spoofed.json().updatedBy).toBe('Pat Reviewer');
    const bad = await patch(ids[0]!, { status: 'edited' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/needs an editedFix/);
    expect((await patch(ids[0]!, {})).statusCode).toBe(400);
    expect((await patch('nope', { status: 'accepted' })).statusCode).toBe(404);
  });

  it('PATCH with a stale revision returns 409 and the current finding', async () => {
    await patch(ids[0]!, { status: 'accepted', expectedRevision: 1 }, 'alice');
    const res = await patch(ids[0]!, { status: 'rejected', expectedRevision: 1 }, 'bob');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: expect.stringMatching(/changed by someone else/),
      current: { status: 'accepted', revision: 2, updatedBy: 'alice' },
    });
  });

  it('bulk updates all items in one go and logs each', async () => {
    const res = await (
      await as('carol')
    )({
      method: 'POST',
      url: '/api/findings/bulk',
      payload: {
        items: ids.slice(0, 3).map((id) => ({ id, expectedRevision: 1 })),
        status: 'rejected',
        comment: 'Not applicable',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(
      FindingViewSchema.array()
        .parse(res.json())
        .map((f) => [f.status, f.authorComment, f.updatedBy]),
    ).toEqual(Array(3).fill(['rejected', 'Not applicable', 'carol']));
    for (const id of ids.slice(0, 3))
      expect(auditFor(db, 'finding', id).map((a) => a.action)).toEqual([
        'created',
        'status_changed',
        'commented',
      ]);
  });

  it('bulk is all-or-nothing: a stale item means nothing changes', async () => {
    await patch(ids[2]!, { status: 'accepted' }, 'alice');
    const res = await api({
      method: 'POST',
      url: '/api/findings/bulk',
      payload: { items: ids.map((id) => ({ id, expectedRevision: 1 })), status: 'rejected' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      stale: [ids[2]],
      current: [{ id: ids[2], status: 'accepted' }],
    });
    const statuses = (await findingsOf('s1')).map((f) => f.status).sort();
    expect(statuses).toEqual(['accepted', 'open', 'open', 'open']);
  });

  it('bulk rejects edited status, duplicates and unknown ids', async () => {
    const bulk = (payload: object) => api({ method: 'POST', url: '/api/findings/bulk', payload });
    expect(
      (await bulk({ items: [{ id: ids[0], expectedRevision: 1 }], status: 'edited' })).statusCode,
    ).toBe(400);
    expect(
      (
        await bulk({
          items: [
            { id: ids[0], expectedRevision: 1 },
            { id: ids[0], expectedRevision: 1 },
          ],
          status: 'accepted',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await bulk({ items: [{ id: 'nope', expectedRevision: 1 }], status: 'accepted' })).statusCode,
    ).toBe(404);
    expect((await bulk({ items: [], status: 'accepted' })).statusCode).toBe(400);
  });

  it('returns the audit history of a finding', async () => {
    await patch(ids[0]!, { comment: 'Looked at it' }, 'dave');
    const res = await get(`/api/findings/${ids[0]}/audit`);
    expect(res.json().map((a: { action: string; actor: string }) => [a.action, a.actor])).toEqual([
      ['created', 'rules_engine'],
      ['commented', 'dave'],
    ]);
    expect((await get('/api/findings/nope/audit')).statusCode).toBe(404);
  });

  it('serves screenshots only for pages of the scan, under DATA_DIR', async () => {
    const ok = await get('/api/scans/s1/pages/home/screenshot/desktop');
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.rawPayload.toString('hex')).toBe('89504e470d0a1a0a');
    for (const url of [
      '/api/scans/s1/pages/home/screenshot/mobile', // file missing
      '/api/scans/s1/pages/about/screenshot/desktop', // path escapes DATA_DIR
      '/api/scans/s2/pages/home/screenshot/desktop', // page belongs to another scan
      '/api/scans/s1/pages/home/screenshot/print', // unknown view
    ]) {
      expect((await get(url)).statusCode, url).toBe(404);
    }
  });
});
