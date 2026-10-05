import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RULE_CATEGORIES } from '@pre-mlr/shared';
import { auditFor } from '../src/audit/log.js';
import { ConflictError } from '../src/errors.js';
import { DEFAULT_RULE_PACK_DIR, loadRulePack, syncRulePack } from '../src/rules/pack.js';
import { latestRuleVersions } from '../src/rules/repository.js';
import { migratedDb } from './helpers/model.js';

describe('public rule pack', () => {
  it('loads all 17 rules with valid params and sources', async () => {
    const pack = await loadRulePack(DEFAULT_RULE_PACK_DIR);
    expect(pack).toMatchObject({ name: 'public', version: '1.0' });
    expect(pack.rules).toHaveLength(17);
    const byId = new Map(pack.rules.map((r) => [r.ruleId, r]));
    expect(byId.get('med-guide-link')!.enabledByDefault).toBe(false);
    expect(
      [...byId.values()]
        .filter((r) => r.checkType === 'llm')
        .map((r) => r.ruleId)
        .sort(),
    ).toEqual(['off-label-implied', 'risk-benefit-balance']);
    // Every category is covered, and every rule cites something.
    expect(new Set(pack.rules.map((r) => r.category))).toEqual(new Set(RULE_CATEGORIES));
    for (const r of pack.rules) {
      expect(r.sourceCitation.length, r.ruleId).toBeGreaterThan(5);
      // Unverified sources must say why.
      if (!r.lastVerified) expect(r.sourceNote, r.ruleId).toMatch(/TODO/);
    }
    // Pack defaults fill excludePaths unless a rule sets its own.
    expect((byId.get('superlatives')!.params as { excludePaths: string[] }).excludePaths).toContain(
      '/privacy',
    );
    expect((byId.get('privacy-link')!.params as { excludePaths: string[] }).excludePaths).toEqual(
      [],
    );
  });

  it('syncs into the database once; reloading is a no-op', async () => {
    const db = migratedDb();
    expect(await syncRulePack(db, DEFAULT_RULE_PACK_DIR)).toMatchObject({
      pack: 'public@1.0',
      unchanged: 0,
    });
    expect(latestRuleVersions(db)).toHaveLength(17);
    expect(await syncRulePack(db, DEFAULT_RULE_PACK_DIR)).toMatchObject({
      created: [],
      unchanged: 17,
    });
    expect(auditFor(db, 'rule', 'superlatives')).toHaveLength(1);
    expect(latestRuleVersions(db)[0]!.origin).toBe('pack:public@1.0');
  });
});

/** The error loadRulePack throws for an invalid pack. */
async function loadError(dir: string): Promise<Error> {
  try {
    await loadRulePack(dir);
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected the pack to be rejected');
}

describe('rule pack validation', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pre-mlr-pack-'));
    await cp(DEFAULT_RULE_PACK_DIR, dir, { recursive: true });
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const ruleFile = (id: string) => join(dir, 'rules', `${id}.yaml`);
  const edit = async (id: string, fn: (s: string) => string) =>
    writeFile(ruleFile(id), fn(await readFile(ruleFile(id), 'utf8')));

  it('rejects an unknown check', async () => {
    await edit('superlatives', (s) => s.replace('check: phrase-list', 'check: vibes'));
    await expect(loadRulePack(dir)).rejects.toThrow(
      /superlatives\.yaml: params\.check must name a known check, got "vibes"/,
    );
  });

  it('rejects invalid check params and bad regexes', async () => {
    await edit('superlatives', (s) => s.replace('label: Absolute or superlative language', ''));
    await edit('ae-reporting-statement', (s) => s.replace("'fda\\.gov/medwatch'", "'fda(gov'"));
    const err = await loadError(dir);
    expect(err.message).toMatch(/superlatives\.yaml: invalid params/);
    expect(err.message).toMatch(
      /ae-reporting-statement\.yaml: invalid params[\s\S]*valid regular expression/,
    );
  });

  it('rejects unknown fields, a mismatched file name and LLM rules without a prompt', async () => {
    await edit('alt-text', (s) => `${s}\nsevrity: minor\n`);
    await writeFile(
      join(dir, 'rules', 'copy.yaml'),
      await readFile(ruleFile('broken-links'), 'utf8'),
    );
    await edit('off-label-implied', (s) => s.replace(/prompt_template: \|[\s\S]*$/, ''));
    const err = await loadError(dir);
    expect(err.message).toMatch(/alt-text\.yaml:[\s\S]*sevrity/);
    expect(err.message).toMatch(/copy\.yaml: file name must be "broken-links\.yaml"/);
    expect(err.message).toMatch(/copy\.yaml: duplicate rule id "broken-links"/);
    expect(err.message).toMatch(/off-label-implied\.yaml:[\s\S]*promptTemplate/);
  });

  it('refuses changed content without a version bump, and accepts it with one', async () => {
    const db = migratedDb();
    await syncRulePack(db, dir);
    await edit('superlatives', (s) =>
      s.replace('    - unmatched\n', '    - unmatched\n    - proven\n'),
    );
    await expect(syncRulePack(db, dir)).rejects.toThrow(ConflictError);
    await edit('superlatives', (s) => s.replace('version: 1', 'version: 2'));
    expect(await syncRulePack(db, dir)).toMatchObject({
      created: ['superlatives@2'],
      unchanged: 16,
    });
  });
});
