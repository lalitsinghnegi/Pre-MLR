import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crawl, type CrawledPage } from '../src/crawler/crawler.js';
import { pngSize } from './helpers/png.js';
import { NetworkGuard } from '../src/net/guard.js';
import { serveStatic, type StaticSite } from './helpers/static-server.js';

const FIXTURE = join(import.meta.dirname, 'fixtures/crawl-site');

describe('crawl (Playwright, fixture site)', { timeout: 60_000 }, () => {
  let site: StaticSite;
  let guard: NetworkGuard;
  let tmp: string;

  beforeAll(async () => {
    site = await serveStatic(FIXTURE);
    guard = new NetworkGuard({ allow: [new URL(site.url).host] });
    tmp = await mkdtemp(join(tmpdir(), 'pre-mlr-crawl-'));
  });
  afterAll(async () => {
    await guard?.close();
    await site?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  async function run(maxPages: number, maxDepth: number, name: string) {
    const results: CrawledPage[] = [];
    const screenshotDir = join(tmp, name);
    await crawl({ startUrl: `${site.url}/`, maxPages, maxDepth, screenshotDir, guard }, (p) => {
      results.push(p);
    });
    const byPath = new Map(results.map((p) => [new URL(p.url).pathname, p]));
    return { results, byPath, screenshotDir };
  }

  describe('full crawl (maxDepth 3)', () => {
    let crawled: Awaited<ReturnType<typeof run>>;
    beforeAll(async () => {
      crawled = await run(25, 3, 'full');
    });

    it('visits same-site pages breadth-first, once each', () => {
      expect(crawled.results.map((p) => new URL(p.url).pathname)).toEqual([
        '/',
        '/about',
        '/products',
        '/missing',
        '/products/widget',
        '/products/gadget',
        '/products/widget-specs',
      ]);
      expect(crawled.results.map((p) => p.crawlIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('records depth and the first parent that linked to each page', () => {
      const { byPath } = crawled;
      const home = byPath.get('/')!;
      expect(home).toMatchObject({ depth: 0, parentId: null });
      expect(byPath.get('/products')).toMatchObject({ depth: 1, parentId: home.id });
      expect(byPath.get('/products/gadget')).toMatchObject({
        depth: 2,
        parentId: byPath.get('/products')!.id,
      });
      expect(byPath.get('/products/widget-specs')).toMatchObject({
        depth: 3,
        parentId: byPath.get('/products/widget')!.id,
      });
    });

    it('respects maxDepth, robots.txt, and skips external and non-HTML links', () => {
      const paths = [...crawled.byPath.keys()];
      expect(paths).not.toContain('/products/widget-specs-deep'); // depth 4
      expect(paths).not.toContain('/private/secret'); // robots.txt
      expect(paths).not.toContain('/files/brochure.pdf');
      expect(crawled.results.every((p) => p.url.startsWith(site.url))).toBe(true);
    });

    it('extracts title, visible text and all links (including skipped ones)', () => {
      const home = crawled.byPath.get('/')!;
      expect(home.title).toBe('Home | Crawl Fixture');
      expect(home.httpStatus).toBe(200);
      expect(home.text).toContain('Welcome to the fixture site');
      expect(home.text).not.toContain('font-family'); // <style> is not visible text
      expect(home.links).toEqual(
        expect.arrayContaining([
          { href: `${site.url}/about`, text: 'About' },
          { href: 'https://external.example.com/', text: 'External site' },
          { href: 'mailto:info@example.com', text: 'Email us' },
          { href: `${site.url}/files/brochure.pdf`, text: 'Brochure (PDF)' },
          { href: `${site.url}/about`, text: 'About us (icon)' },
        ]),
      );
      expect(home.links).toHaveLength(11);
    });

    it('records broken pages with their status and no screenshots', () => {
      expect(crawled.byPath.get('/missing')).toMatchObject({
        httpStatus: 404,
        error: 'HTTP 404',
        desktopScreenshot: null,
        mobileScreenshot: null,
      });
    });

    it('takes full-page desktop (1440px) and mobile (390px) screenshots', async () => {
      const ok = crawled.results.filter((p) => !p.error);
      for (const p of ok) {
        expect(p.desktopScreenshot).toBe(`${p.id}-desktop.png`);
        expect((await pngSize(join(crawled.screenshotDir, p.desktopScreenshot!))).width).toBe(1440);
        expect((await pngSize(join(crawled.screenshotDir, p.mobileScreenshot!))).width).toBe(390);
      }
      const gadget = crawled.byPath.get('/products/gadget')!;
      const { height } = await pngSize(join(crawled.screenshotDir, gadget.desktopScreenshot!));
      expect(height).toBeGreaterThan(3000);
    });
  });

  it('stops at maxPages', async () => {
    const { results } = await run(3, 10, 'max-pages');
    expect(results.map((p) => new URL(p.url).pathname)).toEqual(['/', '/about', '/products']);
  });

  it('crawls only the start page when maxDepth is 0', async () => {
    const { results } = await run(25, 0, 'depth-0');
    expect(results).toHaveLength(1);
  });

  it('can be aborted', async () => {
    const controller = new AbortController();
    const visited: string[] = [];
    const promise = crawl(
      {
        startUrl: `${site.url}/`,
        maxPages: 25,
        maxDepth: 3,
        screenshotDir: join(tmp, 'abort'),
        signal: controller.signal,
        guard,
      },
      (p) => {
        visited.push(p.url);
        controller.abort(new Error('stop'));
      },
    );
    await expect(promise).rejects.toThrow('stop');
    expect(visited).toHaveLength(1);
  });
});
