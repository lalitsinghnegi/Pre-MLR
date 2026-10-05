import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkLinks } from '../src/links/checker.js';

describe('checkLinks', () => {
  let server: Server;
  let base: string;
  const methods: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      methods.push(`${req.method} ${req.url}`);
      if (req.url === '/ok') return res.writeHead(200, { 'content-type': 'text/html' }).end('ok');
      if (req.url === '/redirect') return res.writeHead(301, { location: '/ok' }).end();
      if (req.url === '/no-head') return res.writeHead(req.method === 'HEAD' ? 405 : 200).end();
      if (req.url === '/slow') return setTimeout(() => res.writeHead(200).end(), 2000);
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  it('reports status per URL, following redirects and falling back from HEAD to GET', async () => {
    const urls = ['/ok', '/redirect', '/no-head', '/missing'].map((p) => base + p);
    const results = await checkLinks(urls, { concurrency: 2 });
    expect(results.map((r) => [r.url.slice(base.length), r.ok, r.httpStatus])).toEqual([
      ['/ok', true, 200],
      ['/redirect', true, 200],
      ['/no-head', true, 200],
      ['/missing', false, 404],
    ]);
    expect(results[1]!.finalUrl).toBe(`${base}/ok`);
    expect(results[3]!.error).toBe('HTTP 404');
    expect(methods).toContain('HEAD /ok');
    expect(methods).not.toContain('GET /ok');
    expect(methods).toContain('GET /no-head');
  });

  it('reports network errors and timeouts as not ok', async () => {
    const [refused, slow] = await checkLinks(['http://127.0.0.1:1/', `${base}/slow`], {
      timeoutMs: 300,
    });
    expect(refused).toMatchObject({ ok: false, httpStatus: null });
    expect(refused!.error).toBeTruthy();
    expect(slow).toMatchObject({ ok: false, httpStatus: null });
  });
});
