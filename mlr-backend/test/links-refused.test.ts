import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, inArray } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDeterministicChecks } from '../src/checks/run.js';
import { findings, linkChecks, pages } from '../src/db/schema.js';
import { verifyLinksInBrowser } from '../src/links/browser.js';
import { checkLinks, type LinkCheckResult } from '../src/links/checker.js';
import { NetworkGuard } from '../src/net/guard.js';
import { syncRulePack, DEFAULT_RULE_PACK_DIR } from '../src/rules/pack.js';
import { snapshotScanRules } from '../src/rules/repository.js';
import { block, facts } from './helpers/check-pages.js';
import { migratedDb, seedScan } from './helpers/model.js';

const reply = (status: number, headers: Record<string, string> = {}) =>
  new Response('', { status, headers });

describe('link refusals', () => {
  it('marks 401/403/429 and bot challenges as refused, not real failures', async () => {
    const byUrl: Record<string, () => Response> = {
      'https://a.test/403': () => reply(403),
      'https://a.test/401': () => reply(401),
      'https://a.test/429': () => reply(429),
      'https://a.test/challenge': () => reply(503, { 'cf-mitigated': 'challenge' }),
      'https://a.test/404': () => reply(404),
      'https://a.test/500': () => reply(500),
      'https://a.test/ok': () => reply(200),
    };
    const results = await checkLinks(Object.keys(byUrl), {
      fetchImpl: async (u) => byUrl[String(u)]!(),
    });
    expect(
      Object.fromEntries(results.map((r) => [r.url.split('/').pop(), [r.ok, !!r.refused]])),
    ).toEqual({
      '403': [false, true],
      '401': [false, true],
      '429': [false, true],
      challenge: [false, true],
      '404': [false, false],
      '500': [false, false],
      ok: [true, false],
    });
  });
});

describe('broken-link findings for refused links', () => {
  /** A scan whose home page links to three external URLs; returns its link findings. */
  async function scanWith(
    fetchStatus: Record<string, number>,
    verifyInBrowser?: (links: LinkCheckResult[]) => Promise<LinkCheckResult[]>,
    onBothPages = false,
  ) {
    const db = migratedDb();
    await syncRulePack(db, DEFAULT_RULE_PACK_DIR);
    const { scanId, homeId, aboutId } = seedScan(db);
    const links = Object.keys(fetchStatus).map((href, i) => ({ href, text: `Link ${i + 1}` }));
    db.update(pages)
      .set({
        httpStatus: 200,
        links,
        text: links.map((l) => l.text).join('\n'),
        facts: facts(links.map((l) => block(l.text))),
      })
      .where(onBothPages ? inArray(pages.id, [homeId, aboutId]) : eq(pages.id, homeId))
      .run();
    snapshotScanRules(db, scanId);
    await runDeterministicChecks(db, scanId, {
      log: pino({ level: 'silent' }),
      fetchImpl: async (u) => reply(fetchStatus[String(u)] ?? 200),
      verifyInBrowser,
    });
    return {
      found: db
        .select()
        .from(findings)
        .where(eq(findings.ruleId, 'broken-links'))
        .all()
        .map((f) => [f.severity, f.message, f.evidenceText])
        .sort((a, b) => String(a[2]).localeCompare(String(b[2]))),
      checks: db.select().from(linkChecks).all(),
    };
  }

  it('re-checks refused links in the browser: working ones raise nothing, refused ones a note', async () => {
    const urls = {
      'https://corp.test/accessibility': 403,
      'https://corp.test/terms': 403,
      'https://other.test/gone': 404,
    };
    let asked: string[] = [];
    const { found, checks } = await scanWith(urls, async (links) => {
      asked = links.map((l) => l.url);
      return links.map((l) =>
        l.url.endsWith('accessibility')
          ? { ...l, ok: true, httpStatus: 200, error: null, refused: false, checkedVia: 'browser' }
          : { ...l, unverified: true, checkedVia: 'browser' },
      );
    });
    expect(asked).toEqual(['https://corp.test/accessibility', 'https://corp.test/terms']);
    expect(found).toEqual([
      [
        'info',
        "Couldn't confirm this link automatically: corp.test refused automated checks (HTTP 403). It is not known to be broken.",
        'Link 2 → https://corp.test/terms',
      ],
      ['minor', 'Broken link (HTTP 404).', 'Link 3 → https://other.test/gone'],
    ]);
    const byUrl = Object.fromEntries(checks.map((c) => [c.url, c]));
    expect(byUrl['https://corp.test/accessibility']).toMatchObject({
      ok: true,
      unverified: false,
      checkedVia: 'browser',
    });
    expect(byUrl['https://corp.test/terms']).toMatchObject({ ok: false, unverified: true });
    expect(byUrl['https://other.test/gone']).toMatchObject({
      ok: false,
      unverified: false,
      checkedVia: 'http',
    });
  });

  it('notes a link that appears on several pages once, with the page count', async () => {
    const { found } = await scanWith({ 'https://corp.test/footer': 403 }, undefined, true);
    expect(found).toEqual([
      [
        'info',
        "Couldn't confirm this link automatically: corp.test refused automated checks (HTTP 403). It is not known to be broken. Linked from 2 pages.",
        'Link 1 → https://corp.test/footer',
      ],
    ]);
  });

  it('never calls a refused link broken, even without (or after a failed) browser check', async () => {
    for (const verify of [
      undefined,
      async () => {
        throw new Error('browser crashed');
      },
    ]) {
      const { found } = await scanWith({ 'https://corp.test/a': 403 }, verify);
      expect(found.map(([severity]) => severity)).toEqual(['info']);
    }
  });
});

describe('verifyLinksInBrowser (real browser)', { timeout: 60_000 }, () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    // Behaves like a bot-protected site: plain HTTP clients get 403, browsers get the page.
    server = createServer((req, res) => {
      // Only browser navigations send sec-fetch-dest: document (Node's fetch sends sec-fetch-mode).
      const browser = req.headers['sec-fetch-dest'] === 'document';
      if (req.url === '/gone') return void res.writeHead(404).end();
      if (req.url === '/always-403') return void res.writeHead(403).end();
      if (!browser) return void res.writeHead(403).end('Attention Required!');
      if (req.url === '/doc.pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF-1.4');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Fine</title>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it('confirms pages and documents that only refuse plain HTTP, and keeps 404s broken', async () => {
    const guard = new NetworkGuard({ allow: [new URL(base).host] });
    const urls = ['/page', '/doc.pdf', '/gone', '/always-403'].map((p) => `${base}${p}`);
    const plain = await checkLinks(urls, { fetchImpl: guard.fetch });
    expect(plain.map((r) => r.httpStatus)).toEqual([403, 403, 404, 403]);

    const rechecked = await verifyLinksInBrowser(plain, guard);
    expect(
      rechecked.map((r) => [r.url.slice(base.length), r.ok, !!r.unverified, r.httpStatus]),
    ).toEqual([
      ['/page', true, false, 200],
      ['/doc.pdf', true, false, 200],
      ['/gone', false, false, 404],
      ['/always-403', false, true, 403],
    ]);
    expect(rechecked.every((r) => r.checkedVia === 'browser')).toBe(true);
    await guard.close();
  });

  it('cannot be used to reach private addresses', async () => {
    const guard = new NetworkGuard(); // nothing allowlisted
    const [r] = await verifyLinksInBrowser(
      [
        {
          url: `${base}/page`,
          ok: false,
          httpStatus: 403,
          error: 'HTTP 403',
          finalUrl: null,
          contentType: null,
          refused: true,
        },
      ],
      guard,
    );
    expect(r).toMatchObject({ ok: false, unverified: true });
    await guard.close();
  });
});
