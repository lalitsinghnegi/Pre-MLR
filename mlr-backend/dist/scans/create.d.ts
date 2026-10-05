import type { z } from 'zod';
import type { CreateScanRequestSchema } from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
import { type ScanRow } from '../db/schema.js';
import type { ScanRunner } from './runner.js';
export interface ScanLimits {
    /** Scans waiting or running at once, across all users. */
    maxQueued: number;
    /** Scans one user may have waiting or running at once. */
    maxPerUser: number;
}
/**
 * Inserts a queued scan and freezes its rule versions in one transaction, then queues it. The
 * snapshot is taken now, so the scan is checked against the rules in force when it was requested
 * (with per-scan overrides); invalid overrides roll the scan back.
 */
export declare function createScan(db: Db, runner: ScanRunner, request: z.output<typeof CreateScanRequestSchema>, createdBy: string, limits?: ScanLimits): ScanRow;
