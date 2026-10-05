import { and, asc, eq } from 'drizzle-orm';
import type { AuditEntry } from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
import { auditLog } from '../db/schema.js';

/** Anything that can run inserts: the db itself or a transaction. */
type Writer = Pick<Db, 'insert'>;

export interface AuditInput {
  entityType:
    'finding' | 'rule' | 'precedent' | 'precedent_import' | 'rule_candidate' | 'user' | 'scan';
  entityId: string;
  scanId?: string | null;
  action: string;
  changes: Record<string, [unknown, unknown]>;
  actor: string;
  at: string;
}

/** The only write path to audit_log. There is deliberately no update or delete. */
export function appendAudit(db: Writer, entries: AuditInput | AuditInput[]): void {
  const rows = (Array.isArray(entries) ? entries : [entries]).map((e) => ({
    ...e,
    scanId: e.scanId ?? null,
  }));
  if (rows.length) db.insert(auditLog).values(rows).run();
}

export function auditFor(
  db: Db,
  entityType: AuditInput['entityType'],
  entityId: string,
): AuditEntry[] {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(asc(auditLog.id))
    .all();
}
