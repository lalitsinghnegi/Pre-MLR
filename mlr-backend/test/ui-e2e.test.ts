/**
 * Real-browser test of the review UI: backend + Vite frontend + the Examplin site, driven with
 * Playwright. Covers what jsdom can't (AG Grid selection, row focus, keyboard access) and checks
 * that every change lands in the audit log.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb, type Db } from '../src/db/client.js';
import { auditLog, findings } from '../src/db/schema.js';
import { signIn, TEST_PASSWORD } from './helpers/auth.js';
import { serveStatic, type StaticSite } from './helpers/static-server.js';

const ROOT = join(import.meta.dirname, '../..');
const REVIEWER = 'E2E Reviewer';

describe('review UI in a real browser', { timeout: 180_000 }, () => {
  let site: StaticSite;
  let app: FastifyInstance;
  let vite: ViteDevServer;
  let browser: Browser;
  let page: Page;
  let db: Db;
  let dataDir: string;
  let scanId: string;
  let frontend: string;
  const consoleErrors: string[] = [];

  beforeAll(async () => {
    site = await serveStatic(join(ROOT, 'test-sites/examplin'));
    dataDir = await mkdtemp(join(tmpdir(), 'pre-mlr-ui-'));
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
      embedder: null,
    });
    const backend = await app.listen({ port: 0, host: '127.0.0.1' });

    const api = await signIn(app, db, 'author', REVIEWER);
    const res = await api({
      method: 'POST',
      url: '/api/scans',
      payload: {
        startUrl: `${site.url}/`,
        product: { brandNames: ['Examplin'], establishedName: 'examplitide' },
        rules: { enable: ['med-guide-link'] },
      },
    });
    scanId = res.json().id;
    await app.scanRunner.idle();

    vite = await createServer({
      root: join(ROOT, 'mlr-frontend'),
      configFile: join(ROOT, 'mlr-frontend/vite.config.ts'),
      logLevel: 'silent',
      clearScreen: false,
      // Keep the browser's Host header, as a same-origin deployment would (the API checks Origin).
      server: {
        host: '127.0.0.1',
        port: 0,
        proxy: { '/api': { target: backend, changeOrigin: false } },
      },
    });
    await vite.listen();
    frontend = vite.resolvedUrls!.local[0]!.replace(/\/$/, '');

    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(e.message));
    await page.goto(`${frontend}/scans/${scanId}`);
    // Signed out: the sign-in page replaces the review page until the user signs in.
    await page.getByLabel('Name').fill(REVIEWER);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText('Showing 18 of 18 findings').waitFor({ timeout: 30_000 });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await vite?.close();
    await app?.close();
    await site?.close();
    await rm(dataDir, { recursive: true, force: true });
  }, 30_000);

  const status = () => page.getByRole('status');
  const findingBy = (rule: string, evidence?: string) =>
    db
      .select()
      .from(findings)
      .where(eq(findings.scanId, scanId))
      .all()
      .find((f) => f.ruleId === rule && (!evidence || f.evidenceText?.includes(evidence)))!;
  const actorsOf = (id: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'finding'), eq(auditLog.entityId, id)))
      .all()
      .map((a) => `${a.action}:${a.actor}`);

  it('clicking a row shows the screenshot with the evidence highlighted', async () => {
    await page
      .locator('.ag-row', { hasText: 'the best inhaler' })
      .locator('[col-id=evidence]')
      .click();
    const preview = page.getByRole('complementary', { name: 'Finding details' });
    await preview
      .getByRole('heading', { name: 'No unsupported absolute or superlative language' })
      .waitFor();
    const box = preview.getByTestId('evidence-box');
    await box.waitFor();
    const size = await box.boundingBox();
    expect(size!.width).toBeGreaterThan(10);
    expect(size!.height).toBeGreaterThan(2);
    const loaded = await preview
      .getByRole('img', { name: /desktop screenshot/ })
      .evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(loaded).toBe(1440);
  });

  it('accepting from the grid updates the row and the audit log', async () => {
    await page
      .getByRole('button', {
        name: 'Accept: No unsupported absolute or superlative language on #1 /',
      })
      .click();
    await status().filter({ hasText: 'Accepted: No unsupported' }).waitFor();
    await page
      .locator('.ag-row', { hasText: 'the best inhaler' })
      .getByText('Accepted')
      .first()
      .waitFor();
    const f = findingBy('superlatives', 'the best inhaler');
    expect(f).toMatchObject({ status: 'accepted', updatedBy: REVIEWER, revision: 2 });
    expect(actorsOf(f.id)).toEqual(['created:rules_engine', `status_changed:${REVIEWER}`]);
  });

  it('works by keyboard: groups toggle, arrows move the preview, Tab reaches row actions', async () => {
    const homeGroup = page.getByRole('button', { name: /#1 \/ · Home/ });
    await page.getByRole('checkbox', { name: 'Group by page' }).focus();
    await page.keyboard.press('Tab'); // into the grid header
    await page.keyboard.press('ArrowDown'); // first group row
    await page.keyboard.press('Enter');
    await expect.poll(() => homeGroup.getAttribute('aria-expanded')).toBe('false');
    await page.keyboard.press('Enter');
    await expect.poll(() => homeGroup.getAttribute('aria-expanded')).toBe('true');

    await page.keyboard.press('ArrowDown'); // superlatives (accepted above)
    await page.keyboard.press('ArrowDown'); // unreferenced "75%"
    const preview = page.getByRole('complementary', { name: 'Finding details' });
    await preview
      .getByRole('heading', { name: 'Numeric efficacy claims are referenced' })
      .waitFor();

    for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight'); // to the Actions column
    await page.keyboard.press('Tab');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
      .toBe('Accept: Numeric efficacy claims are referenced on #1 /');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter'); // Reject
    await status().filter({ hasText: 'Rejected: Numeric efficacy' }).waitFor();
    expect(findingBy('unreferenced-claims', '75%')).toMatchObject({
      status: 'rejected',
      updatedBy: REVIEWER,
    });
  });

  it('edits a fix through the dialog', async () => {
    await page.getByRole('button', { name: 'Edit fix: Images have alt text on #1 /' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit suggested fix' });
    await dialog.getByLabel('Your fix').fill('Add alt="Person breathing easily outdoors".');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await status().filter({ hasText: 'Fix edited' }).waitFor();
    const f = findingBy('alt-text');
    expect(f).toMatchObject({
      status: 'edited',
      editedFix: 'Add alt="Person breathing easily outdoors".',
    });
    expect(f.suggestedFix).toMatch(/^Add alt text describing/); // original kept
    expect(actorsOf(f.id)).toEqual([
      'created:rules_engine',
      `status_changed:${REVIEWER}`,
      `fix_edited:${REVIEWER}`,
    ]);
  });

  it('bulk-rejects the selected findings of one page with a comment', async () => {
    await page.getByLabel('Page', { exact: true }).selectOption({ label: '#7 /faq' });
    await page.getByText('Showing 3 of 18 findings').waitFor();
    await page.locator('.ag-header-select-all').first().click();
    await page.getByText('3 selected').waitFor();
    await page.getByRole('button', { name: 'Reject selected' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rejected 3 findings' });
    await dialog.getByLabel('Comment (optional)').fill('FAQ is out of scope');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await status().filter({ hasText: 'Rejected 3 findings.' }).waitFor();

    const faq = db
      .select()
      .from(findings)
      .where(eq(findings.scanId, scanId))
      .all()
      .filter((f) => f.authorComment === 'FAQ is out of scope');
    expect(faq).toHaveLength(3);
    expect(faq.every((f) => f.status === 'rejected' && f.updatedBy === REVIEWER)).toBe(true);
  });

  it('logged nothing to the browser console', () => {
    expect(consoleErrors).toEqual([]);
  });
});
