import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScanSchema } from '@pre-mlr/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { auditLog, findings, pages, scanRules, scans } from '../src/db/schema.js';
import { recordFindings } from '../src/findings/service.js';
import type { CrawlFn } from '../src/scans/runner.js';
import { signIn, type Api } from './helpers/auth.js';
import { migratedDb } from './helpers/model.js';

describe('deleting and re-running scans', () => {
  let app: FastifyInstance;
  let db: Db;
  let dataDir: string;
  let author: Api;
  let other: Api;
  let admin: Api;
  let release: (() => void) | null;

  /** Crawls one page and writes its screenshot; can be held "running" until released. */
  const crawl: CrawlFn = async (opts, onPage) => {
    await mkdir(opts.screenshotDir, { recursive: true });
    await writeFile(join(opts.screenshotDir, 'p-desktop.png'), 'png');
    await onPage({
      id: `${opts.screenshotDir.split('/').pop()}-page`,
      crawlIndex: 0,
      url: opts.startUrl,
      depth: 0,
      parentId: null,
      title: 'Home',
      text: 'Hello',
      links: [],
      facts: null,
      httpStatus: 200,
      desktopScreenshot: 'p-desktop.png',
      mobileScreenshot: null,
      error: null,
    });
    if (release === null) await new Promise<void>((r) => (release = r));
  };

  beforeEach(async () => {
    release = () => {};
    dataDir = await mkdtemp(join(tmpdir(), 'pre-mlr-manage-'));
    db = migratedDb();
    app = await buildApp({
      config: loadConfig({ LOG_LEVEL: 'silent', DATA_DIR: dataDir }),
      db,
      crawl,
      llm: null,
      embedder: null,
      fetchImpl: async () => new Response(''),
    });
    author = await signIn(app, db, 'author', 'Pat Author');
    other = await signIn(app, db, 'author', 'Sam Other');
    admin = await signIn(app, db, 'rule_admin', 'Robin Admin');
  });
  afterEach(async () => {
    release?.();
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const startScan = async (as: Api, body: object = {}) => {
    const res = await as({
      method: 'POST',
      url: '/api/scans',
      payload: { startUrl: 'https://examplin.test/', ...body },
    });
    expect(res.statusCode).toBe(202);
    return ScanSchema.parse(res.json());
  };
  const del = (as: Api, id: string) => as({ method: 'DELETE', url: `/api/scans/${id}` });
  const rerun = (as: Api, id: string) => as({ method: 'POST', url: `/api/scans/${id}/rerun` });

  it('deletes a scan with everything it owns, but keeps the audit history', async () => {
    const scan = await startScan(author);
    await app.scanRunner.idle();
    const [finding] = recordFindings(
      db,
      scan.id,
      [{ pageId: null, ruleId: 'superlatives', detectedBy: 'rules_engine', message: 'Best.' }],
      'rules_engine',
    ).created;
    const findingCount = db.select().from(findings).all().length;
    expect(findingCount).toBeGreaterThan(0);
    const dir = join(dataDir, 'scans', scan.id);
    expect(existsSync(join(dir, 'p-desktop.png'))).toBe(true);

    expect((await del(author, scan.id)).statusCode).toBe(204);
    expect(db.select().from(scans).all()).toEqual([]);
    expect(db.select().from(pages).all()).toEqual([]);
    expect(db.select().from(findings).all()).toEqual([]);
    expect(db.select().from(scanRules).all()).toEqual([]);
    expect(existsSync(dir)).toBe(false);
    const audit = db.select().from(auditLog).all();
    expect(audit.some((a) => a.entityId === finding!.id && a.action === 'created')).toBe(true);
    expect(audit.find((a) => a.action === 'scan_deleted')).toMatchObject({
      entityType: 'scan',
      entityId: scan.id,
      actor: 'Pat Author',
      changes: { startUrl: ['https://examplin.test/', null], findings: [findingCount, null] },
    });
    expect((await author(`/api/scans/${scan.id}`)).statusCode).toBe(404);
    expect((await del(author, scan.id)).statusCode).toBe(404);
  });

  it("lets only the scan's creator or a rule admin delete it", async () => {
    const scan = await startScan(author);
    await app.scanRunner.idle();
    const denied = await del(other, scan.id);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toMatch(/Only the person who started this scan, or a rule admin/);
    expect((await del(admin, scan.id)).statusCode).toBe(204);

    // Scans from before sign-in have no creator: only rule admins can delete them.
    db.insert(scans)
      .values({
        id: 'legacy',
        startUrl: 'https://old.test/',
        maxPages: 5,
        maxDepth: 1,
        status: 'completed',
        createdAt: new Date().toISOString(),
      })
      .run();
    expect((await del(author, 'legacy')).statusCode).toBe(403);
    expect((await del(admin, 'legacy')).statusCode).toBe(204);
  });

  it('refuses to delete a running scan; a queued one is dropped and never runs', async () => {
    release = null; // hold the first scan in "running"
    const running = await startScan(author);
    const queued = await startScan(admin);
    await new Promise((r) => setTimeout(r, 50));
    const busy = await del(author, running.id);
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error).toMatch(/running/);
    expect((await del(admin, queued.id)).statusCode).toBe(204);
    release!();
    await app.scanRunner.idle();
    expect(db.select({ id: scans.id, status: scans.status }).from(scans).all()).toEqual([
      { id: running.id, status: 'completed' },
    ]);
  });

  it('re-runs a scan as a new scan with the same settings and rule choices', async () => {
    const old = await startScan(author, {
      maxPages: 7,
      maxDepth: 2,
      product: { brandNames: ['Examplin'], establishedName: 'examplitide' },
      rules: { enable: ['med-guide-link'], disable: ['superlatives'] },
    });
    await app.scanRunner.idle();
    const res = await rerun(other, old.id);
    expect(res.statusCode).toBe(202);
    const fresh = ScanSchema.parse(res.json());
    expect(fresh.id).not.toBe(old.id);
    expect(fresh).toMatchObject({
      startUrl: old.startUrl,
      maxPages: 7,
      maxDepth: 2,
      product: { brandNames: ['Examplin'], establishedName: 'examplitide' },
      createdBy: 'Sam Other',
    });
    await app.scanRunner.idle();
    const enabled = (id: string) =>
      Object.fromEntries(
        db
          .select()
          .from(scanRules)
          .where(eq(scanRules.scanId, id))
          .all()
          .map((r) => [r.ruleId, r.enabled]),
      );
    expect(enabled(fresh.id)).toEqual(enabled(old.id));
    expect(enabled(fresh.id)).toMatchObject({ 'med-guide-link': true, superlatives: false });
    // The old scan is untouched.
    expect(db.select().from(scans).where(eq(scans.id, old.id)).get()!.status).toBe('completed');
    expect(
      db
        .select()
        .from(auditLog)
        .all()
        .find((a) => a.action === 'scan_rerun'),
    ).toMatchObject({
      entityId: fresh.id,
      actor: 'Sam Other',
      changes: { rerunOf: [null, old.id] },
    });
    expect((await rerun(author, 'nope')).statusCode).toBe(404);
  });

  it('applies the usual limits and target checks to re-runs', async () => {
    const old = await startScan(author);
    await app.scanRunner.idle();
    release = null;
    expect((await rerun(author, old.id)).statusCode).toBe(202);
    expect((await rerun(author, old.id)).statusCode).toBe(202);
    const limited = await rerun(author, old.id);
    expect(limited.statusCode).toBe(429);
    release!();
    await app.scanRunner.idle();

    db.update(scans).set({ startUrl: 'http://127.0.0.1:9/' }).where(eq(scans.id, old.id)).run();
    const blocked = await rerun(author, old.id);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error).toMatch(/^Blocked: private network address/);
  });
});
