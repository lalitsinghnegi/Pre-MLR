import { signIn, type Api } from './helpers/auth.js';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { extractText, getDocumentProxy } from 'unpdf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DISCLAIMER } from '@pre-mlr/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb, type Db } from '../src/db/client.js';
import { findingPrecedents, llmAnalyses, pages, scans, type NewPageRow } from '../src/db/schema.js';
import { recordFindings, updateFinding, type NewFinding } from '../src/findings/service.js';
import { snapshotScanRules } from '../src/rules/repository.js';
import { seedPrecedents } from './helpers/precedents.js';

async function png(dataDir: string, rel: string, width: number, height: number) {
  await mkdir(join(dataDir, 'scans/s1'), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: '#cfe3ff' } })
    .png()
    .toFile(join(dataDir, rel));
  return rel;
}

describe('PDF report with findings', { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  let api: Api;
  let db: Db;
  let dataDir: string;
  let text: string[];
  let res: Awaited<ReturnType<FastifyInstance['inject']>>;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'pre-mlr-report-'));
    db = createDb(':memory:');
    app = await buildApp({
      config: loadConfig({ LOG_LEVEL: 'silent', DATA_DIR: dataDir }),
      db,
      crawl: async () => {},
      llm: null,
    });
    api = await signIn(app, db);

    const now = '2026-10-03T10:00:00.000Z';
    db.insert(scans)
      .values([
        {
          id: 's1',
          startUrl: 'https://examplin.test/',
          maxPages: 25,
          maxDepth: 3,
          status: 'completed',
          pagesCrawled: 4,
          createdAt: now,
          startedAt: now,
          finishedAt: now,
        },
        {
          id: 'running',
          startUrl: 'https://examplin.test/',
          maxPages: 25,
          maxDepth: 3,
          status: 'running',
          createdAt: now,
        },
      ])
      .run();
    const base = {
      scanId: 's1',
      links: [],
      crawledAt: now,
      httpStatus: 200,
    } satisfies Partial<NewPageRow>;
    db.insert(pages)
      .values([
        {
          ...base,
          id: 'home',
          crawlIndex: 0,
          depth: 0,
          url: 'https://examplin.test/',
          title: 'Home | Examplin',
          desktopScreenshotPath: await png(dataDir, 'scans/s1/home-desktop.png', 1440, 900),
          mobileScreenshotPath: await png(dataDir, 'scans/s1/home-mobile.png', 390, 844),
        },
        {
          ...base,
          id: 'busy',
          crawlIndex: 1,
          depth: 1,
          parentPageId: 'home',
          url: 'https://examplin.test/busy',
          title: 'Busy | Examplin',
          desktopScreenshotPath: await png(dataDir, 'scans/s1/busy-desktop.png', 1440, 900),
        },
        {
          ...base,
          id: 'gone',
          crawlIndex: 2,
          depth: 1,
          parentPageId: 'home',
          url: 'https://examplin.test/gone',
          httpStatus: 404,
          error: 'HTTP 404',
        },
        {
          ...base,
          id: 'evil',
          crawlIndex: 3,
          depth: 1,
          parentPageId: 'home',
          url: 'https://examplin.test/evil',
          title: 'Evil',
          desktopScreenshotPath: '../../../../etc/hosts',
        },
      ])
      .run();

    snapshotScanRules(db, 's1');
    const f = (o: Partial<NewFinding> & Pick<NewFinding, 'ruleId'>): NewFinding => ({
      pageId: 'home',
      detectedBy: 'rules_engine',
      message: 'Problem.',
      ...o,
    });
    const created = recordFindings(
      db,
      's1',
      [
        f({
          ruleId: 'superlatives',
          evidenceText: 'The best inhaler.',
          evidenceLocation: { view: 'desktop', x: 100, y: 100, width: 500, height: 30 },
        }),
        f({ ruleId: 'alt-text', evidenceText: 'Image: hero.png', suggestedFix: 'Add alt text.' }),
        f({ ruleId: 'comparative-claims', evidenceText: 'REJECTED-EVIDENCE better than Brand X.' }),
        f({
          ruleId: 'off-label-implied',
          detectedBy: 'llm',
          confidence: 0.85,
          evidenceText: 'Also for seasonal allergies.',
        }),
        f({ ruleId: 'privacy-link', pageId: null, message: 'No privacy link on the site.' }),
        // A page with far more findings than one panel holds.
        ...Array.from({ length: 16 }, (_, i) =>
          f({
            ruleId: 'broken-links',
            pageId: 'busy',
            evidenceText: `Busy link ${i + 1} → https://examplin.test/old-page-number-${i + 1}-with-a-long-address`,
            suggestedFix: 'Fix or remove the link. '.repeat(4),
          }),
        ),
      ],
      'rules_engine',
    ).created;
    const byRule = (r: string) => created.find((x) => x.ruleId === r)!;
    updateFinding(db, byRule('superlatives').id, { status: 'accepted' }, 'Pat Reviewer');
    updateFinding(
      db,
      byRule('alt-text').id,
      { editedFix: 'Add alt="Person breathing easily".', comment: 'Agreed with brand.' },
      'Pat Reviewer',
    );
    updateFinding(db, byRule('comparative-claims').id, { status: 'rejected' }, 'Pat Reviewer');
    seedPrecedents(db, [
      {
        id: 'prec-1',
        text: '"Best-in-class" is a superlative we cannot support. Remove.',
        category: 'claims',
        brand: 'Fictorex',
        reviewerFunction: 'legal',
        commentedAt: '2025-03-04',
        status: 'accepted',
      },
      {
        id: 'prec-2',
        text: 'Same wording again: "Best-in-class" is a superlative.',
        category: 'claims',
      },
      { id: 'prec-rejected', text: 'PRECEDENT-OF-REJECTED finding.', category: 'claims' },
    ]);
    const link = (findingId: string, precedentId: string, rank: number) => ({
      findingId,
      precedentId,
      rank,
      similarity: 0.8,
      embedder: 'test',
      createdAt: now,
    });
    db.insert(findingPrecedents)
      .values([
        link(byRule('superlatives').id, 'prec-1', 1),
        link(byRule('superlatives').id, 'prec-2', 2),
        link(byRule('comparative-claims').id, 'prec-rejected', 1),
      ])
      .run();
    db.insert(llmAnalyses)
      .values({
        id: randomUUID(),
        scanId: 's1',
        pageId: 'home',
        cacheKey: 'k',
        provider: 'mock',
        model: 'mock-1',
        promptVersion: 'v1#x',
        status: 'ok',
        cached: false,
        attempts: 1,
        pageTip: 'Remove the allergy claim first.',
        createdAt: now,
      })
      .run();

    res = await api({ method: 'GET', url: '/api/scans/s1/report.pdf' });
    text = (await extractText(new Uint8Array(res.rawPayload), { mergePages: false })).text.map(
      (t) => t.replace(/\s+/g, ' '),
    );
  });
  afterAll(async () => {
    await app?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const pageOf = (pred: (t: string) => boolean) => text.findIndex(pred);

  it('returns a downloadable PDF in the expected order', async () => {
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="pre-mlr-report-examplin\.test-\d{4}-\d{2}-\d{2}\.pdf"$/,
    );
    const doc = await getDocumentProxy(new Uint8Array(res.rawPayload));
    expect(doc.numPages).toBe(text.length);
    const kinds = text.map((t) =>
      t.includes('Pre-MLR Check Report')
        ? 'title'
        : t.startsWith('Site map')
          ? 'sitemap'
          : t.startsWith('Findings summary')
            ? 'summary'
            : t.startsWith('Findings list')
              ? 'list'
              : /DESKTOP/.test(t)
                ? 'desktop'
                : /MOBILE/.test(t)
                  ? 'mobile'
                  : '?',
    );
    expect(kinds.slice(0, 6)).toEqual([
      'title',
      'sitemap',
      'summary',
      'desktop',
      'desktop',
      'mobile',
    ]);
    expect(kinds.slice(6).every((k) => k === 'list')).toBe(true);
    expect(kinds.length).toBeGreaterThan(7); // the list needs more than one page
  });

  it('leaves rejected findings out and counts them on the summary', () => {
    expect(text.join(' ')).not.toContain('REJECTED-EVIDENCE');
    const summary = text[2]!;
    expect(summary).toContain('20 findings included: 18 open, 1 accepted, 1 edited.');
    expect(summary).toContain('1 rejected finding not shown.');
    expect(summary).toContain('2 of 20 decided (10%). Reviewers: Pat Reviewer.');
    expect(summary).toMatch(/#2 \/busy · Busy \| Examplin 16 0/);
  });

  it('puts the tip, findings, decisions and severity next to the desktop screenshot', () => {
    const home = text[pageOf((t) => t.includes('#1 · Home') && t.includes('DESKTOP'))]!;
    expect(home).toContain('Findings on this page (3)');
    expect(home).toContain('Page tip AI Remove the allergy claim first.');
    expect(home).toMatch(/1 CRITICAL No implied off-label use AI 85% Open – pending review/);
    expect(home).toContain('Accepted by Pat Reviewer');
    expect(home).toContain('Edited by Pat Reviewer');
    expect(home).toContain('Author\'s fix: Add alt="Person breathing easily".');
    expect(home).toContain('Comment: Agreed with brand.');
    const mobile = text[pageOf((t) => t.includes('#1 · Home') && t.includes('MOBILE'))]!;
    expect(mobile).toContain('Findings on this page (3)');
  });

  it('adds past MLR feedback (advisory) for the page, leaving out rejected findings', () => {
    const home = text[pageOf((t) => t.includes('#1 · Home') && t.includes('DESKTOP'))]!;
    expect(home).toContain('Past MLR feedback (advisory; not a rule)');
    expect(home).toContain(
      '“"Best-in-class" is a superlative we cannot support. Remove.” (Legal, Fictorex, 2025-03, accepted)',
    );
    expect(home).toContain('Same wording again');
    expect(text.join(' ')).not.toContain('PRECEDENT-OF-REJECTED');
    expect(text[pageOf((t) => t.includes('#2 · Busy'))]).not.toContain('Past MLR feedback');
  });

  it('refers overflowing findings to the right page of the findings list', () => {
    const busy = text[pageOf((t) => t.includes('#2 · Busy'))]!;
    const m = /\+(\d+) more findings for this page; see Findings list, page (\d+)\./.exec(busy);
    expect(m).not.toBeNull();
    const target = text[Number(m![2]) - 1]!;
    expect(target).toMatch(/^Findings list/);
    expect(target).toContain('#2 /busy · Busy | Examplin');
    // Everything shown or referred: panel count + overflow = 16.
    const shown = (busy.match(/MINOR Links work/g) ?? []).length;
    expect(shown + Number(m![1])).toBe(16);
  });

  it('lists every included finding in full, site-wide first', () => {
    const list = text.slice(pageOf((t) => t.startsWith('Findings list'))).join(' ');
    expect(list.indexOf('Site-wide')).toBeLessThan(list.indexOf('#1 / · Home'));
    for (let i = 1; i <= 16; i++) expect(list).toContain(`Busy link ${i} →`);
    expect(list).toContain('S.1');
    expect(list).toContain('Source: 21 CFR 202.1(e)(6)(i)'); // the accepted superlative finding's citation
  });

  it('shows the contents and the disclaimer footer on every page', () => {
    expect(text[0]).toMatch(/Findings summary page 3/);
    expect(text[0]).toMatch(/Findings list pages \d+–\d+/);
    expect(text[0]).toContain('#3 https://examplin.test/gone (HTTP 404)');
    expect(text[0]).toContain('#4 https://examplin.test/evil');
    text.forEach((t, i) => {
      expect(t).toContain(DISCLAIMER);
      expect(t).toContain(`Page ${i + 1} of ${text.length}`);
    });
  });

  it('refuses unfinished and unknown scans', async () => {
    const running = await api({ method: 'GET', url: '/api/scans/running/report.pdf' });
    expect(running.statusCode).toBe(409);
    expect((await api({ method: 'GET', url: '/api/scans/nope/report.pdf' })).statusCode).toBe(404);
  });
});
