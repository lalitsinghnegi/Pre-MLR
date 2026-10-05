import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/client.js';
/** Historic MLR comment trends, candidate new rules, and promoting comments to rule candidates. */
export declare const precedentRoutes: (db: Db) => FastifyPluginAsync;
