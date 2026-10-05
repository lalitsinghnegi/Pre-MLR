import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
export declare const authRoutes: (db: Db, config: Config) => FastifyPluginAsync;
