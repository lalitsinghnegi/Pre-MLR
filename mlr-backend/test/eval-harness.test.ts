import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { checkSpend, estimateSpend } from '../src/eval/guard.js';
import { runEval } from '../src/eval/harness.js';
import { percentile, precision, recall, summarize } from '../src/eval/metrics.js';
import {
  DEFAULT_MODELS_FILE,
  loadModels,
  selectModels,
  type ModelConfig,
} from '../src/eval/models.js';
import { consoleTable, markdownReport } from '../src/eval/report.js';
import { MockProvider } from '../src/llm/mock.js';
import type { LLMProvider, LlmRequest, LlmResponse } from '../src/llm/types.js';

const SITE = join(import.meta.dirname, '../../test-sites/examplin');
const log = pino({ level: 'silent' });

describe('metrics', () => {
  it('computes precision and recall, null when undefined', () => {
    expect(precision(3, 1)).toBe(0.75);
    expect(recall(3, 3)).toBe(0.5);
    expect(precision(0, 0)).toBeNull();
    expect(recall(0, 0)).toBeNull();
    expect(precision(0, 2)).toBe(0);
  });

  it('nearest-rank percentile and run summaries', () => {
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 95)).toBe(100);
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([], 95)).toBeNull();
    expect(summarize([1, null, 3])).toEqual({ mean: 2, min: 1, max: 3 });
    expect(summarize([null])).toEqual({ mean: null, min: null, max: null });
  });
});

describe('models file', () => {
  it('loads the shipped list; the default runs only the mock', async () => {
    const file = await loadModels();
    expect(selectModels(file).map((m) => m.id)).toEqual(['mock']);
    expect(selectModels(file, ['opus-high', 'haiku'])).toMatchObject([
      { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high', fallback: false },
      { provider: 'anthropic', model: 'claude-haiku-4-5', effort: null },
    ]);
    expect(() => selectModels(file, ['gpt'])).toThrow(/Unknown model id\(s\): gpt/);
  });

  it('rejects duplicate ids, unknown defaults and unknown fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pre-mlr-models-'));
    const write = async (body: string) => {
      await writeFile(join(dir, 'm.yaml'), body);
      return loadModels(join(dir, 'm.yaml'));
    };
    await expect(
      write(
        'default: [a]\nmodels:\n  - { id: a, provider: mock }\n  - { id: a, provider: mock }\n',
      ),
    ).rejects.toThrow(/duplicate model ids: a/);
    await expect(write('default: [b]\nmodels:\n  - { id: a, provider: mock }\n')).rejects.toThrow(
      /unknown ids: b/,
    );
    await expect(
      write(
        'default: [a]\nmodels:\n  - { id: a, provider: anthropic, model: x, temperature: 1 }\n',
      ),
    ).rejects.toThrow();
    await rm(dir, { recursive: true });
    expect(DEFAULT_MODELS_FILE).toMatch(/eval\/models\.yaml$/);
  });
});

describe('spend guard', () => {
  const opus: ModelConfig = {
    id: 'opus',
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    effort: 'high',
    fallback: false,
    maxTokens: 16000,
  };
  const mock: ModelConfig = { id: 'mock', provider: 'mock' };

  it('lets mock-only runs through and estimates paid ones', () => {
    expect(checkSpend(estimateSpend([mock], 7, 3), { yes: false, maxCostUsd: 5 })).toBeNull();
    const est = estimateSpend([mock, opus], 7, 2);
    expect(est.paidModels).toEqual(['opus']);
    expect(est.estimateUsd).toBeCloseTo((7 * 2 * (6000 * 4 + 2500 * 20)) / 1e6, 2);
  });

  it('requires --yes for paid models and refuses estimates over budget', () => {
    expect(checkSpend(estimateSpend([opus], 7, 1), { yes: false, maxCostUsd: 5 })).toMatch(
      /Re-run with --yes/,
    );
    expect(checkSpend(estimateSpend([opus], 7, 1), { yes: true, maxCostUsd: 5 })).toBeNull();
    expect(checkSpend(estimateSpend([opus], 7, 100), { yes: true, maxCostUsd: 5 })).toMatch(
      /exceeds --max-cost-usd 5/,
    );
  });
});

/** Mock that misses the /faq finding and invents one on the clean /how-it-works page. */
class NoisyProvider implements LLMProvider {
  readonly name = 'mock' as const;
  readonly model = 'noisy-1';
  readonly settings = {};
  private readonly inner = new MockProvider();
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await this.inner.complete(req);
    const out = res.output as {
      findings: { ruleId: string; evidenceQuote: string }[];
      pageTip: string;
    };
    let findings = out.findings.filter((f) => f.ruleId !== 'risk-benefit-balance');
    if (req.userText.includes('/how-it-works')) {
      findings = [
        ...findings,
        {
          ruleId: 'off-label-implied',
          severity: 'major',
          evidenceQuote: 'Examplin does not replace a rescue inhaler.',
          explanation: 'x',
          suggestedRewrite: null,
          confidence: 0.4,
        } as never,
      ];
    }
    return { ...res, model: this.model, output: { ...out, findings } };
  }
}

/** Reports Opus pricing with large token counts so each run costs ~$28 (nothing is actually sent). */
class ExpensiveProvider implements LLMProvider {
  readonly name = 'mock' as const;
  readonly model = 'claude-opus-5-5';
  readonly settings = {};
  private readonly inner = new MockProvider();
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await this.inner.complete(req);
    return {
      ...res,
      model: this.model,
      usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}

describe('runEval (mock providers only; no paid calls)', { timeout: 120_000 }, () => {
  it('scores each model and run against the expected LLM findings', async () => {
    const models: ModelConfig[] = [
      { id: 'mock', provider: 'mock' },
      { id: 'noisy', provider: 'mock' },
    ];
    const result = await runEval({
      siteDir: SITE,
      expectedFile: join(SITE, 'expected-findings.yaml'),
      models,
      runs: 2,
      maxCostUsd: 5,
      log,
      providerFactory: (c) => (c.id === 'noisy' ? new NoisyProvider() : new MockProvider()),
    });

    expect(result.expectedLlm.map((e) => e.rule).sort()).toEqual([
      'off-label-implied',
      'risk-benefit-balance',
    ]);
    const [good, noisy] = result.models;
    expect(good!.runs).toHaveLength(2);
    expect(good).toMatchObject({
      precision: { mean: 1 },
      recall: { mean: 1 },
      fp: { mean: 0 },
      fn: { mean: 0 },
      failedPages: { mean: 0 },
    });
    expect(good!.runs[0]!.pages).toBe(7); // 8 pages minus the excluded /privacy
    expect(noisy).toMatchObject({
      precision: { mean: 0.5 },
      recall: { mean: 0.5 },
      tp: { mean: 1 },
      fp: { mean: 1 },
      fn: { mean: 1 },
    });
    expect(noisy!.runs[0]!.comparison.unexpected).toEqual([
      expect.objectContaining({
        page: '/how-it-works',
        rule: 'off-label-implied',
        evidence: 'Examplin does not replace a rescue inhaler.',
      }),
    ]);
    expect(noisy!.runs[0]!.comparison.missing).toEqual([
      expect.objectContaining({ page: '/faq', rule: 'risk-benefit-balance' }),
    ]);
    expect(noisy!.runs[0]!.servedModels).toEqual(['noisy-1']);
    expect(result.stoppedEarly).toBeNull();

    const md = markdownReport(result);
    expect(md).toContain('| mock | mock | 2 | 100% | 100% |');
    expect(md).toContain('| noisy | mock | 2 | 50% | 50% |');
    expect(md).toContain(
      '- False positive: `/how-it-works` off-label-implied — “Examplin does not replace a rescue inhaler.”',
    );
    expect(md).toContain('- Missed: `/faq` risk-benefit-balance (expected “Guaranteed relief”)');
    expect(consoleTable(result).split('\n')).toHaveLength(3);
  });

  it('stops starting runs once actual spend passes the budget', async () => {
    const result = await runEval({
      siteDir: SITE,
      expectedFile: join(SITE, 'expected-findings.yaml'),
      models: [
        { id: 'pricey', provider: 'mock' },
        { id: 'never-run', provider: 'mock' },
      ],
      runs: 3,
      maxCostUsd: 1,
      log,
      providerFactory: () => new ExpensiveProvider(),
    });
    expect(result.models.map((m) => [m.config.id, m.runs.length])).toEqual([['pricey', 1]]);
    expect(result.totalCostUsd).toBeCloseTo(28, 0); // 7 pages × 1M input tokens × $4/M
    expect(result.stoppedEarly).toMatch(/Budget of \$1 exceeded/);
    expect(markdownReport(result)).toContain('**Stopped early:**');
  });
});
