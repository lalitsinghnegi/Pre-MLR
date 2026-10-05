import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import type { HealthResponse } from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
import { version } from '../version.js';

export const healthRoutes =
  (db: Db): FastifyPluginAsync =>
  async (app) => {
    app.get('/api/health', async (req): Promise<HealthResponse> => {
      let dbStatus: HealthResponse['db'] = 'ok';
      try {
        db.get(sql`select 1`);
      } catch (err) {
        req.log.error({ err }, 'health check: database unavailable');
        dbStatus = 'error';
      }
      return { status: dbStatus === 'ok' ? 'ok' : 'degraded', version, db: dbStatus };
    });
  };
