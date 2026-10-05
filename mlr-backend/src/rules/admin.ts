import { and, desc, eq, sql } from 'drizzle-orm';
import type {
  CreateRule,
  NewRuleVersion,
  RuleDetail,
  RuleFields,
  RuleSummary,
  ScanRule,
} from '@pre-mlr/shared';
import { appendAudit } from '../audit/log.js';
import type { Db } from '../db/client.js';
import {
  findings,
  rules,
  ruleVersions,
  scanRules,
  scans,
  type RuleVersionRow,
} from '../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { checkParamsProblems } from './pack.js';
import { createRuleVersion, latestVersionOf, ruleContentHash } from './repository.js';

/** Origin recorded on versions made in the app (pack versions say "pack:<name>@<version>"). */
export const ADMIN_ORIGIN = 'admin';

/** Fields compared between versions, in display order. */
const FIELDS = [
  'title',
  'description',
  'category',
  'severity',
  'checkType',
  'enabledByDefault',
  'sourceCitation',
  'sourceUrl',
  'sourceNote',
  'lastVerified',
  'promptTemplate',
  'params',
] as const satisfies readonly (keyof RuleFields)[];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function changesBetween(prev: RuleVersionRow | undefined, next: RuleVersionRow) {
  if (!prev) return [];
  return FIELDS.filter((f) => !same(prev[f], next[f])).map((field) => ({
    field,
    from: prev[field],
    to: next[field],
  }));
}

/** Findings and scans per rule version. */
function usageCounts(db: Db, ruleId?: string) {
  const f = db
    .select({
      ruleId: findings.ruleId,
      version: findings.ruleVersion,
      n: sql<number>`count(*)`,
    })
    .from(findings)
    .where(ruleId ? eq(findings.ruleId, ruleId) : undefined)
    .groupBy(findings.ruleId, findings.ruleVersion)
    .all();
  const s = db
    .select({
      ruleId: scanRules.ruleId,
      version: scanRules.ruleVersion,
      n: sql<number>`count(*)`,
    })
    .from(scanRules)
    .where(ruleId ? eq(scanRules.ruleId, ruleId) : undefined)
    .groupBy(scanRules.ruleId, scanRules.ruleVersion)
    .all();
  const key = (r: string, v: number) => `${r}@${v}`;
  return {
    findings: new Map(f.map((x) => [key(x.ruleId, x.version), Number(x.n)])),
    scans: new Map(s.map((x) => [key(x.ruleId, x.version), Number(x.n)])),
    key,
  };
}

/** Every rule (retired ones too) with its latest version and usage. */
export function listRules(db: Db): RuleSummary[] {
  const all = db.select().from(ruleVersions).orderBy(ruleVersions.ruleId).all();
  const meta = new Map(
    db
      .select()
      .from(rules)
      .all()
      .map((r) => [r.id, r]),
  );
  const usage = usageCounts(db);
  const byRule = new Map<string, RuleVersionRow[]>();
  for (const v of all) byRule.set(v.ruleId, [...(byRule.get(v.ruleId) ?? []), v]);
  return [...byRule.entries()].map(([ruleId, versions]) => {
    const latest = versions.reduce((a, b) => (b.version > a.version ? b : a));
    const sum = (m: Map<string, number>) =>
      versions.reduce((n, v) => n + (m.get(usage.key(ruleId, v.version)) ?? 0), 0);
    return {
      ruleId,
      latest,
      versionCount: versions.length,
      retiredAt: meta.get(ruleId)?.retiredAt ?? null,
      scans: sum(usage.scans),
      findings: sum(usage.findings),
    };
  });
}

export function ruleDetail(db: Db, ruleId: string): RuleDetail {
  const rule = db.select().from(rules).where(eq(rules.id, ruleId)).get();
  if (!rule) throw new NotFoundError('Rule not found');
  const versions = db
    .select()
    .from(ruleVersions)
    .where(eq(ruleVersions.ruleId, ruleId))
    .orderBy(ruleVersions.version)
    .all();
  const usage = usageCounts(db, ruleId);
  const perScan = db
    .select({
      scanId: scanRules.scanId,
      startUrl: scans.startUrl,
      createdAt: scans.createdAt,
      version: scanRules.ruleVersion,
      enabled: scanRules.enabled,
      findings: sql<number>`(select count(*) from ${findings} where ${findings.scanId} = ${scanRules.scanId} and ${findings.ruleId} = ${scanRules.ruleId})`,
    })
    .from(scanRules)
    .innerJoin(scans, eq(scans.id, scanRules.scanId))
    .where(eq(scanRules.ruleId, ruleId))
    .orderBy(desc(scans.createdAt))
    .all();
  return {
    ruleId,
    createdAt: rule.createdAt,
    retiredAt: rule.retiredAt,
    versions: versions
      .map((v, i) => ({
        ...v,
        changes: changesBetween(versions[i - 1], v),
        scans: usage.scans.get(usage.key(ruleId, v.version)) ?? 0,
        findings: usage.findings.get(usage.key(ruleId, v.version)) ?? 0,
      }))
      .reverse(),
    usage: perScan.map((u) => ({ ...u, findings: Number(u.findings) })),
  };
}

export function ruleVersion(db: Db, ruleId: string, version: number): RuleVersionRow {
  const v = db
    .select()
    .from(ruleVersions)
    .where(and(eq(ruleVersions.ruleId, ruleId), eq(ruleVersions.version, version)))
    .get();
  if (!v) throw new NotFoundError('Rule version not found');
  return v;
}

function validateParams(fields: RuleFields): void {
  const problems = checkParamsProblems(fields.checkType, fields.params);
  if (problems.length) throw new ValidationError(problems.join('\n'), problems);
}

/** Creates a new rule at version 1. */
export function createRule(db: Db, input: CreateRule, actor: string): RuleVersionRow {
  validateParams(input);
  if (db.select({ id: rules.id }).from(rules).where(eq(rules.id, input.ruleId)).get()) {
    throw new ConflictError(`A rule with id "${input.ruleId}" already exists.`);
  }
  return createRuleVersion(db, { ...input, version: 1, origin: ADMIN_ORIGIN }, actor).rule;
}

/**
 * Saves an edit as the next version. The editor's starting version must still be the latest, so two
 * admins can't overwrite each other; saving identical content is refused.
 */
export function addRuleVersion(
  db: Db,
  ruleId: string,
  input: NewRuleVersion,
  actor: string,
): RuleVersionRow {
  const latest = latestVersionOf(db, ruleId);
  if (!latest) throw new NotFoundError('Rule not found');
  if (latest.version !== input.expectedLatestVersion) {
    throw new ConflictError(
      `Rule ${ruleId} was changed by ${latest.createdBy} (now version ${latest.version}); reload and edit again.`,
      { latestVersion: latest.version },
    );
  }
  const { expectedLatestVersion: _, ...fields } = input;
  validateParams(fields);
  const data = { ...fields, ruleId, version: latest.version + 1, origin: ADMIN_ORIGIN };
  if (ruleContentHash(data) === latest.contentHash) {
    throw new ValidationError('Nothing changed: the rule is the same as the latest version.');
  }
  return createRuleVersion(db, data, actor).rule;
}

/** Retired rules keep their versions (old scans still use them) but are left out of new scans. */
export function setRetired(db: Db, ruleId: string, retired: boolean, actor: string): void {
  const rule = db.select().from(rules).where(eq(rules.id, ruleId)).get();
  if (!rule) throw new NotFoundError('Rule not found');
  if (!!rule.retiredAt === retired) return;
  const at = new Date().toISOString();
  db.transaction((tx) => {
    tx.update(rules)
      .set({ retiredAt: retired ? at : null })
      .where(eq(rules.id, ruleId))
      .run();
    appendAudit(tx, {
      entityType: 'rule',
      entityId: ruleId,
      action: retired ? 'retired' : 'restored',
      changes: { retiredAt: [rule.retiredAt, retired ? at : null] },
      actor,
      at,
    });
  });
}

/** The rules a scan ran with (its frozen snapshot), with finding counts. */
export function scanRuleList(db: Db, scanId: string): ScanRule[] {
  if (!db.select({ id: scans.id }).from(scans).where(eq(scans.id, scanId)).get()) {
    throw new NotFoundError('Scan not found');
  }
  return db
    .select({
      ruleId: scanRules.ruleId,
      version: scanRules.ruleVersion,
      title: ruleVersions.title,
      category: ruleVersions.category,
      severity: ruleVersions.severity,
      checkType: ruleVersions.checkType,
      enabled: scanRules.enabled,
      findings: sql<number>`(select count(*) from ${findings} where ${findings.scanId} = ${scanRules.scanId} and ${findings.ruleId} = ${scanRules.ruleId})`,
    })
    .from(scanRules)
    .innerJoin(
      ruleVersions,
      and(
        eq(ruleVersions.ruleId, scanRules.ruleId),
        eq(ruleVersions.version, scanRules.ruleVersion),
      ),
    )
    .where(eq(scanRules.scanId, scanId))
    .orderBy(ruleVersions.category, scanRules.ruleId)
    .all()
    .map((r) => ({ ...r, findings: Number(r.findings) }));
}
