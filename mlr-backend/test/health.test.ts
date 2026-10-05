import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { HealthResponseSchema } from '@pre-mlr/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';

describe('GET /api/health', () => {
  let app: FastifyInstance;
  afterEach(() => app.close());

  it('reports ok when the database responds', async () => {
    app = await buildApp({
      config: loadConfig({ LOG_LEVEL: 'silent' }),
      db: createDb(':memory:'),
    });
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    const body = HealthResponseSchema.parse(res.json());
    expect(body).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('reports degraded when the database is unavailable', async () => {
    const db = createDb(':memory:');
    app = await buildApp({ config: loadConfig({ LOG_LEVEL: 'silent' }), db });
    db.$client.close();

    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'error' });
  });
});
