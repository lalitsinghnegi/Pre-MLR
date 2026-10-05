import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, max, sql } from 'drizzle-orm';
import {
  RuleVersionInputSchema,
  type RuleVersionData,
  type RuleVersionInput,
} from '@pre-mlr/shared';
import { appendAudit } from '../audit/log.js';
import type { Db } from '../db/client.js';
import { rules, ruleVersions, scanRules, type RuleVersionRow } from '../db/schema.js';
import { ConflictError, ValidationError } from '../errors.js';

/** Hash of everything that defines a rule's behaviour (not origin or bookkeeping). */
export function ruleContentHash(r: RuleVersionData): string {
  const { ruleId: _id, version: _v, origin: _o, ...content } = r;
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

export type CreateRuleVersionResult = { status: 'created' | 'unchanged'; rule: RuleVersionRow };

/**
 * Adds a rule version. Re-adding identical content is a no-op ("unchanged"), so loading the same
 * pack twice is safe. Different content under an existing version, or a version that isn't newer
 * than the latest, is rejected: versions are immutable.
 */
export function createRuleVersion(
  db: Db,
  input: RuleVersionInput,
  actor: string,
): CreateRuleVersionResult {
  const parsed = RuleVersionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw ValidationError.fromIssues(
      `Invalid rule ${String(input.ruleId)}@${String(input.version)}`,
      parsed.error.issues,
    );
  }
  const data = parsed.data;
  const contentHash = ruleContentHash(data);
  const now = new Date().toISOString();

  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(ruleVersions)
      .where(and(eq(ruleVersions.ruleId, data.ruleId), eq(ruleVersions.version, data.version)))
      .get();
    if (existing) {
      if (existing.contentHash === contentHash) return { status: 'unchanged', rule: existing };
      throw new ConflictError(
        `Rule ${data.ruleId} version ${data.version} already exists with different content; bump the version`,
      );
    }

    const latest =
      tx
        .select({ v: max(ruleVersions.version) })
        .from(ruleVersions)
        .where(eq(ruleVersions.ruleId, data.ruleId))
        .get()?.v ?? 0;
    if (data.version <= latest) {
      throw new ConflictError(
        `Rule ${data.ruleId} version ${data.version} must be newer than ${latest}`,
      );
    }

    tx.insert(rules).values({ id: data.ruleId, createdAt: now }).onConflictDoNothing().run();
    const rule = tx
      .insert(ruleVersions)
      .values({ ...data, contentHash, createdAt: now, createdBy: actor })
      .returning()
      .get();
    appendAudit(tx, {
      entityType: 'rule',
      entityId: data.ruleId,
      action: 'version_created',
      changes: { version: [latest || null, data.version] },
      actor,
      at: now,
    });
    return { status: 'created', rule };
  });
}

/** Anything that can run selects: the db itself or a transaction. */
type Reader = Pick<Db, 'select'>;

/** The newest version of one rule (retired or not), if it exists. */
export function latestVersionOf(db: Reader, ruleId: string): RuleVersionRow | undefined {
  return db
    .select()
    .from(ruleVersions)
    .where(eq(ruleVersions.ruleId, ruleId))
    .orderBy(desc(ruleVersions.version))
    .get();
}

/** Latest version of every rule that isn't retired. */
export function latestRuleVersions(db: Reader): RuleVersionRow[] {
  const latest = db
    .select({
      latestRuleId: sql<string>`${ruleVersions.ruleId}`.as('latest_rule_id'),
      latestVersion: max(ruleVersions.version).as('latest_version'),
    })
    .from(ruleVersions)
    .innerJoin(rules, eq(rules.id, ruleVersions.ruleId))
    .where(isNull(rules.retiredAt))
    .groupBy(ruleVersions.ruleId)
    .as('latest');
  return db
    .select({ rv: ruleVersions })
    .from(ruleVersions)
    .innerJoin(
      latest,
      and(
        eq(latest.latestRuleId, ruleVersions.ruleId),
        eq(latest.latestVersion, ruleVersions.version),
      ),
    )
    .orderBy(ruleVersions.ruleId)
    .all()
    .map((r) => r.rv);
}

export interface RuleOverrides {
  enable?: string[];
  disable?: string[];
}

/**
 * Freezes the rule versions a scan runs with, applying per-scan enable/disable overrides.
 * Idempotent: a scan that already has a snapshot keeps it. Unknown rule ids are rejected.
 */
export function snapshotScanRules(db: Db, scanId: string, overrides: RuleOverrides = {}): void {
  db.transaction((tx) => {
    if (
      tx.select({ s: scanRules.scanId }).from(scanRules).where(eq(scanRules.scanId, scanId)).get()
    )
      return;
    const latest = latestRuleVersions(tx);
    const known = new Set(latest.map((r) => r.ruleId));
    const unknown = [...(overrides.enable ?? []), ...(overrides.disable ?? [])].filter(
      (id) => !known.has(id),
    );
    if (unknown.length) throw new ValidationError(`Unknown rule id(s): ${unknown.join(', ')}`);
    const enable = new Set(overrides.enable);
    const disable = new Set(overrides.disable);
    const rows = latest.map((r) => ({
      scanId,
      ruleId: r.ruleId,
      ruleVersion: r.version,
      enabled: disable.has(r.ruleId) ? false : enable.has(r.ruleId) || r.enabledByDefault,
    }));
    if (rows.length) tx.insert(scanRules).values(rows).run();
  });
}

/** Rule versions a scan runs with (enabled ones only, unless includeDisabled). */
export function scanRuleVersions(
  db: Reader,
  scanId: string,
  includeDisabled = false,
): RuleVersionRow[] {
  return db
    .select({ rv: ruleVersions })
    .from(scanRules)
    .innerJoin(
      ruleVersions,
      and(
        eq(ruleVersions.ruleId, scanRules.ruleId),
        eq(ruleVersions.version, scanRules.ruleVersion),
      ),
    )
    .where(
      includeDisabled
        ? eq(scanRules.scanId, scanId)
        : and(eq(scanRules.scanId, scanId), eq(scanRules.enabled, true)),
    )
    .orderBy(ruleVersions.ruleId)
    .all()
    .map((r) => r.rv);
}

/** JSON with object keys sorted, so equal content always hashes equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
