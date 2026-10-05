import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FindingViewSchema, MeSchema, RuleCandidateSchema } from '@pre-mlr/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { auditLog, findingPrecedents, precedentEmbeddings, scans } from '../src/db/schema.js';
import { recordFindings } from '../src/findings/service.js';
import { HashEmbedder, cosine, createEmbedder, LocalEmbedder } from '../src/precedent/embed.js';
import { attachPrecedents, cutoffDate, gistOf } from '../src/precedent/retrieve.js';
import { findingViewsForScan } from '../src/review/views.js';
import { syncRulePack } from '../src/rules/pack.js';
import { snapshotScanRules } from '../src/rules/repository.js';
import { migratedDb, seedScan } from './helpers/model.js';
import { signIn, type Api } from './helpers/auth.js';
import { block, facts } from './helpers/check-pages.js';
import { seedPrecedents, TableEmbedder } from './helpers/precedents.js';

const RULE_PACK = join(import.meta.dirname, '../../rule-packs/public');
const NOW = new Date('2026-10-01T00:00:00Z');

describe('embedders', () => {
  it('HashEmbedder gives deterministic unit vectors that favour shared wording', async () => {
    const e = new HashEmbedder();
    const [a, b, c, a2] = await e.embed([
      'Hero image needs alt text',
      'Add alt text to the hero image',
      'Copyright year should be updated',
      'Hero image needs alt text',
    ]);
    expect(a).toEqual(a2);
    expect(cosine(a!, a!)).toBeCloseTo(1, 6);
    expect(cosine(a!, b!)).toBeGreaterThan(cosine(a!, c!));
    expect(cosine(a!, b!)).toBeGreaterThan(e.minSimilarity);
  });

  it('creates the configured embedder without loading any model', () => {
    const cfg = (EMBEDDINGS: string) => loadConfig({ EMBEDDINGS, DATA_DIR: '/tmp/x' });
    expect(createEmbedder(cfg('none'))).toBeNull();
    expect(createEmbedder(cfg('hash'))).toBeInstanceOf(HashEmbedder);
    const local = createEmbedder(cfg('local'));
    expect(local).toBeInstanceOf(LocalEmbedder);
    expect(local!.id).toBe('local:Xenova/all-MiniLM-L6-v2#q8');
  });

  it('computes the recency cutoff and comment gist', () => {
    expect(cutoffDate(NOW, 36)).toBe('2023-10-01');
    expect(cutoffDate(new Date('2026-03-31T12:00:00Z'), 1)).toBe('2026-03-03');
    expect(gistOf('The 68% claim needs a reference.')).toBe(
      gistOf('The 61% claim needs a reference!'),
    );
    expect(gistOf('Job code is missing. Questions: [email] or [phone].')).toBe(
      'job code is missing questions or',
    );
  });
});

describe('attachPrecedents', () => {
  let db: Db;
  let scanId: string;
  let altId: string;

  beforeEach(async () => {
    db = migratedDb();
    await syncRulePack(db, RULE_PACK);
    ({ scanId } = seedScan(db));
    snapshotScanRules(db, scanId);
    const { created } = recordFindings(
      db,
      scanId,
      [
        {
          pageId: `${scanId}-home`,
          ruleId: 'alt-text',
          detectedBy: 'rules_engine',
          message: 'Image has no alt attribute.',
          evidenceText: 'hero.png',
        },
        {
          pageId: `${scanId}-home`,
          ruleId: 'privacy-link',
          detectedBy: 'rules_engine',
          message: 'No link to the privacy policy on this page.',
        },
      ],
      'rules_engine',
    );
    altId = created.find((f) => f.ruleId === 'alt-text')!.id;
  });

  const embedder = () =>
    new TableEmbedder([
      [/^best match/, [1, 0, 0]],
      [/^near copy/, [0.999, 0.0447, 0]],
      [/^brand/, [0.82, 0, 0.5724]],
      [/^second/, [0.85, 0.5268, 0]],
      [/^weak/, [0.3, 0.9539, 0]],
      [/^old/, [1, 0, 0]],
      [/^claims/, [1, 0, 0]],
    ]);
  const seed = () =>
    seedPrecedents(db, [
      { id: 'best', text: 'best match: hero image needs alt text', category: 'accessibility' },
      // Different wording, almost the same vector: a repeat.
      { id: 'near', text: 'near copy of the alt text comment', category: 'accessibility' },
      { id: 'brand', text: 'brand comment', category: 'accessibility', brand: 'Fictorex' },
      { id: 'second', text: 'second comment', category: 'accessibility' },
      { id: 'weak', text: 'weak comment', category: 'accessibility' },
      { id: 'old', text: 'old comment', category: 'accessibility', commentedAt: '2020-01-01' },
      { id: 'claims', text: 'claims comment', category: 'claims' },
      { id: 'nomatch', text: 'best match but no rule', category: null },
    ]);
  const attachedTo = (findingId: string) =>
    findingViewsForScan(db, scanId)
      .find((f) => f.id === findingId)!
      .precedents.map((p) => p.id);

  it('attaches the closest same-category, recent, distinct comments, ranked', async () => {
    seed();
    const e = embedder();
    const result = await attachPrecedents(db, scanId, { embedder: e, maxAgeMonths: 36, now: NOW });
    expect(result).toMatchObject({ findings: 2, matched: 1, attached: 3, embedded: 5 });
    // Not: "near" (repeat of "best"), "weak" (below 0.5), "old", "claims" or "nomatch".
    expect(attachedTo(altId)).toEqual(['best', 'second', 'brand']);
    const view = findingViewsForScan(db, scanId).find((f) => f.id === altId)!;
    expect(view.precedents[0]).toMatchObject({
      id: 'best',
      rank: 1,
      similarity: 1,
      text: 'best match: hero image needs alt text',
      site: 'examplin.test',
      brand: 'Examplin',
      reviewerFunction: 'medical',
      outcome: 'resolved',
      category: 'accessibility',
      commentedAt: '2026-06-01',
    });
    expect(JSON.stringify(view)).not.toContain('Reviewer-0000ABCD');
    // The finding's query is the rule title, message and evidence.
    expect(e.calls.at(-1)![0]).toBe('Images have alt text. Image has no alt attribute. hero.png');
    // The privacy finding has no legal_privacy precedents at all.
    expect(result.matched).toBe(1);
  });

  it("boosts the scan's own brand", async () => {
    seed();
    db.update(scans)
      .set({ product: { brandNames: ['Fictorex'], establishedName: 'fictorexumab' } })
      .where(eq(scans.id, scanId))
      .run();
    await attachPrecedents(db, scanId, { embedder: embedder(), maxAgeMonths: 36, now: NOW });
    expect(attachedTo(altId)).toEqual(['best', 'brand', 'second']);
  });

  it('respects the age limit, reuses stored vectors and replaces earlier matches', async () => {
    seed();
    const e = embedder();
    await attachPrecedents(db, scanId, { embedder: e, maxAgeMonths: 36, now: NOW });
    const again = await attachPrecedents(db, scanId, { embedder: e, maxAgeMonths: 6, now: NOW });
    expect(again.embedded).toBe(0);
    // A 6-month window from October 2026 still includes June 2026, but not 2020.
    expect(attachedTo(altId)).toEqual(['best', 'second', 'brand']);
    const none = await attachPrecedents(db, scanId, {
      embedder: e,
      maxAgeMonths: 1,
      now: NOW,
    });
    expect(none.attached).toBe(0);
    expect(db.select().from(findingPrecedents).all()).toHaveLength(0);
    expect(
      db.select().from(precedentEmbeddings).where(eq(precedentEmbeddings.embedder, e.id)).all(),
    ).toHaveLength(5);
  });

  it('never calls the embedder when there is nothing to compare', async () => {
    seedPrecedents(db, [{ text: 'claims only', category: 'claims' }]);
    const e = embedder();
    const result = await attachPrecedents(db, scanId, { embedder: e, maxAgeMonths: 36 });
    expect(result).toMatchObject({ findings: 2, matched: 0, attached: 0 });
    expect(e.calls).toEqual([]);
  });
});

describe('precedent matching in the scan pipeline and API', () => {
  let app: FastifyInstance;
  let db: Db;
  const ADMIN = 'Robin Admin';
  let admin: Api;
  let author: Api;
  const json = (
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
    as: 'admin' | 'author' = 'admin',
  ) => (as === 'admin' ? admin : author)({ method, url, payload: body as object });

  beforeAll(async () => {
    db = migratedDb();
    app = await buildApp({
      config: loadConfig({ LOG_LEVEL: 'silent' }),
      db,
      llm: null,
      embedder: new HashEmbedder(),
      fetchImpl: async () => new Response('', { status: 200 }),
      crawl: async (_opts, onPage) => {
        onPage({
          id: 'pg1',
          crawlIndex: 0,
          url: 'https://examplin.test/',
          depth: 0,
          parentId: null,
          title: 'Examplin',
          text: 'Examplin is the best treatment.',
          links: [],
          facts: facts([block('Examplin is the best treatment.')]),
          httpStatus: 200,
          desktopScreenshot: null,
          mobileScreenshot: null,
          error: null,
        });
      },
    });
    admin = await signIn(app, db, 'rule_admin', ADMIN);
    author = await signIn(app, db, 'author', 'Pat Author');
    seedPrecedents(db, [
      {
        id: 'p-best',
        text: '"Best-in-class" is a superlative we cannot support.',
        category: 'claims',
      },
      {
        id: 'p-alt',
        text: 'Hero image on the Home page needs alt text.',
        category: 'accessibility',
      },
      { id: 'p-tone', text: 'Tone is too casual.', category: null },
    ]);
    const res = await json('POST', '/api/scans', {
      startUrl: 'https://examplin.test/',
      maxPages: 1,
      maxDepth: 0,
    });
    expect(res.statusCode).toBe(202);
    await app.scanRunner.idle();
  });
  afterAll(() => app.close());

  const findingsOf = async () => {
    const scanId = db.select().from(scans).get()!.id;
    const res = await json('GET', `/api/scans/${scanId}/findings`);
    return FindingViewSchema.array().parse(res.json());
  };

  it('attaches precedents to findings as the last scan step', async () => {
    const scan = db.select().from(scans).get()!;
    expect(scan).toMatchObject({ status: 'completed', phase: null });
    const views = await findingsOf();
    const superlative = views.find((f) => f.ruleId === 'superlatives')!;
    expect(superlative.precedents.map((p) => p.id)).toEqual(['p-best']);
    const alt = views.find((f) => f.ruleId === 'alt-text');
    if (alt) expect(alt.precedents.map((p) => p.id)).toEqual(['p-alt']);
    // A no-matching-rule comment is never attached to a rule's finding.
    expect(views.flatMap((f) => f.precedents).some((p) => p.id === 'p-tone')).toBe(false);
  });

  it('reports the signed-in user and role', async () => {
    expect(MeSchema.parse((await json('GET', '/api/me')).json().user)).toMatchObject({
      name: ADMIN,
      role: 'rule_admin',
    });
    expect((await json('GET', '/api/me', undefined, 'author')).json().user).toMatchObject({
      name: 'Pat Author',
      role: 'author',
    });
  });

  it('lets only rule admins promote a precedent, and audits it', async () => {
    const superlative = (await findingsOf()).find((f) => f.ruleId === 'superlatives')!;
    const body = {
      title: 'No unsupported "best-in-class" claims',
      precedentIds: ['p-best'],
      findingId: superlative.id,
      note: 'Seen on several brands.',
    };
    const denied = await json('POST', '/api/rule-candidates', body, 'author');
    expect(denied.statusCode).toBe(403);

    const created = await json('POST', '/api/rule-candidates', body);
    expect(created.statusCode).toBe(201);
    const candidate = RuleCandidateSchema.parse(created.json());
    expect(candidate).toMatchObject({
      title: body.title,
      status: 'proposed',
      precedentIds: ['p-best'],
      findingId: superlative.id,
      scanId: superlative.scanId,
      note: body.note,
      createdBy: ADMIN,
    });
    expect(candidate.examples.map((e) => e.id)).toEqual(['p-best']);

    const audits = db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'promoted_to_rule_candidate'))
      .all();
    expect(audits.map((a) => [a.entityType, a.entityId])).toEqual([
      ['rule_candidate', candidate.id],
      ['precedent', 'p-best'],
    ]);
    expect(audits[0]).toMatchObject({ actor: ADMIN, scanId: superlative.scanId });

    expect((await json('POST', '/api/rule-candidates', body)).statusCode).toBe(409);
    const list = RuleCandidateSchema.array().parse(
      (await json('GET', '/api/rule-candidates', undefined, 'author')).json(),
    );
    expect(list.map((c) => c.id)).toEqual([candidate.id]);
  });

  it('rejects unknown precedents and precedents not attached to the finding', async () => {
    const superlative = (await findingsOf()).find((f) => f.ruleId === 'superlatives')!;
    const post = (o: object) =>
      json('POST', '/api/rule-candidates', { title: 'Candidate', precedentIds: ['p-tone'], ...o });
    expect((await post({ precedentIds: ['nope'] })).statusCode).toBe(400);
    expect((await post({ findingId: superlative.id })).statusCode).toBe(400);
    expect((await post({ findingId: 'nope' })).statusCode).toBe(400);
    expect((await post({ title: 'x' })).statusCode).toBe(400);
    // From the trends page (no finding): any existing comments can be proposed.
    expect((await post({})).statusCode).toBe(201);
    expect(
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityType, 'precedent'), eq(auditLog.entityId, 'p-tone')))
        .all(),
    ).toHaveLength(1);
  });
});
