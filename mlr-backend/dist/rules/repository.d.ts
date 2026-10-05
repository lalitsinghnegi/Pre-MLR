import { type RuleVersionData, type RuleVersionInput } from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
import { type RuleVersionRow } from '../db/schema.js';
/** Hash of everything that defines a rule's behaviour (not origin or bookkeeping). */
export declare function ruleContentHash(r: RuleVersionData): string;
export type CreateRuleVersionResult = {
    status: 'created' | 'unchanged';
    rule: RuleVersionRow;
};
/**
 * Adds a rule version. Re-adding identical content is a no-op ("unchanged"), so loading the same
 * pack twice is safe. Different content under an existing version, or a version that isn't newer
 * than the latest, is rejected: versions are immutable.
 */
export declare function createRuleVersion(db: Db, input: RuleVersionInput, actor: string): CreateRuleVersionResult;
/** Anything that can run selects: the db itself or a transaction. */
type Reader = Pick<Db, 'select'>;
/** The newest version of one rule (retired or not), if it exists. */
export declare function latestVersionOf(db: Reader, ruleId: string): RuleVersionRow | undefined;
/** Latest version of every rule that isn't retired. */
export declare function latestRuleVersions(db: Reader): RuleVersionRow[];
export interface RuleOverrides {
    enable?: string[];
    disable?: string[];
}
/**
 * Freezes the rule versions a scan runs with, applying per-scan enable/disable overrides.
 * Idempotent: a scan that already has a snapshot keeps it. Unknown rule ids are rejected.
 */
export declare function snapshotScanRules(db: Db, scanId: string, overrides?: RuleOverrides): void;
/** Rule versions a scan runs with (enabled ones only, unless includeDisabled). */
export declare function scanRuleVersions(db: Reader, scanId: string, includeDisabled?: boolean): RuleVersionRow[];
/** JSON with object keys sorted, so equal content always hashes equally. */
export declare function canonicalJson(value: unknown): string;
export {};
