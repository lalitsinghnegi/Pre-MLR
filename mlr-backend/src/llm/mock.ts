import type { LLMProvider, LlmRequest, LlmResponse } from './types.js';

/**
 * Deterministic stand-in for tests and offline demos: flags sentences matching simple patterns for
 * the LLM rules it knows, quoting them verbatim from the page text. No network.
 */
const PATTERNS: Record<string, { pattern: RegExp; explanation: string; confidence: number }[]> = {
  'off-label-implied': [
    {
      pattern: /[^.\n]*\b(?:also use|also used|children under \d+|off[- ]label)\b[^.\n]*\./i,
      explanation: 'Suggests a use or population outside the stated indication.',
      confidence: 0.7,
    },
  ],
  'risk-benefit-balance': [
    {
      pattern: /[^.\n]*\b(?:guaranteed|no side effects|completely safe)\b[^.\n]*/i,
      explanation: 'Benefit claim is presented far more prominently than the risk information.',
      confidence: 0.6,
    },
  ],
};

/**
 * Keyword classifier for precedent comments, checked in order (first match wins). Topics without a
 * category are issues no rule covers. Good enough to exercise the pipeline offline, not a model.
 */
const CLASSIFY: { pattern: RegExp; category: string | null; topic: string; confidence: number }[] =
  [
    { pattern: /translat|locali[sz]/i, category: null, topic: 'translation', confidence: 0.8 },
    {
      pattern: /licens|usage rights|model release|stock photo/i,
      category: null,
      topic: 'image rights',
      confidence: 0.8,
    },
    {
      pattern: /\btone\b|casual|exclamation|measured/i,
      category: null,
      topic: 'tone',
      confidence: 0.7,
    },
    {
      pattern: /\btypo\b|misspel|alignment|sentence case|style guide/i,
      category: null,
      topic: 'formatting',
      confidence: 0.7,
    },
    {
      pattern: /alt text|contrast|caption|screen reader|accessib/i,
      category: 'accessibility',
      topic: 'accessibility',
      confidence: 0.85,
    },
    {
      pattern: /fair balance|rebalance|prominence|hides the risks|benefits only/i,
      category: 'fair_balance',
      topic: 'risk prominence',
      confidence: 0.75,
    },
    {
      pattern: /privacy|job code|copyright|terms of use|cookie/i,
      category: 'legal_privacy',
      topic: 'footer legal items',
      confidence: 0.8,
    },
    {
      pattern: /\bISI\b|important safety|adverse event|medwatch|boxed warning|medication guide/i,
      category: 'safety_information',
      topic: 'safety information',
      confidence: 0.85,
    },
    {
      pattern: /established name|trademark|brand name/i,
      category: 'branding',
      topic: 'brand naming',
      confidence: 0.8,
    },
    {
      pattern: /referenc|\bcite\b|citation|footnote/i,
      category: 'references',
      topic: 'claim references',
      confidence: 0.75,
    },
    { pattern: /\blink\b|broken|error page/i, category: 'links', topic: 'links', confidence: 0.7 },
    {
      pattern: /superlative|overstate|claim|implies|indication|not supported|absolute|guarantee/i,
      category: 'claims',
      topic: 'unsupported claims',
      confidence: 0.75,
    },
  ];

function mockClassify(req: LlmRequest): unknown {
  const comments = [...req.userText.matchAll(/<comment id="([^"]+)"[^>]*>([\s\S]*?)<\/comment>/g)];
  return {
    classifications: comments.map(([, id, text]) => {
      const hit = CLASSIFY.find((c) => c.pattern.test(text!));
      return {
        id,
        category: hit?.category ?? 'none',
        ruleId: null,
        confidence: hit?.confidence ?? 0.3,
        topic: hit?.topic ?? 'other',
      };
    }),
  };
}

export class MockProvider implements LLMProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock-1';
  readonly settings = {};

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (req.task === 'precedent-classification') return respond(mockClassify(req));
    const text = /<<<PAGE TEXT\n([\s\S]*?)\nPAGE TEXT>>>/.exec(req.userText)?.[1] ?? '';
    const findings = req.ruleIds.flatMap((ruleId) =>
      (PATTERNS[ruleId] ?? []).flatMap(({ pattern, explanation, confidence }) => {
        const quote = pattern.exec(text)?.[0].trim();
        return quote
          ? [
              {
                ruleId,
                severity: 'major',
                evidenceQuote: quote,
                explanation,
                suggestedRewrite: null,
                confidence,
              },
            ]
          : [];
      }),
    );
    return respond({
      findings,
      pageTip: findings.length
        ? `Mock analysis: review ${findings.length} possible issue(s) flagged on this page.`
        : 'Mock analysis: no issues found under the provided rules.',
    });
  }
}

function respond(output: unknown): LlmResponse {
  return {
    output,
    rawText: JSON.stringify(output),
    model: 'mock-1',
    stopReason: 'end_turn',
    servedByFallback: false,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
}
