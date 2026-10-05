import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { signIn, type Api } from './helpers/auth.js';
import { migratedDb } from './helpers/model.js';

describe('API hardening', () => {
  let app: FastifyInstance;
  let db: Db;
  let api: Api;

  beforeEach(async () => {
    db = migratedDb();
    app = await buildApp({
      config: loadConfig({ LOG_LEVEL: 'silent', CORS_ORIGIN: 'http://localhost:5173' }),
      db,
      llm: null,
      embedder: null,
      crawl: async () => {},
    });
    // A route that fails the way a bug or database error would.
    app.get('/api/boom', async () => {
      throw new Error('SQLITE_ERROR: no such column secret_internal_detail');
    });
    api = await signIn(app, db);
  });
  afterEach(() => app.close());

  it('answers unexpected errors generically, without internal details', async () => {
    const res = await api('/api/boom');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal error', requestId: expect.any(String) });
    expect(res.body).not.toMatch(/SQLITE|secret_internal_detail/);
  });

  it("keeps Fastify's own client errors (bad JSON) as 4xx with their message", async () => {
    const res = await api({
      method: 'POST',
      url: '/api/scans',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/JSON/i);
  });

  it('sets security headers on API responses', async () => {
    for (const res of [await app.inject('/api/health'), await api('/api/scans')]) {
      expect(res.headers).toMatchObject({
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      });
    }
  });

  it('refuses state-changing requests from other sites', async () => {
    const login = (origin: string, host = 'localhost:8000') =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin, host },
        payload: { name: 'Pat Reviewer', password: 'wrong password' },
      });
    const evil = await login('https://evil.example');
    expect(evil.statusCode).toBe(403);
    expect(evil.json().error).toBe('Request refused: it came from another site.');
    expect((await login('null')).statusCode).toBe(403);
    // The configured frontend origin, or the API's own origin, get through (then fail the password).
    expect((await login('http://localhost:5173')).statusCode).toBe(401);
    expect((await login('https://mlr.internal', 'mlr.internal')).statusCode).toBe(401);
    // Reads aren't affected.
    const read = await api({ url: '/api/scans', headers: { origin: 'https://evil.example' } });
    expect(read.statusCode).toBe(200);
  });
});
