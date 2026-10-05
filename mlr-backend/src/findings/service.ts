import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  FindingUpdateSchema,
  type DetectedBy,
  type EvidenceLocation,
  type FindingStatus,
  type FindingUpdate,
  type Severity,
} from '@pre-mlr/shared';
import { appendAudit, type AuditInput } from '../audit/log.js';
import type { Db } from '../db/client.js';
import { findings, pages, type FindingRow } from '../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { scanRuleVersions } from '../rules/repository.js';

export interface NewFinding {
  pageId: string | null;
  ruleId: string;
  detectedBy: DetectedBy;
  /** Defaults to the rule version's severity. */
  severity?: Severity;
  message: string;
  evidenceText?: string | null;
  evidenceLocation?: EvidenceLocation | null;
  evidenceCropPath?: string | null;
  suggestedFix?: string | null;
  confidence?: number | null;
}

/** Same rule + page + evidence text = same finding. */
export function findingFingerprint(
  f: Pick<NewFinding, 'ruleId' | 'pageId' | 'evidenceText'>,
): string {
  const evidence = (f.evidenceText ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return createHash('sha256')
    .update(`${f.ruleId}\u0000${f.pageId ?? ''}\u0000${evidence}`)
    .digest('hex');
}

/**
 * Stores findings for a scan using the rule versions frozen in its snapshot. Duplicates (same
 * fingerprint in the scan) are skipped. Each created finding gets a "created" audit entry.
 */
export function recordFindings(
  db: Db,
  scanId: string,
  inputs: NewFinding[],
  actor: string,
): { created: FindingRow[]; skipped: number } {
  const rulesById = new Map(scanRuleVersions(db, scanId).map((r) => [r.ruleId, r]));
  const now = new Date().toISOString();

  return db.transaction((tx) => {
    const created: FindingRow[] = [];
    for (const input of inputs) {
      const rule = rulesById.get(input.ruleId);
      if (!rule)
        throw new ValidationError(`Rule ${input.ruleId} is not enabled for scan ${scanId}`);
      if (input.pageId) {
        const page = tx
          .select({ scanId: pages.scanId })
          .from(pages)
          .where(eq(pages.id, input.pageId))
          .get();
        if (page?.scanId !== scanId)
          throw new ValidationError(`Page ${input.pageId} is not part of scan ${scanId}`);
      }
      if (input.confidence != null && (input.confidence < 0 || input.confidence > 1)) {
        throw new ValidationError('confidence must be between 0 and 1');
      }

      const row = tx
        .insert(findings)
        .values({
          id: randomUUID(),
          scanId,
          pageId: input.pageId,
          ruleId: rule.ruleId,
          ruleVersion: rule.version,
          detectedBy: input.detectedBy,
          severity: input.severity ?? rule.severity,
          message: input.message,
          evidenceText: input.evidenceText ?? null,
          evidenceLocation: input.evidenceLocation ?? null,
          evidenceCropPath: input.evidenceCropPath ?? null,
          suggestedFix: input.suggestedFix ?? null,
          editedFix: null,
          confidence: input.confidence ?? null,
          status: 'open',
          authorComment: null,
          revision: 1,
          fingerprint: findingFingerprint(input),
          createdAt: now,
          updatedAt: now,
          updatedBy: actor,
        })
        .onConflictDoNothing({ target: [findings.scanId, findings.fingerprint] })
        .returning()
        .get();
      if (!row) continue;
      created.push(row);
      appendAudit(tx, {
        entityType: 'finding',
        entityId: row.id,
        scanId,
        action: 'created',
        changes: { status: [null, 'open'] },
        actor,
        at: now,
      });
    }
    return { created, skipped: inputs.length - created.length };
  });
}

/**
 * Applies an author's change in one transaction: validates it, bumps the revision and writes one
 * audit entry per kind of change. A request that changes nothing is a no-op (no revision bump, no
 * audit entry). Throws ConflictError if expectedRevision is stale.
 */
export function updateFinding(
  db: Db,
  id: string,
  update: FindingUpdate,
  actor: string,
): FindingRow {
  const parsed = FindingUpdateSchema.safeParse(update);
  if (!parsed.success)
    throw ValidationError.fromIssues('Invalid finding update', parsed.error.issues);
  const u = parsed.data;

  return db.transaction((tx) => {
    const current = tx.select().from(findings).where(eq(findings.id, id)).get();
    if (!current) throw new NotFoundError(`Finding ${id} not found`);
    if (u.expectedRevision !== undefined && u.expectedRevision !== current.revision) {
      throw new ConflictError(`Finding ${id} was changed by someone else`, {
        currentRevision: current.revision,
      });
    }

    const status: FindingStatus =
      u.status ?? (u.editedFix !== undefined ? 'edited' : current.status);
    const editedFix = u.editedFix ?? current.editedFix;
    const authorComment = u.comment !== undefined ? u.comment || null : current.authorComment;
    if (status === 'edited' && !editedFix) {
      throw new ValidationError('Status "edited" needs an editedFix');
    }

    const now = new Date().toISOString();
    const base = {
      entityType: 'finding',
      entityId: id,
      scanId: current.scanId,
      actor,
      at: now,
    } as const;
    const audit: AuditInput[] = [];
    if (status !== current.status) {
      audit.push({
        ...base,
        action: 'status_changed',
        changes: { status: [current.status, status] },
      });
    }
    if (editedFix !== current.editedFix) {
      audit.push({
        ...base,
        action: 'fix_edited',
        changes: { editedFix: [current.editedFix, editedFix] },
      });
    }
    if (authorComment !== current.authorComment) {
      audit.push({
        ...base,
        action: 'commented',
        changes: { authorComment: [current.authorComment, authorComment] },
      });
    }
    if (audit.length === 0) return current;

    const updated = tx
      .update(findings)
      .set({
        status,
        editedFix,
        authorComment,
        revision: current.revision + 1,
        updatedAt: now,
        updatedBy: actor,
      })
      .where(and(eq(findings.id, id), eq(findings.revision, current.revision)))
      .returning()
      .get();
    if (!updated) throw new ConflictError(`Finding ${id} was changed by someone else`);
    appendAudit(tx, audit);
    return updated;
  });
}
