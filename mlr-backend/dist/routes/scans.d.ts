import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/client.js';
import type { Config } from '../config.js';
import type { NetworkGuard } from '../net/guard.js';
import type { ScanRunner } from '../scans/runner.js';
export declare const scanRoutes: (db: Db, runner: ScanRunner, config: Config, guard: NetworkGuard) => FastifyPluginAsync;
