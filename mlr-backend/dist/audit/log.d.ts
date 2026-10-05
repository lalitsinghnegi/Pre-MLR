import type { AuditEntry } from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
/** Anything that can run inserts: the db itself or a transaction. */
type Writer = Pick<Db, 'insert'>;
export interface AuditInput {
    entityType: 'finding' | 'rule' | 'precedent' | 'precedent_import' | 'rule_candidate' | 'user' | 'scan';
    entityId: string;
    scanId?: string | null;
    action: string;
    changes: Record<string, [unknown, unknown]>;
    actor: string;
    at: string;
}
/** The only write path to audit_log. There is deliberately no update or delete. */
export declare function appendAudit(db: Writer, entries: AuditInput | AuditInput[]): void;
export declare function auditFor(db: Db, entityType: AuditInput['entityType'], entityId: string): AuditEntry[];
export {};
