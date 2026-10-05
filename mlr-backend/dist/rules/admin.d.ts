import type { CreateRule, NewRuleVersion, RuleDetail, RuleSummary, ScanRule } from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
import { type RuleVersionRow } from '../db/schema.js';
/** Origin recorded on versions made in the app (pack versions say "pack:<name>@<version>"). */
export declare const ADMIN_ORIGIN = "admin";
export declare function changesBetween(prev: RuleVersionRow | undefined, next: RuleVersionRow): {
    field: "title" | "category" | "description" | "severity" | "checkType" | "sourceCitation" | "sourceUrl" | "sourceNote" | "lastVerified" | "promptTemplate" | "params" | "enabledByDefault";
    from: string | boolean | Record<string, unknown> | null;
    to: string | boolean | Record<string, unknown> | null;
}[];
/** Every rule (retired ones too) with its latest version and usage. */
export declare function listRules(db: Db): RuleSummary[];
export declare function ruleDetail(db: Db, ruleId: string): RuleDetail;
export declare function ruleVersion(db: Db, ruleId: string, version: number): RuleVersionRow;
/** Creates a new rule at version 1. */
export declare function createRule(db: Db, input: CreateRule, actor: string): RuleVersionRow;
/**
 * Saves an edit as the next version. The editor's starting version must still be the latest, so two
 * admins can't overwrite each other; saving identical content is refused.
 */
export declare function addRuleVersion(db: Db, ruleId: string, input: NewRuleVersion, actor: string): RuleVersionRow;
/** Retired rules keep their versions (old scans still use them) but are left out of new scans. */
export declare function setRetired(db: Db, ruleId: string, retired: boolean, actor: string): void;
/** The rules a scan ran with (its frozen snapshot), with finding counts. */
export declare function scanRuleList(db: Db, scanId: string): ScanRule[];
