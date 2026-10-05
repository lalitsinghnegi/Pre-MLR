import { type DetectedBy, type EvidenceLocation, type FindingUpdate, type Severity } from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
import { type FindingRow } from '../db/schema.js';
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
export declare function findingFingerprint(f: Pick<NewFinding, 'ruleId' | 'pageId' | 'evidenceText'>): string;
/**
 * Stores findings for a scan using the rule versions frozen in its snapshot. Duplicates (same
 * fingerprint in the scan) are skipped. Each created finding gets a "created" audit entry.
 */
export declare function recordFindings(db: Db, scanId: string, inputs: NewFinding[], actor: string): {
    created: FindingRow[];
    skipped: number;
};
/**
 * Applies an author's change in one transaction: validates it, bumps the revision and writes one
 * audit entry per kind of change. A request that changes nothing is a no-op (no revision bump, no
 * audit entry). Throws ConflictError if expectedRevision is stale.
 */
export declare function updateFinding(db: Db, id: string, update: FindingUpdate, actor: string): FindingRow;
