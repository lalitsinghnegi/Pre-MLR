import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/client.js';
import { findings, llmAnalyses, pages, scans } from '../src/db/schema.js';
import { runLlmAnalysis } from '../src/llm/analyze.js';
import type { LLMProvider, LlmRequest, LlmResponse } from '../src/llm/types.js';
import { DEFAULT_RULE_PACK_DIR, syncRulePack } from '../src/rules/pack.js';
import { snapshotScanRules } from '../src/rules/repository.js';
import { block, facts } from './helpers/check-pages.js';
import { migratedDb } from './helpers/model.js';

const log = pino({ level: 'silent' });
const OFF_LABEL = 'Many people also use Examplin for seasonal allergies.';
const HERO = 'Guaranteed relief, day and night';

/** Provider that replays scripted replies (or throws) and records each request. */
class FakeProvider implements LLMProvider {
  readonly name = 'mock' as const;
  readonly model = 'claude-opus-5-5';
  readonly settings = { effort: 'high' };
  readonly requests: LlmRequest[] = [];
  constructor(
    private readonly replies: (
      Partial<LlmResponse> | Error | ((r: LlmRequest) => Partial<LlmResponse>)
    )[],
  ) {}
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    const next = this.replies.length > 1 ? this.replies.shift()! : this.replies[0]!;
    if (next instanceof Error) throw next;
    const r = typeof next === 'function' ? next(req) : next;
    return {
      output: null,
      rawText: '',
      model: this.model,
      stopReason: 'end_turn',
      servedByFallback: false,
      usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
      ...r,
    };
  }
}

const out = (fs: object[], pageTip = 'Remove the allergy claim and rebalance the hero.') => ({
  output: { findings: fs, pageTip },
});
const offLabel = (o: object = {}) => ({
  ruleId: 'off-label-implied',
  severity: 'critical',
  evidenceQuote: OFF_LABEL,
  explanation: 'Implies use for allergies, outside the asthma indication.',
  suggestedRewrite: 'Examplin is for adults with moderate-to-severe asthma.',
  confidence: 0.85,
  ...o,
});

describe('runLlmAnalysis', () => {
  let db: Db;
  let dataDir: string;
  let heroBlock: ReturnType<typeof block>;

  async function seedScan(id: string) {
    const now = new Date().toISOString();
    db.insert(scans)
      .values({
        id,
        startUrl: 'https://examplin.test/',
        maxPages: 5,
        maxDepth: 1,
        status: 'running',
        createdAt: now,
      })
      .run();
    await mkdir(join(dataDir, 'scans', id), { recursive: true });
    await sharp({ create: { width: 1440, height: 3000, channels: 3, background: '#e8f4f2' } })
      .png()
      .toFile(join(dataDir, 'scans', id, 'home.png'));
    heroBlock = block(HERO, { headingLevel: 1, fontSize: 48 });
    const f = facts([
      heroBlock,
      block(OFF_LABEL),
      block('Important Safety Information', { headingLevel: 2 }),
    ]);
    const base = { scanId: id, depth: 0, crawledAt: now, links: [] };
    db.insert(pages)
      .values([
        {
          ...base,
          id: `${id}-home`,
          crawlIndex: 0,
          url: 'https://examplin.test/',
          title: 'Home',
          text: `${HERO}\n${OFF_LABEL}\nImportant Safety Information`,
          facts: f,
          httpStatus: 200,
          desktopScreenshotPath: `scans/${id}/home.png`,
        },
        {
          ...base,
          id: `${id}-privacy`,
          crawlIndex: 1,
          url: 'https://examplin.test/privacy',
          title: 'Privacy',
          text: 'We respect your privacy.',
          httpStatus: 200,
        },
        {
          ...base,
          id: `${id}-gone`,
          crawlIndex: 2,
          url: 'https://examplin.test/gone',
          httpStatus: 404,
          error: 'HTTP 404',
        },
      ])
      .run();
    snapshotScanRules(db, id);
  }

  beforeEach(async () => {
    db = migratedDb();
    await syncRulePack(db, DEFAULT_RULE_PACK_DIR);
    dataDir = await mkdtemp(join(tmpdir(), 'pre-mlr-llm-'));
    await seedScan('s1');
  });
  afterEach(() => rm(dataDir, { recursive: true, force: true }));

  const run = (provider: LLMProvider, scanId = 's1') =>
    runLlmAnalysis(db, scanId, { provider, dataDir, log });
  const analyses = (scanId = 's1') =>
    db.select().from(llmAnalyses).where(eq(llmAnalyses.scanId, scanId)).all();
  const llmFindings = (scanId = 's1') =>
    db.select().from(findings).where(eq(findings.scanId, scanId)).all();

  it('sends one request per eligible page with rules, text and a downscaled screenshot', async () => {
    const provider = new FakeProvider([out([])]);
    const res = await run(provider);
    expect(res).toMatchObject({ pagesAnalyzed: 1, failed: 0, cached: 0 }); // /privacy excluded, 404 skipped
    const req = provider.requests[0]!;
    expect(req.ruleIds).toEqual(['off-label-implied', 'risk-benefit-balance']);
    expect(req.rulesBlock).toContain('<rule id="off-label-implied" severity="critical">');
    expect(req.system).toContain('Never invent regulations');
    expect(req.userText).toContain(OFF_LABEL);
    expect(req.image?.mediaType).toBe('image/jpeg');
    const meta = await sharp(Buffer.from(req.image!.base64, 'base64')).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(1568);
  });

  it('records findings with evidence location, confidence and the page tip', async () => {
    const res = await run(
      new FakeProvider([
        out([
          offLabel(),
          offLabel({
            ruleId: 'risk-benefit-balance',
            severity: 'major',
            evidenceQuote: HERO,
            confidence: 0.6,
            suggestedRewrite: null,
          }),
        ]),
      ]),
    );
    expect(res).toMatchObject({ findingsCreated: 2, costUsd: 0.008 });
    const byRule = new Map(llmFindings().map((f) => [f.ruleId, f]));
    expect(byRule.get('off-label-implied')).toMatchObject({
      detectedBy: 'llm',
      ruleVersion: 2,
      severity: 'critical',
      evidenceText: OFF_LABEL,
      confidence: 0.85,
      suggestedFix: 'Examplin is for adults with moderate-to-severe asthma.',
      updatedBy: 'llm',
      evidenceLocation: { view: 'desktop' },
    });
    expect(byRule.get('risk-benefit-balance')!.evidenceLocation).toEqual({
      view: 'desktop',
      ...heroBlock.box,
    });
    expect(analyses()).toMatchObject([
      {
        status: 'ok',
        attempts: 1,
        cached: false,
        pageTip: 'Remove the allergy claim and rebalance the hero.',
        inputTokens: 1000,
        outputTokens: 200,
        costUsd: 0.008,
        provider: 'mock',
        model: 'claude-opus-5-5',
        promptVersion: expect.stringMatching(/^v1#/),
      },
    ]);
  });

  it('retries once with feedback when a quote is invented, then keeps the valid answer', async () => {
    const provider = new FakeProvider([
      out([offLabel({ evidenceQuote: 'Examplin cures allergies.' })]),
      out([offLabel()]),
    ]);
    await run(provider);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]!.userText).toMatch(
      /rejected for these reasons[\s\S]*does not appear verbatim/,
    );
    expect(analyses()[0]).toMatchObject({
      status: 'ok',
      attempts: 2,
      problems: [expect.stringMatching(/^attempt 1: .*verbatim/)],
    });
    expect(llmFindings()).toHaveLength(1);
  });

  it('after a second invalid answer, drops only the invalid findings', async () => {
    const bad = offLabel({ evidenceQuote: 'Not on the page.' });
    await run(new FakeProvider([out([bad, offLabel()]), out([bad, offLabel()])]));
    expect(analyses()[0]).toMatchObject({ status: 'ok', attempts: 2 });
    expect(analyses()[0]!.problems).toHaveLength(2);
    expect(llmFindings().map((f) => f.evidenceText)).toEqual([OFF_LABEL]);
  });

  it('fails the page (not the scan) on unusable output twice, refusals and API errors', async () => {
    await run(new FakeProvider([{ output: { wrong: true } }]));
    expect(analyses()[0]).toMatchObject({
      status: 'error',
      attempts: 2,
      error: 'Invalid model output after one retry.',
    });

    await seedScan('s2');
    await run(new FakeProvider([{ stopReason: 'refusal' }]), 's2');
    expect(analyses('s2')[0]).toMatchObject({
      status: 'error',
      attempts: 1,
      error: expect.stringMatching(/declined/),
    });

    await seedScan('s3');
    const rateLimited = new Anthropic.RateLimitError(
      429,
      { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } },
      'slow down',
      new Headers(),
    );
    const res = await run(new FakeProvider([rateLimited]), 's3');
    expect(res).toMatchObject({ pagesAnalyzed: 1, failed: 1, findingsCreated: 0 });
    expect(analyses('s3')[0]).toMatchObject({
      status: 'error',
      error: 'Rate limited by the LLM API (after retries).',
    });
  });

  it('reuses a cached analysis for unchanged page content (no second API call)', async () => {
    const provider = new FakeProvider([out([offLabel()])]);
    await run(provider);
    await seedScan('s2'); // same content and screenshot
    const res = await run(provider, 's2');
    expect(provider.requests).toHaveLength(1);
    expect(res).toMatchObject({ cached: 1, costUsd: 0, findingsCreated: 1 });
    expect(analyses('s2')[0]).toMatchObject({
      status: 'ok',
      cached: true,
      attempts: 0,
      pageTip: expect.any(String),
    });
    expect(llmFindings('s2')[0]).toMatchObject({ ruleId: 'off-label-implied', detectedBy: 'llm' });

    // Changed text means a new call.
    await seedScan('s3');
    db.update(pages)
      .set({ text: `${HERO}\n${OFF_LABEL}\nNew sentence.` })
      .where(eq(pages.id, 's3-home'))
      .run();
    await run(provider, 's3');
    expect(provider.requests).toHaveLength(2);
  });

  it('does nothing when the scan has no enabled LLM rules', async () => {
    db.delete(scans).run();
    const now = new Date().toISOString();
    db.insert(scans)
      .values({
        id: 'x',
        startUrl: 'https://examplin.test/',
        maxPages: 5,
        maxDepth: 1,
        status: 'running',
        createdAt: now,
      })
      .run();
    snapshotScanRules(db, 'x', { disable: ['off-label-implied', 'risk-benefit-balance'] });
    const provider = new FakeProvider([out([])]);
    expect(await run(provider, 'x')).toMatchObject({ pagesAnalyzed: 0 });
    expect(provider.requests).toHaveLength(0);
  });
});
