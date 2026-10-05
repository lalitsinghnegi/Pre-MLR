import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { appendAudit } from '../audit/log.js';
import { findings, scanRules, scans } from '../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../errors.js';
import { latestRuleVersions } from '../rules/repository.js';
import { scanDirRelative } from './runner.js';
function loadScan(db, id) {
    const scan = db.select().from(scans).where(eq(scans.id, id)).get();
    if (!scan)
        throw new NotFoundError('Scan not found');
    return scan;
}
/** Who may delete a scan: whoever started it, or a rule admin (who can also remove old scans). */
export function canDelete(scan, user) {
    return user.role === 'rule_admin' || (scan.createdBy !== null && scan.createdBy === user.name);
}
/**
 * Deletes a scan with its pages, findings, link checks and analyses (database cascade) and its
 * screenshots. The audit log keeps every past decision, plus a record of the deletion. A running
 * scan can't be deleted; a queued one is simply never started.
 */
export async function deleteScan(db, dataDir, id, user) {
    const scan = loadScan(db, id);
    if (!canDelete(scan, user)) {
        throw new ForbiddenError('Only the person who started this scan, or a rule admin, can delete it.');
    }
    if (scan.status === 'running') {
        throw new ConflictError('This scan is running. Wait until it finishes, then delete it.');
    }
    const findingCount = Number(db
        .select({ n: sql `count(*)` })
        .from(findings)
        .where(eq(findings.scanId, id))
        .get()?.n ?? 0);
    db.transaction((tx) => {
        tx.delete(scans).where(eq(scans.id, id)).run();
        appendAudit(tx, {
            entityType: 'scan',
            entityId: id,
            scanId: id,
            action: 'scan_deleted',
            changes: {
                startUrl: [scan.startUrl, null],
                status: [scan.status, null],
                findings: [findingCount, null],
            },
            actor: user.name,
            at: new Date().toISOString(),
        });
    });
    // Screenshots live under DATA_DIR/scans/<id>; the id is a generated UUID, checked anyway.
    const root = resolve(dataDir);
    const dir = resolve(root, scanDirRelative(id));
    if (dir.startsWith(root + sep))
        await rm(dir, { recursive: true, force: true });
}
/**
 * The request for running a scan again: same site, limits and product names, and the same rules
 * switched on or off (by id) as last time. Rules that have since been retired are left out, and
 * rules added since use their default. The new scan runs with the current rule versions.
 */
export function rerunRequest(db, id) {
    const scan = loadScan(db, id);
    const before = new Map(db
        .select({ ruleId: scanRules.ruleId, enabled: scanRules.enabled })
        .from(scanRules)
        .where(eq(scanRules.scanId, id))
        .all()
        .map((r) => [r.ruleId, r.enabled]));
    const enable = [];
    const disable = [];
    for (const rule of latestRuleVersions(db)) {
        const was = before.get(rule.ruleId);
        if (was === undefined || was === rule.enabledByDefault)
            continue;
        (was ? enable : disable).push(rule.ruleId);
    }
    return {
        startUrl: scan.startUrl,
        maxPages: scan.maxPages,
        maxDepth: scan.maxDepth,
        ...(scan.product ? { product: scan.product } : {}),
        rules: { enable, disable },
    };
}
//# sourceMappingURL=manage.js.map