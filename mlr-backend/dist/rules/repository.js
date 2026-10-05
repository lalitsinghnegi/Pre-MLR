import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, max, sql } from 'drizzle-orm';
import { RuleVersionInputSchema, } from '@pre-mlr/shared';
import { appendAudit } from '../audit/log.js';
import { rules, ruleVersions, scanRules } from '../db/schema.js';
import { ConflictError, ValidationError } from '../errors.js';
/** Hash of everything that defines a rule's behaviour (not origin or bookkeeping). */
export function ruleContentHash(r) {
    const { ruleId: _id, version: _v, origin: _o, ...content } = r;
    return createHash('sha256').update(canonicalJson(content)).digest('hex');
}
/**
 * Adds a rule version. Re-adding identical content is a no-op ("unchanged"), so loading the same
 * pack twice is safe. Different content under an existing version, or a version that isn't newer
 * than the latest, is rejected: versions are immutable.
 */
export function createRuleVersion(db, input, actor) {
    const parsed = RuleVersionInputSchema.safeParse(input);
    if (!parsed.success) {
        throw ValidationError.fromIssues(`Invalid rule ${String(input.ruleId)}@${String(input.version)}`, parsed.error.issues);
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
            if (existing.contentHash === contentHash)
                return { status: 'unchanged', rule: existing };
            throw new ConflictError(`Rule ${data.ruleId} version ${data.version} already exists with different content; bump the version`);
        }
        const latest = tx
            .select({ v: max(ruleVersions.version) })
            .from(ruleVersions)
            .where(eq(ruleVersions.ruleId, data.ruleId))
            .get()?.v ?? 0;
        if (data.version <= latest) {
            throw new ConflictError(`Rule ${data.ruleId} version ${data.version} must be newer than ${latest}`);
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
/** The newest version of one rule (retired or not), if it exists. */
export function latestVersionOf(db, ruleId) {
    return db
        .select()
        .from(ruleVersions)
        .where(eq(ruleVersions.ruleId, ruleId))
        .orderBy(desc(ruleVersions.version))
        .get();
}
/** Latest version of every rule that isn't retired. */
export function latestRuleVersions(db) {
    const latest = db
        .select({
        latestRuleId: sql `${ruleVersions.ruleId}`.as('latest_rule_id'),
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
        .innerJoin(latest, and(eq(latest.latestRuleId, ruleVersions.ruleId), eq(latest.latestVersion, ruleVersions.version)))
        .orderBy(ruleVersions.ruleId)
        .all()
        .map((r) => r.rv);
}
/**
 * Freezes the rule versions a scan runs with, applying per-scan enable/disable overrides.
 * Idempotent: a scan that already has a snapshot keeps it. Unknown rule ids are rejected.
 */
export function snapshotScanRules(db, scanId, overrides = {}) {
    db.transaction((tx) => {
        if (tx.select({ s: scanRules.scanId }).from(scanRules).where(eq(scanRules.scanId, scanId)).get())
            return;
        const latest = latestRuleVersions(tx);
        const known = new Set(latest.map((r) => r.ruleId));
        const unknown = [...(overrides.enable ?? []), ...(overrides.disable ?? [])].filter((id) => !known.has(id));
        if (unknown.length)
            throw new ValidationError(`Unknown rule id(s): ${unknown.join(', ')}`);
        const enable = new Set(overrides.enable);
        const disable = new Set(overrides.disable);
        const rows = latest.map((r) => ({
            scanId,
            ruleId: r.ruleId,
            ruleVersion: r.version,
            enabled: disable.has(r.ruleId) ? false : enable.has(r.ruleId) || r.enabledByDefault,
        }));
        if (rows.length)
            tx.insert(scanRules).values(rows).run();
    });
}
/** Rule versions a scan runs with (enabled ones only, unless includeDisabled). */
export function scanRuleVersions(db, scanId, includeDisabled = false) {
    return db
        .select({ rv: ruleVersions })
        .from(scanRules)
        .innerJoin(ruleVersions, and(eq(ruleVersions.ruleId, scanRules.ruleId), eq(ruleVersions.version, scanRules.ruleVersion)))
        .where(includeDisabled
        ? eq(scanRules.scanId, scanId)
        : and(eq(scanRules.scanId, scanId), eq(scanRules.enabled, true)))
        .orderBy(ruleVersions.ruleId)
        .all()
        .map((r) => r.rv);
}
/** JSON with object keys sorted, so equal content always hashes equally. */
export function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        const entries = Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
//# sourceMappingURL=repository.js.map