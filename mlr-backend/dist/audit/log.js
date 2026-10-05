import { and, asc, eq } from 'drizzle-orm';
import { auditLog } from '../db/schema.js';
/** The only write path to audit_log. There is deliberately no update or delete. */
export function appendAudit(db, entries) {
    const rows = (Array.isArray(entries) ? entries : [entries]).map((e) => ({
        ...e,
        scanId: e.scanId ?? null,
    }));
    if (rows.length)
        db.insert(auditLog).values(rows).run();
}
export function auditFor(db, entityType, entityId) {
    return db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
        .orderBy(asc(auditLog.id))
        .all();
}
//# sourceMappingURL=log.js.map