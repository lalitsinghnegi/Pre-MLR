import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CandidateRulesSchema,
  PrecedentTrendsSchema,
  type CandidateRules,
  type PrecedentTrends,
} from '@pre-mlr/shared';
import { signIn, type Api } from './helpers/auth.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { auditLog, precedentClassifications, precedents } from '../src/db/schema.js';
import { MockProvider } from '../src/llm/mock.js';
import type { LLMProvider, LlmRequest, LlmResponse } from '../src/llm/types.js';
import {
  classifierRules,
  classifyPrecedents,
  pendingPrecedents,
  renderComments,
  validateClassifications,
  type ClassifierRule,
} from '../src/precedent/classify.js';
import { clusterNoMatch, tokenize, type ClusterInput } from '../src/precedent/clusters.js';
import { importPrecedents } from '../src/precedent/importer.js';
import { loadMapping } from '../src/precedent/mapping.js';
import { scoreClassifications } from '../src/precedent/score.js';
import { periodOf, periodRange } from '../src/precedent/trends.js';
import { syncRulePack } from '../src/rules/pack.js';
import { migratedDb } from './helpers/model.js';

const ROOT = join(import.meta.dirname, '../..');
const DATA = join(ROOT, 'test-sites/precedent');
const RULE_PACK = join(ROOT, 'rule-packs/public');
const KEY = 'test-key-0123456789abcdef';
/** Rows that import cleanly: 150 minus 4 invalid and 1 duplicate. */
const IMPORTED = 145;

let labels: Record<string, string>;
beforeAll(async () => {
  labels = JSON.parse(
    await readFile(join(DATA, 'synthetic-mlr-comments.labels.json'), 'utf8'),
  ) as Record<string, string>;
});

/** A database with the public rule pack and the synthetic comments imported. */
async function seededDb(): Promise<Db> {
  const db = migratedDb();
  await syncRulePack(db, RULE_PACK);
  await importPrecedents(db, {
    file: join(DATA, 'synthetic-mlr-comments.xlsx'),
    mapping: await loadMapping('default'),
    site: 'examplin.test',
    pseudonymKey: KEY,
    actor: 'tester',
  });
  return db;
}

/** Records requests and answers each with a scripted response (or throws). */
class ScriptedProvider implements LLMProvider {
  readonly name = 'mock' as const;
  readonly model = 'scripted-1';
  readonly settings = {};
  readonly requests: LlmRequest[] = [];
  constructor(
    private readonly script: ((req: LlmRequest, n: number) => Partial<LlmResponse>) | Error,
  ) {}
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    if (this.script instanceof Error) throw this.script;
    return {
      output: null,
      rawText: '',
      model: this.model,
      stopReason: 'end_turn',
      servedByFallback: false,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      ...this.script(req, this.requests.length),
    };
  }
}

const idsIn = (req: LlmRequest) =>
  [...req.userText.matchAll(/<comment id="(c\d+)"/g)].map((m) => m[1]!);
const answer = (id: string, category = 'claims', extra: object = {}) => ({
  id,
  category,
  ruleId: null,
  confidence: 0.8,
  topic: 'a topic',
  ...extra,
});

const RULES: ClassifierRule[] = [
  { ruleId: 'superlatives', version: 1, category: 'claims', title: 'T', description: 'D' },
  { ruleId: 'alt-text', version: 1, category: 'accessibility', title: 'T', description: 'D' },
];

describe('validateClassifications', () => {
  it('accepts valid answers and maps "none" to no matching rule', () => {
    const { valid, problems } = validateClassifications(
      {
        classifications: [
          answer('c1', 'claims', { ruleId: 'superlatives' }),
          answer('c2', 'none', { topic: '  image   rights ' }),
        ],
      },
      { ids: ['c1', 'c2'], rules: RULES },
    );
    expect(problems).toEqual([]);
    expect(valid.get('c1')).toEqual({
      category: 'claims',
      ruleId: 'superlatives',
      confidence: 0.8,
      noMatchingRule: false,
      topic: 'a topic',
    });
    expect(valid.get('c2')).toMatchObject({
      category: null,
      ruleId: null,
      noMatchingRule: true,
      topic: 'image rights',
    });
  });

  it('reports unknown ids, duplicates, unknown categories, bad confidence and missing answers', () => {
    const { valid, problems } = validateClassifications(
      {
        classifications: [
          answer('c1'),
          answer('c1', 'links'),
          answer('c9'),
          answer('c2', 'tone'),
          answer('c3', 'claims', { confidence: 1.5 }),
          { id: 'c4' },
        ],
      },
      { ids: ['c1', 'c2', 'c3', 'c4', 'c5'], rules: RULES },
    );
    expect([...valid.keys()]).toEqual(['c1']);
    expect(valid.get('c1')!.category).toBe('claims');
    expect(problems).toEqual([
      'Comment c1 was classified more than once.',
      'Unknown comment id "c9".',
      'Comment c2: unknown category "tone".',
      'Comment c3: confidence must be between 0 and 1.',
      'Item 6 is missing id, category or confidence, or has the wrong types.',
      'Still needed: a valid classification for c2, c3, c4, c5.',
    ]);
  });

  it('drops a rule id that is unknown or outside the chosen category, keeping the category', () => {
    const { valid } = validateClassifications(
      {
        classifications: [
          answer('c1', 'claims', { ruleId: 'alt-text' }),
          answer('c2', 'claims', { ruleId: 'made-up' }),
          answer('c3', 'none', { ruleId: 'superlatives', topic: '' }),
        ],
      },
      { ids: ['c1', 'c2', 'c3'], rules: RULES },
    );
    expect(valid.get('c1')).toMatchObject({ category: 'claims', ruleId: null });
    expect(valid.get('c2')).toMatchObject({ category: 'claims', ruleId: null });
    expect(valid.get('c3')).toMatchObject({ noMatchingRule: true, ruleId: null, topic: 'other' });
  });

  it('rejects output without a classifications array', () => {
    expect(validateClassifications({ findings: [] }, { ids: ['c1'], rules: RULES })).toEqual({
      valid: new Map(),
      problems: ['The answer must be an object with a "classifications" array.'],
    });
  });
});

describe('renderComments', () => {
  it('escapes markup so a comment cannot close its own tag', () => {
    expect(
      renderComments([
        { key: 'c1', text: 'Use <b>bold</b> & </comment>', reviewerFunction: 'A"B' },
      ]),
    ).toBe(
      '<comment id="c1" function="A&quot;B">Use &lt;b&gt;bold&lt;/b&gt; &amp; &lt;/comment&gt;</comment>',
    );
  });
});

describe('classifyPrecedents with the mock provider', () => {
  let db: Db;
  beforeEach(async () => {
    db = await seededDb();
  });

  it('classifies every comment against the answer key and audits each one', async () => {
    const result = await classifyPrecedents(db, {
      provider: new MockProvider(),
      actor: 'tester',
    });
    expect(result).toMatchObject({
      total: IMPORTED,
      upToDate: 0,
      classified: IMPORTED,
      failed: 0,
      requests: Math.ceil(IMPORTED / 20),
      costUsd: 0,
    });
    expect(result.promptVersion).toMatch(/^v1#[0-9a-f]{8}$/);

    const score = scoreClassifications(db, labels);
    expect(score.scored).toBe(IMPORTED);
    expect(score.failed).toBe(0);
    // The mock is a keyword matcher written for this dataset: this checks the pipeline, not a model.
    expect(score.accuracy).toBeGreaterThanOrEqual(0.95);
    expect(score.noMatchRecall).toBeGreaterThanOrEqual(0.95);
    expect(score.noMatchPrecision).toBeGreaterThanOrEqual(0.95);
    const offRule = Object.values(labels).filter((l) => l.startsWith('off_rule:')).length;
    expect(result.noMatchingRule).toBeGreaterThanOrEqual(offRule - 1);

    const audits = db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'precedent'), eq(auditLog.action, 'classified')))
      .all();
    expect(audits).toHaveLength(IMPORTED);
    expect(audits[0]!.changes).toMatchObject({ status: [null, 'ok'] });
  });

  it('skips current classifications on a re-run, and re-runs everything with force', async () => {
    const provider = new MockProvider();
    await classifyPrecedents(db, { provider, actor: 'tester' });
    const again = await classifyPrecedents(db, { provider, actor: 'tester' });
    expect(again).toMatchObject({ upToDate: IMPORTED, classified: 0, requests: 0 });

    const auditCount = () =>
      db.select().from(auditLog).where(eq(auditLog.entityType, 'precedent')).all().length;
    const before = auditCount();
    const forced = await classifyPrecedents(db, { provider, actor: 'tester', force: true });
    expect(forced).toMatchObject({ upToDate: 0, classified: IMPORTED });
    // Same answers from the same classifier: nothing changed, so nothing new to audit.
    expect(auditCount()).toBe(before);
  });

  it('treats a different model or rule pack as out of date', async () => {
    const provider = new MockProvider();
    const first = await classifyPrecedents(db, { provider, actor: 'tester' });
    const key = {
      provider: 'mock',
      model: 'mock-1',
      promptVersion: first.promptVersion,
      rulePackHash: first.rulePackHash,
    };
    expect(pendingPrecedents(db, key).pending).toHaveLength(0);
    expect(pendingPrecedents(db, { ...key, model: 'mock-2' }).pending).toHaveLength(IMPORTED);
    expect(pendingPrecedents(db, { ...key, rulePackHash: 'other' }).pending).toHaveLength(IMPORTED);
    expect(classifierRules(db).length).toBeGreaterThan(10);
  });
});

describe('classifyPrecedents retries and failures', () => {
  let db: Db;
  beforeEach(async () => {
    db = await seededDb();
  });

  it('retries only the unanswered comments, with the problems as feedback', async () => {
    const provider = new ScriptedProvider((req, n) => {
      const ids = idsIn(req);
      // First attempt: skip the second comment and give the third an unknown category.
      if (n % 2 === 1) {
        return {
          output: {
            classifications: ids
              .filter((_, i) => i !== 1)
              .map((id, i) => answer(id, i === 1 ? 'tone' : 'claims')),
          },
        };
      }
      return { output: { classifications: ids.map((id) => answer(id, 'none')) } };
    });
    const result = await classifyPrecedents(db, {
      provider,
      actor: 'tester',
      batchSize: 5,
      concurrency: 1,
    });
    expect(result).toMatchObject({ classified: IMPORTED, failed: 0 });
    expect(result.requests).toBe(Math.ceil(IMPORTED / 5) * 2);

    const [first, retry] = provider.requests;
    expect(first!.task).toBe('precedent-classification');
    expect(first!.image).toBeNull();
    expect(first!.rulesBlock).toContain('<category id="safety_information">');
    expect(first!.rulesBlock).toContain('- superlatives:');
    expect(idsIn(first!)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(idsIn(retry!)).toEqual(['c2', 'c3']);
    expect(retry!.userText).toContain('Comment c3: unknown category "tone".');
    expect(retry!.userText).toContain('a valid classification for c2, c3');

    const rows = db.select().from(precedentClassifications).all();
    expect(rows.filter((r) => r.noMatchingRule)).toHaveLength(Math.ceil(IMPORTED / 5) * 2);
  });

  it('stores comments still unanswered after the retry as failed, and retries them next run', async () => {
    const provider = new ScriptedProvider((req) => ({
      output: {
        classifications: idsIn(req)
          .slice(1)
          .map((id) => answer(id)),
      },
    }));
    const result = await classifyPrecedents(db, { provider, actor: 'tester', batchSize: 50 });
    expect(result).toMatchObject({ classified: IMPORTED - 3, failed: 3, requests: 6 });
    const failed = db
      .select()
      .from(precedentClassifications)
      .where(eq(precedentClassifications.status, 'failed'))
      .all();
    expect(failed).toHaveLength(3);
    expect(failed[0]).toMatchObject({
      category: null,
      noMatchingRule: false,
      error: 'No valid classification after one retry.',
    });

    const next = await classifyPrecedents(db, { provider: new MockProvider(), actor: 'tester' });
    expect(next.total).toBe(IMPORTED);
    // Different model, so everything is redone; with the same model only the failed ones would be.
    expect(
      pendingPrecedents(db, {
        provider: 'mock',
        model: 'scripted-1',
        promptVersion: next.promptVersion,
        rulePackHash: next.rulePackHash,
      }).pending,
    ).toHaveLength(IMPORTED);
  });

  it('records provider errors and refusals per comment without throwing', async () => {
    const boom = await classifyPrecedents(db, {
      provider: new ScriptedProvider(new Error('socket hang up')),
      actor: 'tester',
      batchSize: 100,
    });
    expect(boom).toMatchObject({ classified: 0, failed: IMPORTED, requests: 0 });
    expect(db.select().from(precedentClassifications).get()).toMatchObject({
      status: 'failed',
      error: 'socket hang up',
    });

    const refused = await classifyPrecedents(db, {
      provider: new ScriptedProvider(() => ({ stopReason: 'refusal' })),
      actor: 'tester',
      batchSize: 100,
    });
    expect(refused).toMatchObject({ failed: IMPORTED, requests: 2 });
    expect(db.select().from(precedentClassifications).get()!.error).toMatch(/refusal/);
  });
});

describe('trend periods', () => {
  it.each([
    ['2025-01-31', 'month', '2025-01'],
    ['2025-12-01', 'month', '2025-12'],
    ['2025-03-31', 'quarter', '2025-Q1'],
    ['2025-04-01', 'quarter', '2025-Q2'],
  ] as const)('%s by %s → %s', (date, interval, expected) => {
    expect(periodOf(date, interval)).toBe(expected);
  });

  it('fills every period between the first and last, across years', () => {
    expect(periodRange('2024-11', '2025-02', 'month')).toEqual([
      '2024-11',
      '2024-12',
      '2025-01',
      '2025-02',
    ]);
    expect(periodRange('2024-Q4', '2025-Q2', 'quarter')).toEqual(['2024-Q4', '2025-Q1', '2025-Q2']);
    expect(periodRange('2025-03', '2025-03', 'month')).toEqual(['2025-03']);
  });
});

describe('clusterNoMatch', () => {
  const item = (id: string, text: string, topic: string, proof = id): ClusterInput => ({
    id,
    text,
    topic,
    brand: 'Fictorex',
    proofName: proof,
    reviewerFunction: 'Legal',
    commentedAt: `2025-01-${id.padStart(2, '0')}`,
  });

  it('tokenizes without stopwords and plural s', () => {
    expect(tokenize('Please confirm the photos are licensed for use')).toEqual([
      'photo',
      'licensed',
    ]);
  });

  it('groups recurring themes and drops one-offs and single-proof repeats', () => {
    const clusters = clusterNoMatch([
      item('1', 'Confirm licensing rights for this stock photo.', 'image rights'),
      item('2', 'Model release needed for the testimonial image.', 'image rights'),
      item('3', 'Stock image usage rights may have expired.', 'image rights'),
      item('4', 'Typo in the headline.', 'spelling'),
      item('5', 'Tone too casual.', 'tone', 'P'),
      item('6', 'Tone reads like a consumer ad.', 'tone', 'P'),
      item('7', 'Casual tone in the hero.', 'tone', 'P'),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      label: 'image rights',
      count: 3,
      proofs: 3,
      brands: ['Fictorex'],
      reviewerFunctions: ['Legal'],
      firstSeen: '2025-01-01',
      lastSeen: '2025-01-03',
      precedentIds: ['1', '2', '3'],
    });
    expect(clusters[0]!.examples.map((e) => e.id)).toEqual(['3', '2', '1']);
    expect(clusters[0]!.terms).toContain('image');
  });
});

describe('precedent API', () => {
  let db: Db;
  let app: FastifyInstance;
  let api: Api;
  let trends: (q?: string) => Promise<PrecedentTrends>;

  beforeAll(async () => {
    db = await seededDb();
    app = await buildApp({ config: loadConfig({ LOG_LEVEL: 'silent' }), db, llm: null });
    api = await signIn(app, db);
    trends = async (q = '') => {
      const res = await api(`/api/precedents/trends${q}`);
      expect(res.statusCode).toBe(200);
      return PrecedentTrendsSchema.parse(res.json());
    };
    return () => app.close();
  });

  it('counts everything as unclassified before classification', async () => {
    const t = await trends();
    expect(t.totals).toEqual({
      comments: IMPORTED,
      classified: 0,
      noMatchingRule: 0,
      unclassified: IMPORTED,
    });
    expect(t.byCategory).toEqual([{ bucket: 'unclassified', total: IMPORTED }]);
    expect(t.classifiers).toEqual([]);
  });

  it('reports trends by category over time, by brand and by reviewer function', async () => {
    await classifyPrecedents(db, { provider: new MockProvider(), actor: 'tester' });
    const t = await trends();
    expect(t.interval).toBe('month');
    expect(t.totals.classified).toBe(IMPORTED);
    expect(t.totals.unclassified).toBe(0);
    expect(t.classifiers).toEqual(['mock:mock-1']);

    // Synthetic dates span 2024-01..2026-09: 33 months, gaps included.
    expect(t.overTime[0]!.period).toBe('2024-01');
    expect(t.overTime.at(-1)!.period).toBe('2026-09');
    expect(t.overTime).toHaveLength(33);
    const sum = (xs: { total: number }[]) => xs.reduce((s, x) => s + x.total, 0);
    expect(sum(t.overTime)).toBe(IMPORTED);
    expect(sum(t.byBrand)).toBe(IMPORTED);
    expect(sum(t.byReviewerFunction)).toBe(IMPORTED);
    expect(sum(t.byCategory)).toBe(IMPORTED);
    for (const p of t.overTime) {
      expect(Object.values(p.counts).reduce((s, n) => s + n, 0)).toBe(p.total);
    }
    expect(t.byBrand.map((b) => b.key).sort()).toEqual([
      'Demovia',
      'Examplin',
      'Fictorex',
      'Placebrin',
    ]);
    // The default mapping normalises functions to codes.
    expect(t.byReviewerFunction.map((b) => b.key).sort()).toEqual([
      'commercial',
      'legal',
      'medical',
      'regulatory',
    ]);
    expect(t.byCategory[0]!.bucket).toBe('claims');
    // Image-rights comments come only from Legal in the synthetic data.
    const legal = t.byReviewerFunction.find((g) => g.key === 'legal')!;
    expect(legal.counts.no_matching_rule).toBeGreaterThan(0);
  });

  it('filters by brand, reviewer function and date, and groups by quarter', async () => {
    const all = await trends();
    const examplin = await trends('?brand=Examplin&interval=quarter');
    expect(examplin.totals.comments).toBe(all.byBrand.find((b) => b.key === 'Examplin')!.total);
    expect(examplin.byBrand.map((b) => b.key)).toEqual(['Examplin']);
    expect(examplin.overTime[0]!.period).toMatch(/^\d{4}-Q[1-4]$/);
    // Filter options ignore the filter, so the UI can switch brand.
    expect(examplin.filterOptions.brands).toHaveLength(4);

    const medical = await trends('?reviewerFunction=medical');
    expect(medical.byReviewerFunction.map((g) => g.key)).toEqual(['medical']);

    const y2025 = await trends('?from=2025-01-01&to=2025-12-31');
    expect(y2025.overTime[0]!.period).toBe('2025-01');
    expect(y2025.overTime.at(-1)!.period).toBe('2025-12');
    const in2025 = db
      .select()
      .from(precedents)
      .all()
      .filter((p) => p.commentedAt.startsWith('2025'));
    expect(y2025.totals.comments).toBe(in2025.length);

    const none = await trends('?brand=Nope');
    expect(none.totals.comments).toBe(0);
    expect(none.overTime).toEqual([]);
  });

  it('rejects invalid queries', async () => {
    for (const q of ['?from=2025-13', '?interval=week', '?from=yesterday']) {
      expect((await api(`/api/precedents/trends${q}`)).statusCode).toBe(400);
    }
    expect((await api('/api/precedents/candidates?minSize=1')).statusCode).toBe(400);
  });

  it('reports recurring no-matching-rule clusters as candidate rules', async () => {
    const res = await api('/api/precedents/candidates');
    expect(res.statusCode).toBe(200);
    const c: CandidateRules = CandidateRulesSchema.parse(res.json());
    expect(c.noMatchTotal).toBe((await trends()).totals.noMatchingRule);
    const labels = c.candidates.map((x) => x.label).sort();
    expect(labels).toEqual(['formatting', 'image rights', 'tone', 'translation']);
    expect(c.clustered).toBe(c.candidates.reduce((s, x) => s + x.count, 0));
    expect(c.clustered).toBeGreaterThanOrEqual(c.noMatchTotal - 2);
    for (const cand of c.candidates) {
      expect(cand.count).toBeGreaterThanOrEqual(3);
      expect(cand.examples.length).toBeGreaterThan(0);
      expect(cand.examples.length).toBeLessThanOrEqual(3);
    }

    const big = CandidateRulesSchema.parse(
      (await api('/api/precedents/candidates?minSize=50')).json(),
    );
    expect(big.candidates).toEqual([]);
  });

  it('never exposes reviewer names or pseudonyms', async () => {
    const bodies = [
      (await api('/api/precedents/trends')).body,
      (await api('/api/precedents/candidates')).body,
    ].join('\n');
    expect(bodies).not.toMatch(/Reviewer-[0-9A-F]{8}/i);
    for (const name of ['Dana Whitfield', 'Jordan Reyes', 'Olivia Brandt', 'Whitfield']) {
      expect(bodies).not.toContain(name);
    }
  });
});
