import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditFor } from '../src/audit/log.js';
import type { Db } from '../src/db/client.js';
import { rules, scanRules } from '../src/db/schema.js';
import { ConflictError, ValidationError } from '../src/errors.js';
import {
  createRuleVersion,
  latestRuleVersions,
  ruleContentHash,
  scanRuleVersions,
  snapshotScanRules,
} from '../src/rules/repository.js';
import { RuleVersionInputSchema } from '@pre-mlr/shared';
import { migratedDb, ruleInput, seedScan } from './helpers/model.js';

describe('rule versions', () => {
  let db: Db;
  beforeEach(() => {
    db = migratedDb();
  });

  it('creates a rule and its first version, with an audit entry', () => {
    const res = createRuleVersion(db, ruleInput(), 'loader');
    expect(res.status).toBe('created');
    expect(res.rule).toMatchObject({
      ruleId: 'isi-presence',
      version: 1,
      enabledByDefault: true,
      params: { headings: ['Important Safety Information'] },
      lastVerified: null,
      createdBy: 'loader',
    });
    expect(db.select().from(rules).all()).toHaveLength(1);
    expect(auditFor(db, 'rule', 'isi-presence')).toMatchObject([
      { action: 'version_created', changes: { version: [null, 1] }, actor: 'loader' },
    ]);
  });

  it('treats re-adding identical content as unchanged (pack reloads are safe)', () => {
    createRuleVersion(db, ruleInput(), 'loader');
    const again = createRuleVersion(db, ruleInput({ origin: 'pack:public@1.1' }), 'loader');
    expect(again.status).toBe('unchanged');
    expect(auditFor(db, 'rule', 'isi-presence')).toHaveLength(1);
  });

  it('rejects changed content under an existing version', () => {
    createRuleVersion(db, ruleInput(), 'loader');
    expect(() => createRuleVersion(db, ruleInput({ severity: 'minor' }), 'loader')).toThrow(
      ConflictError,
    );
    expect(() =>
      createRuleVersion(db, ruleInput({ params: { headings: ['ISI'] } }), 'loader'),
    ).toThrow(/bump the version/);
  });

  it('only accepts versions newer than the latest', () => {
    createRuleVersion(db, ruleInput({ version: 2 }), 'loader');
    expect(() =>
      createRuleVersion(db, ruleInput({ version: 1, title: 'Older' }), 'loader'),
    ).toThrow(/newer than 2/);
    expect(
      createRuleVersion(db, ruleInput({ version: 3, severity: 'major' }), 'admin').status,
    ).toBe('created');
    expect(latestRuleVersions(db).map((r) => [r.ruleId, r.version, r.severity])).toEqual([
      ['isi-presence', 3, 'major'],
    ]);
  });

  it('validates rule content', () => {
    expect(() => createRuleVersion(db, ruleInput({ category: 'vibes' as never }), 'x')).toThrow(
      ValidationError,
    );
    expect(() => createRuleVersion(db, ruleInput({ ruleId: 'Not Kebab' }), 'x')).toThrow(
      ValidationError,
    );
    expect(() => createRuleVersion(db, ruleInput({ checkType: 'llm' }), 'x')).toThrow(
      ValidationError,
    );
    expect(
      createRuleVersion(
        db,
        ruleInput({ ruleId: 'claims-llm', checkType: 'llm', promptTemplate: 'Check {{text}}' }),
        'x',
      ).status,
    ).toBe('created');
  });

  it('hashes content independent of key order and ignores origin', () => {
    const a = RuleVersionInputSchema.parse(ruleInput({ params: { a: 1, b: [1, 2] } }));
    const b = RuleVersionInputSchema.parse(
      ruleInput({ params: { b: [1, 2], a: 1 }, origin: 'elsewhere' }),
    );
    expect(ruleContentHash(a)).toBe(ruleContentHash(b));
    const c = RuleVersionInputSchema.parse(ruleInput({ params: { a: 1, b: [2, 1] } }));
    expect(ruleContentHash(c)).not.toBe(ruleContentHash(a));
  });

  it('leaves retired rules out of the latest set', () => {
    createRuleVersion(db, ruleInput(), 'loader');
    createRuleVersion(db, ruleInput({ ruleId: 'alt-text', category: 'accessibility' }), 'loader');
    db.update(rules)
      .set({ retiredAt: new Date().toISOString() })
      .where(eq(rules.id, 'alt-text'))
      .run();
    expect(latestRuleVersions(db).map((r) => r.ruleId)).toEqual(['isi-presence']);
  });
});

describe('scan rule snapshots', () => {
  it('freezes the versions a scan runs with; later versions do not affect it', () => {
    const db = migratedDb();
    createRuleVersion(db, ruleInput(), 'loader');
    createRuleVersion(
      db,
      ruleInput({ ruleId: 'alt-text', category: 'accessibility', enabledByDefault: false }),
      'loader',
    );
    const { scanId } = seedScan(db);

    snapshotScanRules(db, scanId);
    createRuleVersion(db, ruleInput({ version: 2, severity: 'major' }), 'admin');
    snapshotScanRules(db, scanId); // idempotent: keeps the original snapshot

    expect(scanRuleVersions(db, scanId).map((r) => [r.ruleId, r.version])).toEqual([
      ['isi-presence', 1],
    ]);
    expect(scanRuleVersions(db, scanId, true).map((r) => [r.ruleId, r.version])).toEqual([
      ['alt-text', 1],
      ['isi-presence', 1],
    ]);

    const { scanId: later } = seedScan(db, 'scan-2');
    snapshotScanRules(db, later);
    expect(scanRuleVersions(db, later).map((r) => [r.ruleId, r.version])).toEqual([
      ['isi-presence', 2],
    ]);
    expect(db.select().from(scanRules).where(eq(scanRules.scanId, later)).all()).toHaveLength(2);
  });
});

describe('per-scan rule overrides', () => {
  it('enables and disables rules for one scan and rejects unknown ids', () => {
    const db = migratedDb();
    createRuleVersion(db, ruleInput(), 'loader');
    createRuleVersion(
      db,
      ruleInput({ ruleId: 'alt-text', category: 'accessibility', enabledByDefault: false }),
      'loader',
    );
    const { scanId } = seedScan(db);
    snapshotScanRules(db, scanId, { enable: ['alt-text'], disable: ['isi-presence'] });
    expect(scanRuleVersions(db, scanId).map((r) => r.ruleId)).toEqual(['alt-text']);

    const { scanId: other } = seedScan(db, 'scan-2');
    expect(() => snapshotScanRules(db, other, { enable: ['nope'] })).toThrow(
      /Unknown rule id\(s\): nope/,
    );
    expect(scanRuleVersions(db, other, true)).toEqual([]);
  });
});
