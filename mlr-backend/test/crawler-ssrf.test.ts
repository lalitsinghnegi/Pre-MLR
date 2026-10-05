import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crawl, type CrawledPage } from '../src/crawler/crawler.js';
import { BLOCKED_MESSAGE, NetworkGuard } from '../src/net/guard.js';

const listen = async (server: Server) => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
};

/**
 * A public-looking site (allowlisted) tries every way it can to make the crawler's browser reach
 * an internal server: an image, a redirect, a script fetch, a WebSocket and a direct link.
 */
describe('crawler SSRF protection', { timeout: 60_000 }, () => {
  let site: Server;
  let internal: Server;
  let sitePort: number;
  let internalPort: number;
  let tmp: string;
  const internalHits: string[] = [];

  beforeAll(async () => {
    internal = createServer((req, res) => {
      internalHits.push(req.url ?? '');
      res.end('internal secret');
    });
    internalPort = await listen(internal);
    const secret = `http://127.0.0.1:${internalPort}`;
    site = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: `${secret}/admin` }).end();
        return;
      }
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html>
          <title>Home</title>
          <h1>Welcome</h1>
          <img src="${secret}/img.png" alt="x">
          <img src="/redirect" alt="y">
          <a href="/redirect">Redirect</a>
          <a href="/about">About</a>
          <script>
            fetch('${secret}/from-script').catch(() => {});
            try { new WebSocket('ws://127.0.0.1:${internalPort}/ws'); } catch {}
          </script>`);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end('<title>About</title><p>About</p>');
    });
    sitePort = await listen(site);
    tmp = await mkdtemp(join(tmpdir(), 'pre-mlr-ssrf-'));
  });
  afterAll(async () => {
    site.close();
    internal.close();
    await rm(tmp, { recursive: true, force: true });
  });

  const run = async (startUrl: string, allow: string[]) => {
    const guard = new NetworkGuard({ allow });
    const pages: CrawledPage[] = [];
    try {
      await crawl(
        {
          startUrl,
          maxPages: 10,
          maxDepth: 2,
          screenshotDir: join(tmp, String(Date.now())),
          guard,
        },
        (p) => {
          pages.push(p);
        },
      );
    } finally {
      await guard.close();
    }
    return pages;
  };

  it('never lets the browser reach the internal server', async () => {
    const pages = await run(`http://127.0.0.1:${sitePort}/`, [`127.0.0.1:${sitePort}`]);
    const byPath = new Map(pages.map((p) => [new URL(p.url).pathname, p]));
    expect(byPath.get('/')).toMatchObject({ error: null, title: 'Home' });
    expect(byPath.get('/about')).toMatchObject({ error: null });
    expect(byPath.get('/redirect')).toMatchObject({ error: BLOCKED_MESSAGE, httpStatus: null });
    expect(internalHits).toEqual([]);
  });

  it('records an internal start URL as blocked without contacting it', async () => {
    const pages = await run(`http://127.0.0.1:${internalPort}/`, []);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ error: BLOCKED_MESSAGE, desktopScreenshot: null });
    expect(internalHits).toEqual([]);
  });
});
