import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { scans } from '../db/schema.js';
import { snapshotScanRules } from '../rules/repository.js';
import { TooManyRequestsError } from '../errors.js';
/**
 * Inserts a queued scan and freezes its rule versions in one transaction, then queues it. The
 * snapshot is taken now, so the scan is checked against the rules in force when it was requested
 * (with per-scan overrides); invalid overrides roll the scan back.
 */
export function createScan(db, runner, request, createdBy, limits = { maxQueued: Infinity, maxPerUser: Infinity }) {
    const { rules, product, ...crawlLimits } = request;
    const row = db.transaction((tx) => {
        // Checked inside the transaction so two requests can't both take the last slot.
        const active = tx
            .select({ createdBy: scans.createdBy })
            .from(scans)
            .where(inArray(scans.status, ['queued', 'running']))
            .all();
        if (active.length >= limits.maxQueued) {
            throw new TooManyRequestsError(`The scan queue is full (${active.length} scans waiting or running). Try again when one finishes.`);
        }
        if (active.filter((s) => s.createdBy === createdBy).length >= limits.maxPerUser) {
            throw new TooManyRequestsError(`You already have ${limits.maxPerUser} scans waiting or running. Try again when one finishes.`);
        }
        const created = tx
            .insert(scans)
            .values({
            id: randomUUID(),
            ...crawlLimits,
            product: product ?? null,
            createdBy,
            status: 'queued',
            createdAt: new Date().toISOString(),
        })
            .returning()
            .get();
        snapshotScanRules(tx, created.id, rules);
        return created;
    });
    runner.enqueue(row.id);
    return row;
}
//# sourceMappingURL=create.js.map