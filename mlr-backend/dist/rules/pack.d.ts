import { type RuleVersionInput } from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
import type { RuleVersionRow } from '../db/schema.js';
/** rule-packs/public at the repo root, resolved the same way from src/ (tsx) and dist/ (node). */
export declare const DEFAULT_RULE_PACK_DIR: string;
/** Problems with a rule's params: deterministic rules must name a known check with valid settings. */
export declare function checkParamsProblems(checkType: 'deterministic' | 'llm', params: Record<string, unknown>): string[];
/** A rule version in the pack's file format, so admin edits can be committed back to rule-packs/. */
export declare function ruleVersionYaml(r: RuleVersionRow): string;
export interface LoadedPack {
    name: string;
    version: string;
    rules: RuleVersionInput[];
}
/**
 * Reads pack.yaml and rules/*.yaml. Every rule is validated, including its check params, so a bad
 * pack fails at startup rather than mid-scan. Rules without excludePaths inherit the pack default.
 */
export declare function loadRulePack(dir: string): Promise<LoadedPack>;
export declare const RULE_PACK_ACTOR = "rule-pack-loader";
/**
 * Loads the pack into the database. Safe to repeat. A rule that an admin has since edited in the app
 * wins: a YAML version that isn't newer than the app's latest is skipped with a reason (commit the
 * exported YAML to bring the file up to date). Changing a pack rule's YAML without bumping its
 * version is still an error.
 */
export declare function syncRulePack(db: Db, dir: string): Promise<{
    pack: string;
    created: string[];
    unchanged: number;
    skipped: string[];
}>;
