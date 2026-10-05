import type { z } from 'zod';
import type { CreateScanRequestSchema } from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
import { type ScanRow, type UserRow } from '../db/schema.js';
/** Who may delete a scan: whoever started it, or a rule admin (who can also remove old scans). */
export declare function canDelete(scan: Pick<ScanRow, 'createdBy'>, user: Pick<UserRow, 'name' | 'role'>): boolean;
/**
 * Deletes a scan with its pages, findings, link checks and analyses (database cascade) and its
 * screenshots. The audit log keeps every past decision, plus a record of the deletion. A running
 * scan can't be deleted; a queued one is simply never started.
 */
export declare function deleteScan(db: Db, dataDir: string, id: string, user: Pick<UserRow, 'name' | 'role'>): Promise<void>;
/**
 * The request for running a scan again: same site, limits and product names, and the same rules
 * switched on or off (by id) as last time. Rules that have since been retired are left out, and
 * rules added since use their default. The new scan runs with the current rule versions.
 */
export declare function rerunRequest(db: Db, id: string): z.input<typeof CreateScanRequestSchema>;
