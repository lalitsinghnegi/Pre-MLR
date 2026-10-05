import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/client.js';
export declare const healthRoutes: (db: Db) => FastifyPluginAsync;
