import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { appendAudit, auditFor } from '../src/audit/log.js';
import type { Db } from '../src/db/client.js';
import { auditLog, findings, scans } from '../src/db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../src/errors.js';
import {
  findingFingerprint,
  recordFindings,
  updateFinding,
  type NewFinding,
} from '../src/findings/service.js';
import { createRuleVersion, snapshotScanRules } from '../src/rules/repository.js';
import { migratedDb, ruleInput, seedScan } from './helpers/model.js';

describe('findings and audit log', () => {
  let db: Db;
  let ids: ReturnType<typeof seedScan>;

  const finding = (overrides: Partial<NewFinding> = {}): NewFinding => ({
    pageId: ids.homeId,
    ruleId: 'superlatives',
    detectedBy: 'rules_engine',
    message: 'Absolute claim "best"',
    evidenceText: 'The best treatment available',
    evidenceLocation: { view: 'desktop', x: 10, y: 20, width: 300, height: 24 },
    suggestedFix: 'An effective treatment option',
    ...overrides,
  });

  beforeEach(() => {
    db = migratedDb();
    createRuleVersion(
      db,
      ruleInput({ ruleId: 'superlatives', category: 'claims', severity: 'major' }),
      'loader',
    );
    createRuleVersion(
      db,
      ruleInput({ ruleId: 'privacy-link', category: 'legal_privacy', severity: 'minor' }),
      'loader',
    );
    ids = seedScan(db);
    snapshotScanRules(db, ids.scanId);
  });

  describe('recordFindings', () => {
    it('stores findings against the snapshot version, open at revision 1, with a created audit entry', () => {
      createRuleVersion(
        db,
        ruleInput({ ruleId: 'superlatives', version: 2, category: 'claims', severity: 'critical' }),
        'admin',
      );
      const { created, skipped } = recordFindings(db, ids.scanId, [finding()], 'rules_engine');
      expect(skipped).toBe(0);
      expect(created[0]).toMatchObject({
        ruleVersion: 1, // the snapshot, not the newer version 2
        severity: 'major', // default from the rule version
        status: 'open',
        revision: 1,
        editedFix: null,
        evidenceLocation: { view: 'desktop', x: 10, y: 20, width: 300, height: 24 },
        updatedBy: 'rules_engine',
      });
      expect(auditFor(db, 'finding', created[0]!.id)).toMatchObject([
        { action: 'created', scanId: ids.scanId, changes: { status: [null, 'open'] } },
      ]);
    });

    it('allows site-wide findings with no page', () => {
      const { created } = recordFindings(
        db,
        ids.scanId,
        [finding({ pageId: null, ruleId: 'privacy-link', evidenceText: null })],
        'x',
      );
      expect(created[0]).toMatchObject({ pageId: null, severity: 'minor' });
    });

    it('skips duplicates by fingerprint (case and whitespace insensitive evidence)', () => {
      recordFindings(db, ids.scanId, [finding()], 'x');
      const again = recordFindings(
        db,
        ids.scanId,
        [
          finding({ evidenceText: '  the BEST   treatment available ' }),
          finding({ pageId: ids.aboutId }),
        ],
        'x',
      );
      expect(again).toMatchObject({ skipped: 1 });
      expect(again.created.map((f) => f.pageId)).toEqual([ids.aboutId]);
      expect(db.select().from(findings).all()).toHaveLength(2);
    });

    it('fingerprints differ by rule, page and evidence', () => {
      const base = { ruleId: 'a', pageId: 'p', evidenceText: 'x' };
      const fp = findingFingerprint(base);
      expect(findingFingerprint({ ...base, ruleId: 'b' })).not.toBe(fp);
      expect(findingFingerprint({ ...base, pageId: null })).not.toBe(fp);
      expect(findingFingerprint({ ...base, evidenceText: 'y' })).not.toBe(fp);
    });

    it('rejects rules not enabled for the scan, foreign pages and bad confidence, atomically', () => {
      expect(() =>
        recordFindings(db, ids.scanId, [finding(), finding({ ruleId: 'unknown' })], 'x'),
      ).toThrow(ValidationError);
      expect(db.select().from(findings).all()).toHaveLength(0); // first one rolled back too
      const other = seedScan(db, 'scan-2');
      expect(() =>
        recordFindings(db, ids.scanId, [finding({ pageId: other.homeId })], 'x'),
      ).toThrow(/not part of scan/);
      expect(() => recordFindings(db, ids.scanId, [finding({ confidence: 1.5 })], 'x')).toThrow(
        /confidence/,
      );
    });
  });

  describe('updateFinding', () => {
    let id: string;
    beforeEach(() => {
      id = recordFindings(db, ids.scanId, [finding()], 'rules_engine').created[0]!.id;
    });
    const actions = () => auditFor(db, 'finding', id).map((a) => [a.action, a.changes, a.actor]);

    it('accepts and rejects, bumping the revision and logging each status change', () => {
      expect(updateFinding(db, id, { status: 'accepted' }, 'alice')).toMatchObject({
        status: 'accepted',
        revision: 2,
        updatedBy: 'alice',
      });
      expect(updateFinding(db, id, { status: 'rejected' }, 'bob')).toMatchObject({
        status: 'rejected',
        revision: 3,
      });
      expect(updateFinding(db, id, { status: 'open' }, 'alice')).toMatchObject({
        status: 'open',
        revision: 4,
      });
      expect(actions().slice(1)).toEqual([
        ['status_changed', { status: ['open', 'accepted'] }, 'alice'],
        ['status_changed', { status: ['accepted', 'rejected'] }, 'bob'],
        ['status_changed', { status: ['rejected', 'open'] }, 'alice'],
      ]);
    });

    it('editing the fix sets status "edited" and keeps the original suggestion', () => {
      const f = updateFinding(db, id, { editedFix: 'A proven option' }, 'alice');
      expect(f).toMatchObject({
        status: 'edited',
        editedFix: 'A proven option',
        suggestedFix: 'An effective treatment option',
      });
      expect(actions().slice(1)).toEqual([
        ['status_changed', { status: ['open', 'edited'] }, 'alice'],
        ['fix_edited', { editedFix: [null, 'A proven option'] }, 'alice'],
      ]);
    });

    it('records comments, including clearing them', () => {
      updateFinding(db, id, { comment: 'Checked with legal' }, 'alice');
      const f = updateFinding(db, id, { comment: '' }, 'alice');
      expect(f.authorComment).toBeNull();
      expect(actions().slice(1)).toEqual([
        ['commented', { authorComment: [null, 'Checked with legal'] }, 'alice'],
        ['commented', { authorComment: ['Checked with legal', null] }, 'alice'],
      ]);
    });

    it('is a no-op when nothing changes', () => {
      updateFinding(db, id, { status: 'accepted' }, 'alice');
      expect(updateFinding(db, id, { status: 'accepted' }, 'bob')).toMatchObject({
        revision: 2,
        updatedBy: 'alice',
      });
      expect(actions()).toHaveLength(2);
    });

    it('enforces the edited/editedFix rules', () => {
      expect(() => updateFinding(db, id, { status: 'edited' }, 'a')).toThrow(/needs an editedFix/);
      expect(() => updateFinding(db, id, { status: 'accepted', editedFix: 'x' }, 'a')).toThrow(
        ValidationError,
      );
      expect(() => updateFinding(db, id, {}, 'a')).toThrow(/Nothing to update/);
      // Moving away from "edited" keeps the author's text for the record.
      updateFinding(db, id, { editedFix: 'Mine' }, 'a');
      expect(updateFinding(db, id, { status: 'accepted' }, 'a')).toMatchObject({
        status: 'accepted',
        editedFix: 'Mine',
      });
    });

    it('rejects stale revisions without changing anything', () => {
      updateFinding(db, id, { status: 'accepted', expectedRevision: 1 }, 'alice');
      expect(() =>
        updateFinding(db, id, { status: 'rejected', expectedRevision: 1 }, 'bob'),
      ).toThrow(ConflictError);
      expect(db.select().from(findings).where(eq(findings.id, id)).get()).toMatchObject({
        status: 'accepted',
        revision: 2,
      });
      expect(actions()).toHaveLength(2);
    });

    it('404s for unknown findings', () => {
      expect(() => updateFinding(db, 'nope', { status: 'accepted' }, 'a')).toThrow(NotFoundError);
    });
  });

  describe('audit_log is append-only', () => {
    beforeEach(() => {
      appendAudit(db, {
        entityType: 'finding',
        entityId: 'f',
        action: 'created',
        changes: {},
        actor: 'a',
        at: 'now',
      });
    });

    it('blocks UPDATE and DELETE at the database level', () => {
      expect(() => db.update(auditLog).set({ actor: 'mallory' }).run()).toThrow(/append-only/);
      expect(() => db.delete(auditLog).run()).toThrow(/append-only/);
      expect(() => db.$client.exec('DELETE FROM audit_log')).toThrow(/append-only/);
      expect(() => db.$client.exec("UPDATE audit_log SET actor = 'x'")).toThrow(/append-only/);
      expect(auditFor(db, 'finding', 'f')).toMatchObject([{ actor: 'a' }]);
      expect(db.select().from(auditLog).all()).toHaveLength(3); // + 2 rule version_created entries
    });

    it('outlives a deleted scan, whose findings are removed', () => {
      const { created } = recordFindings(db, ids.scanId, [finding()], 'x');
      updateFinding(db, created[0]!.id, { status: 'accepted' }, 'alice');
      db.delete(scans).where(eq(scans.id, ids.scanId)).run();
      expect(db.select().from(findings).all()).toHaveLength(0);
      expect(auditFor(db, 'finding', created[0]!.id).map((a) => a.action)).toEqual([
        'created',
        'status_changed',
      ]);
    });
  });
});
