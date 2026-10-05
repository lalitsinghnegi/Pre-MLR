import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  FindingViewSchema,
  RuleDetailSchema,
  RuleSummarySchema,
  ScanRuleSchema,
  type CreateRule,
  type NewRuleVersion,
  type RuleDetail,
} from '@pre-mlr/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { scans } from '../src/db/schema.js';
import { recordFindings } from '../src/findings/service.js';
import { DEFAULT_RULE_PACK_DIR, loadRulePack, syncRulePack } from '../src/rules/pack.js';
import { ruleContentHash } from '../src/rules/repository.js';
import { signIn, type Api } from './helpers/auth.js';
import { migratedDb } from './helpers/model.js';

const newRule = (o: Partial<CreateRule> = {}): CreateRule => ({
  ruleId: 'no-miracle-words',
  title: 'No "miracle" wording',
  description: 'Miracle language overstates efficacy.',
  category: 'claims',
  severity: 'major',
  checkType: 'deterministic',
  sourceCitation: '21 CFR 202.1(e)(6)(i)',
  sourceUrl: 'https://www.law.cornell.edu/cfr/text/21/202.1',
  sourceNote: null,
  lastVerified: '2026-10-04',
  promptTemplate: null,
  params: { check: 'phrase-list', label: 'Miracle wording', phrases: ['miracle', 'wonder drug'] },
  enabledByDefault: true,
  ...o,
});

describe('rule library API', () => {
  let app: FastifyInstance;
  let db: Db;
  let admin: Api;
  let author: Api;

  beforeEach(async () => {
    db = migratedDb();
    app = await buildApp({
      config: loadConfig({ LOG_LEVEL: 'silent' }),
      db,
      crawl: async () => {},
      llm: null,
      embedder: null,
      fetchImpl: async () => new Response(''),
    });
    admin = await signIn(app, db, 'rule_admin');
    author = await signIn(app, db, 'author');
  });
  afterEach(() => app.close());

  const detail = async (id: string): Promise<RuleDetail> =>
    RuleDetailSchema.parse((await author(`/api/rules/${id}`)).json());
  const edit = (id: string, o: object, as = admin) =>
    detail(id).then((d) => {
      const {
        ruleId: _r,
        version,
        origin: _o,
        contentHash: _h,
        createdAt: _c,
        createdBy: _b,
        changes: _x,
        scans: _s,
        findings: _f,
        ...fields
      } = d.versions[0]!;
      return as({
        method: 'POST',
        url: `/api/rules/${id}/versions`,
        payload: { ...fields, expectedLatestVersion: version, ...o },
      });
    });
  const startScan = async (body: object = {}) => {
    const res = await author({
      method: 'POST',
      url: '/api/scans',
      payload: { startUrl: 'https://examplin.test/', ...body },
    });
    expect(res.statusCode).toBe(202);
    await app.scanRunner.idle();
    return res.json().id as string;
  };
  const scanRulesOf = async (scanId: string) =>
    ScanRuleSchema.array().parse((await author(`/api/scans/${scanId}/rules`)).json());

  it('lists every rule with its latest version and usage', async () => {
    const list = RuleSummarySchema.array().parse((await author('/api/rules')).json());
    expect(list).toHaveLength(17);
    const sup = list.find((r) => r.ruleId === 'superlatives')!;
    expect(sup).toMatchObject({
      versionCount: 1,
      retiredAt: null,
      scans: 0,
      findings: 0,
      latest: { version: 1, origin: 'pack:public@1.0', createdBy: 'rule-pack-loader' },
    });
  });

  it('lets only rule admins change rules', async () => {
    const attempts = [
      { method: 'POST' as const, url: '/api/rules', payload: newRule() },
      { method: 'POST' as const, url: '/api/rules/superlatives/retire' },
      { method: 'POST' as const, url: '/api/rules/superlatives/restore' },
    ];
    for (const a of attempts) {
      const res = await author(a);
      expect(res.statusCode, a.url).toBe(403);
      expect(res.json().error).toBe('Only rule admins can do this.');
    }
    expect((await edit('superlatives', { title: 'Changed' }, author)).statusCode).toBe(403);
    expect((await detail('superlatives')).versions).toHaveLength(1);
  });

  it('creates a rule, validating its id, params and prompt', async () => {
    const res = await admin({ method: 'POST', url: '/api/rules', payload: newRule() });
    expect(res.statusCode).toBe(201);
    expect(RuleDetailSchema.parse(res.json()).versions[0]).toMatchObject({
      version: 1,
      origin: 'admin',
      createdBy: 'Robin Admin',
      changes: [],
    });
    const post = (o: Partial<CreateRule>) =>
      admin({ method: 'POST', url: '/api/rules', payload: newRule({ ruleId: 'another', ...o }) });
    expect((await post({ ruleId: 'no-miracle-words' })).statusCode).toBe(409);
    expect((await post({ ruleId: 'Bad Id' })).statusCode).toBe(400);
    const badCheck = await post({ params: { check: 'no-such-check' } });
    expect(badCheck.statusCode).toBe(400);
    expect(badCheck.json().error).toMatch(/params.check must name a known check/);
    const badParams = await post({ params: { check: 'phrase-list', phrases: 'not a list' } });
    expect(badParams.statusCode).toBe(400);
    expect(badParams.json().error).toMatch(/invalid params/);
    const llm = await post({ checkType: 'llm', params: {} });
    expect(llm.statusCode).toBe(400);
    expect(llm.json().error).toMatch(/prompt template/);
    expect(
      (await post({ checkType: 'llm', params: {}, promptTemplate: 'Flag implied claims.' }))
        .statusCode,
    ).toBe(201);
  });

  it('saves edits as new versions, with the changes listed and stale edits refused', async () => {
    const res = await edit('superlatives', {
      title: 'No unsupported superlatives',
      params: {
        ...(await detail('superlatives')).versions[0]!.params,
        phrases: ['best', 'safest'],
      },
    });
    expect(res.statusCode).toBe(201);
    const d = RuleDetailSchema.parse(res.json());
    expect(d.versions.map((v) => [v.version, v.origin, v.createdBy])).toEqual([
      [2, 'admin', 'Robin Admin'],
      [1, 'pack:public@1.0', 'rule-pack-loader'],
    ]);
    expect(d.versions[0]!.changes.map((c) => c.field)).toEqual(['title', 'params']);
    expect(d.versions[0]!.changes[0]).toEqual({
      field: 'title',
      from: 'No unsupported absolute or superlative language',
      to: 'No unsupported superlatives',
    });

    const stale = await admin({
      method: 'POST',
      url: '/api/rules/superlatives/versions',
      payload: { ...d.versions[0], expectedLatestVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatch(/changed by Robin Admin \(now version 2\)/);
    const same = await edit('superlatives', {});
    expect(same.statusCode).toBe(400);
    expect(same.json().error).toMatch(/Nothing changed/);
    const unknown = await admin({
      method: 'POST',
      url: '/api/rules/nope/versions',
      payload: { ...d.versions[0], expectedLatestVersion: 1 },
    });
    expect(unknown.statusCode).toBe(404);
    const audit = (await author('/api/rules/superlatives/audit')).json();
    expect(audit.map((a: { action: string; actor: string }) => [a.action, a.actor])).toEqual([
      ['version_created', 'rule-pack-loader'],
      ['version_created', 'Robin Admin'],
    ]);
  });

  it('keeps old scans on the rule versions they ran with', async () => {
    const oldScan = await startScan();
    const [finding] = recordFindings(
      db,
      oldScan,
      [{ pageId: null, ruleId: 'superlatives', detectedBy: 'rules_engine', message: 'Best.' }],
      'rules_engine',
    ).created;
    expect((await edit('superlatives', { title: 'Renamed in v2' })).statusCode).toBe(201);
    expect((await admin({ method: 'POST', url: '/api/rules/alt-text/retire' })).statusCode).toBe(
      200,
    );

    // The old scan still shows v1 and the retired rule; its finding still shows v1's title.
    const old = await scanRulesOf(oldScan);
    expect(old.find((r) => r.ruleId === 'superlatives')).toMatchObject({
      version: 1,
      title: 'No unsupported absolute or superlative language',
      findings: 1,
    });
    expect(old.some((r) => r.ruleId === 'alt-text')).toBe(true);
    const views = FindingViewSchema.array().parse(
      (await author(`/api/scans/${oldScan}/findings`)).json(),
    );
    expect(views.find((f) => f.id === finding!.id)).toMatchObject({
      ruleVersion: 1,
      rule: { title: 'No unsupported absolute or superlative language' },
    });

    // A new scan uses v2 and leaves the retired rule out.
    const fresh = await scanRulesOf(await startScan());
    expect(fresh.find((r) => r.ruleId === 'superlatives')).toMatchObject({
      version: 2,
      title: 'Renamed in v2',
    });
    expect(fresh.some((r) => r.ruleId === 'alt-text')).toBe(false);

    const d = await detail('superlatives');
    expect(d.usage.map((u) => [u.scanId, u.version, u.findings])).toEqual([
      [expect.any(String), 2, 0],
      [oldScan, 1, 1],
    ]);
    expect(d.versions.map((v) => [v.version, v.scans, v.findings])).toEqual([
      [2, 1, 0],
      [1, 1, 1],
    ]);

    const restored = await admin({ method: 'POST', url: '/api/rules/alt-text/restore' });
    expect(RuleDetailSchema.parse(restored.json()).retiredAt).toBeNull();
    expect((await scanRulesOf(await startScan())).some((r) => r.ruleId === 'alt-text')).toBe(true);
  });

  it('turns rules on or off for one scan only', async () => {
    const scanId = await startScan({ rules: { disable: ['superlatives'], enable: [] } });
    const list = await scanRulesOf(scanId);
    expect(list.find((r) => r.ruleId === 'superlatives')!.enabled).toBe(false);
    expect(list.find((r) => r.ruleId === 'alt-text')!.enabled).toBe(true);
    expect(db.select().from(scans).get()!.createdBy).toBe('Pat Reviewer');
    expect((await author('/api/scans/nope/rules')).statusCode).toBe(404);
  });

  it('exports a version as pack YAML that loads back to identical content', async () => {
    await edit('superlatives', { title: 'Edited title', sourceNote: 'TODO: confirm scope.' });
    const dir = await mkdtemp(join(tmpdir(), 'pre-mlr-pack-'));
    try {
      await writeFile(
        join(dir, 'pack.yaml'),
        'name: exported\nversion: "1"\ndescription: Round trip.\n',
      );
      await cp(join(DEFAULT_RULE_PACK_DIR, 'rules'), join(dir, 'rules'), { recursive: true });
      const res = await author('/api/rules/superlatives/versions/2/yaml');
      expect(res.headers['content-type']).toBe('text/yaml; charset=utf-8');
      expect(res.headers['content-disposition']).toBe('attachment; filename="superlatives.yaml"');
      expect(parse(res.body)).toMatchObject({
        id: 'superlatives',
        version: 2,
        title: 'Edited title',
      });
      await writeFile(join(dir, 'rules', 'superlatives.yaml'), res.body);

      const loaded = (await loadRulePack(dir)).rules.find((r) => r.ruleId === 'superlatives')!;
      const stored = (await detail('superlatives')).versions[0]!;
      expect(ruleContentHash({ ...loaded, origin: 'x' } as never)).toBe(stored.contentHash);
      expect((await author('/api/rules/superlatives/versions/9/yaml')).statusCode).toBe(404);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('rule pack sync after admin edits', () => {
  it('keeps admin versions over older YAML, applies newer YAML, and still rejects unbumped pack edits', async () => {
    const db = migratedDb();
    await syncRulePack(db, DEFAULT_RULE_PACK_DIR);
    const { addRuleVersion } = await import('../src/rules/admin.js');
    const v1 = (await loadRulePack(DEFAULT_RULE_PACK_DIR)).rules.find(
      (r) => r.ruleId === 'superlatives',
    )!;
    const { ruleId: _id, version: _v, origin: _o, ...fields } = v1;
    addRuleVersion(
      db,
      'superlatives',
      { ...fields, title: 'Admin title', expectedLatestVersion: 1 } as NewRuleVersion,
      'Robin Admin',
    );

    const again = await syncRulePack(db, DEFAULT_RULE_PACK_DIR);
    expect(again.created).toEqual([]);
    expect(again.skipped).toEqual([
      'superlatives@1: edited in the app (v2 by Robin Admin); the YAML is older',
    ]);

    const dir = await mkdtemp(join(tmpdir(), 'pre-mlr-pack-'));
    try {
      await cp(DEFAULT_RULE_PACK_DIR, dir, { recursive: true });
      const file = join(dir, 'rules', 'superlatives.yaml');
      const yaml = await readFile(file, 'utf8');
      await writeFile(
        file,
        yaml.replace(/^version: 1$/m, 'version: 3').replace(/^title: .*$/m, 'title: From YAML v3'),
      );
      expect((await syncRulePack(db, dir)).created).toEqual(['superlatives@3']);

      // A pack-owned rule changed without a version bump is still a mistake.
      const alt = join(dir, 'rules', 'alt-text.yaml');
      await writeFile(alt, (await readFile(alt, 'utf8')).replace(/^title: .*$/m, 'title: Sneaky'));
      await expect(syncRulePack(db, dir)).rejects.toThrow(/already exists with different content/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
