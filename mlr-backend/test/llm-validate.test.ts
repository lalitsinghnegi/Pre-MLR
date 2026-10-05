import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from '../src/llm/pricing.js';
import { loadPrompts, renderRules, renderUser } from '../src/llm/prompt.js';
import { normalizeForMatch, validateOutput } from '../src/llm/schema.js';

const ctx = {
  ruleIds: ['off-label-implied', 'risk-benefit-balance'],
  ruleSeverity: { 'off-label-implied': 'critical', 'risk-benefit-balance': 'major' } as const,
  pageText:
    'Breathe easier.\nMany people also use Examplin for seasonal allergies.\nIt’s “great” — really.',
};
const finding = (o: object = {}) => ({
  ruleId: 'off-label-implied',
  severity: 'critical',
  evidenceQuote: 'Many people also use Examplin for seasonal allergies.',
  explanation: 'Implies use beyond the indication.',
  suggestedRewrite: null,
  confidence: 0.8,
  ...o,
});

describe('validateOutput', () => {
  it('accepts valid output', () => {
    const v = validateOutput({ findings: [finding()], pageTip: 'Remove the allergy claim.' }, ctx);
    expect(v).toMatchObject({
      problems: [],
      unusable: false,
      pageTip: 'Remove the allergy claim.',
    });
    expect(v.findings).toHaveLength(1);
  });

  it('matches quotes ignoring case, whitespace and typographic punctuation', () => {
    const v = validateOutput(
      { findings: [finding({ evidenceQuote: 'it\'s "GREAT" - really.' })], pageTip: 'x' },
      ctx,
    );
    expect(v.problems).toEqual([]);
  });

  it('drops invented quotes and reports why', () => {
    const v = validateOutput(
      { findings: [finding({ evidenceQuote: 'Examplin cures asthma.' }), finding()], pageTip: 'x' },
      ctx,
    );
    expect(v.findings).toHaveLength(1);
    expect(v.problems).toEqual([expect.stringMatching(/findings\[0\].*does not appear verbatim/)]);
  });

  it('caps severity at the rule severity and rejects out-of-range confidence', () => {
    const v = validateOutput(
      {
        findings: [
          finding({
            ruleId: 'risk-benefit-balance',
            severity: 'critical',
            evidenceQuote: 'Breathe easier.',
          }),
          finding({ confidence: 1.4 }),
        ],
        pageTip: 'x',
      },
      ctx,
    );
    expect(v.findings.map((f) => [f.ruleId, f.severity])).toEqual([
      ['risk-benefit-balance', 'major'],
    ]);
    expect(v.problems).toEqual([expect.stringMatching(/confidence must be between 0 and 1/)]);
  });

  it('drops findings with unknown rule ids or severities without discarding the rest', () => {
    const v = validateOutput(
      {
        findings: [finding({ ruleId: 'made-up-rule' }), finding({ severity: 'urgent' }), finding()],
        pageTip: 'x',
      },
      ctx,
    );
    expect(v).toMatchObject({ unusable: false });
    expect(v.findings).toHaveLength(1);
    expect(v.problems).toEqual([
      expect.stringMatching(
        /findings\[0\].*not one of the provided rules \(off-label-implied, risk-benefit-balance\)/,
      ),
      expect.stringMatching(/findings\[1\].*severity must be one of/),
    ]);
  });

  it('flags schema mismatches as unusable', () => {
    expect(validateOutput({ nope: true }, ctx)).toMatchObject({
      unusable: true,
      problems: [expect.stringMatching(/schema/)],
    });
    expect(validateOutput({ findings: [], pageTip: '  ' }, ctx).problems).toEqual([
      'pageTip must not be empty.',
    ]);
  });
});

describe('normalizeForMatch', () => {
  it('folds case, whitespace, curly quotes and dashes', () => {
    expect(normalizeForMatch('  It’s\n“OK” – fine ')).toBe('it\'s "ok" - fine');
  });
});

describe('prompts', () => {
  it('system prompt carries the required ground rules', async () => {
    const p = await loadPrompts();
    expect(p.version).toMatch(/^v1#[0-9a-f]{8}$/);
    for (const phrase of [
      'prototype based on public sources only',
      'advisory',
      'not legal or regulatory advice',
      'Never invent regulations',
      'low confidence',
    ]) {
      expect(p.system).toContain(phrase);
    }
  });

  it('renders rules and the page message without re-expanding page text', async () => {
    const p = await loadPrompts();
    const rules = renderRules([
      {
        ruleId: 'off-label-implied',
        version: 2,
        title: 'No implied off-label use',
        severity: 'critical',
        sourceCitation: '21 CFR 202.1(e)(4)(i)(a)',
        description: 'Desc',
        promptTemplate: 'Check uses.',
      },
    ]);
    expect(rules).toContain('<rule id="off-label-implied" severity="critical">');
    expect(rules).toContain('What to check: Check uses.');
    const user = renderUser(
      p.userTemplate,
      { url: 'https://x.test/', title: null, text: 'Text with {{url}} inside' },
      'Bad quote.',
    );
    expect(user).toContain('Page URL: https://x.test/');
    expect(user).toContain('Page title: (none)');
    expect(user).toContain('Text with {{url}} inside');
    expect(user).toContain('rejected for these reasons');
    expect(user).toContain('Bad quote.');
  });
});

describe('estimateCostUsd', () => {
  it('prices known models and returns null for unknown ones', () => {
    const usage = {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    };
    expect(estimateCostUsd('claude-opus-5-5', usage)).toBeCloseTo(4 + 2 + 0.2);
    expect(estimateCostUsd('mock-1', usage)).toBeNull();
  });
});
