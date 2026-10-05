import { signIn, type Api } from './helpers/auth.js';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb, type Db } from '../src/db/client.js';
import { pages, scans } from '../src/db/schema.js';
import { sampleSite } from './helpers/sitemap-pages.js';

describe('site map API', () => {
  let app: FastifyInstance;
  let api: Api;
  let db: Db;

  beforeEach(async () => {
    db = createDb(':memory:');
    app = await buildApp({
      config: loadConfig({ LOG_LEVEL: 'silent' }),
      db,
      crawl: async () => {},
    });
    api = await signIn(app, db);
    const now = new Date().toISOString();
    db.insert(scans)
      .values([
        {
          id: 'done',
          startUrl: 'https://example.com/',
          maxPages: 25,
          maxDepth: 3,
          status: 'completed',
          createdAt: now,
        },
        {
          id: 'empty',
          startUrl: 'https://example.com/',
          maxPages: 25,
          maxDepth: 3,
          status: 'running',
          createdAt: now,
        },
      ])
      .run();
    db.insert(pages)
      .values(
        sampleSite().map((p) => ({
          ...p,
          scanId: 'done',
          depth: 0,
          links: [],
          crawledAt: now,
        })),
      )
      .run();
  });
  afterEach(() => app.close());

  it('returns the site map as SVG', async () => {
    const res = await api({ method: 'GET', url: '/api/scans/done/sitemap.svg' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.body).toContain('<svg');
    expect(res.body).toContain('Site map · example.com · 6 pages');
    expect(res.body).not.toContain('(scan');
    expect(res.body).toContain('>1. Home</text>');
  });

  it('returns the site map as PNG', async () => {
    const res = await api({ method: 'GET', url: '/api/scans/done/sitemap.png' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.rawPayload.subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('marks maps of unfinished scans as partial', async () => {
    db.update(scans).set({ status: 'running' }).run();
    const res = await api({ method: 'GET', url: '/api/scans/done/sitemap.svg' });
    expect(res.body).toContain('6 pages (scan running)');
  });

  it.each(['svg', 'png'])('404s for unknown scans and scans without pages (%s)', async (ext) => {
    const unknown = await api({ method: 'GET', url: `/api/scans/nope/sitemap.${ext}` });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: 'Scan not found' });
    const empty = await api({ method: 'GET', url: `/api/scans/empty/sitemap.${ext}` });
    expect(empty.statusCode).toBe(404);
    expect(empty.json()).toEqual({ error: 'Scan has no pages yet' });
  });
});
