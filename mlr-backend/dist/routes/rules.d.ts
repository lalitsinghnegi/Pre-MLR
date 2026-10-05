import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/client.js';
/** Rule library: anyone signed in can read; only rule admins can change rules. */
export declare const ruleRoutes: (db: Db) => FastifyPluginAsync;
