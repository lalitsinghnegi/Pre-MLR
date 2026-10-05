import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../src/llm/anthropic.js';
import type { LlmRequest } from '../src/llm/types.js';
import { outputSchema } from '../src/llm/schema.js';
import { classificationSchema } from '../src/precedent/classify.js';

const output = {
  findings: [
    {
      ruleId: 'off-label-implied',
      severity: 'critical',
      evidenceQuote: 'x',
      explanation: 'y',
      suggestedRewrite: null,
      confidence: 0.7,
    },
  ],
  pageTip: 'Fix it.',
};

function message(overrides: object = {}) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text: JSON.stringify(output) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 1200,
      output_tokens: 300,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 0,
    },
    ...overrides,
  };
}

/** A stub fetch that records requests and replays the given responses in order. */
function stubFetch(responses: Response[]) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return responses.shift()!;
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const request: LlmRequest = {
  task: 'page-analysis',
  system: 'SYSTEM',
  rulesBlock: 'RULES',
  userText: 'PAGE',
  image: { mediaType: 'image/jpeg', base64: 'aGVsbG8=' },
  ruleIds: ['off-label-implied', 'risk-benefit-balance'],
  outputSchema: outputSchema(['off-label-implied', 'risk-benefit-balance']),
};

const provider = (
  fetch: typeof globalThis.fetch,
  opts: Partial<ConstructorParameters<typeof AnthropicProvider>[0]> = {},
  maxRetries = 0,
) =>
  new AnthropicProvider({
    model: 'claude-opus-5-5',
    effort: 'high',
    maxTokens: 16000,
    fallback: true,
    client: new Anthropic({ apiKey: 'test-key', fetch, maxRetries }),
    ...opts,
  });

describe('AnthropicProvider (stubbed HTTP; no real API calls)', () => {
  it('sends model, effort, structured-output schema, cached system blocks, image and fallback', async () => {
    const { fetch, requests } = stubFetch([json(message())]);
    const res = await provider(fetch).complete(request);

    expect(requests).toHaveLength(1);
    const { url, headers, body } = requests[0]!;
    expect(url).toMatch(/\/v1\/messages\?beta=true$/);
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      fallbacks: 'default',
      system: [
        { type: 'text', text: 'SYSTEM' },
        { type: 'text', text: 'RULES', cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: 'aGVsbG8=' },
            },
            { type: 'text', text: 'PAGE' },
          ],
        },
      ],
    });
    const config = body.output_config as {
      effort: string;
      format: { type: string; schema: { properties: Record<string, unknown> } };
    };
    expect(config.effort).toBe('high');
    expect(config.format.type).toBe('json_schema');
    // The SDK sends enums as description hints, not constraints; validateOutput enforces them.
    expect(JSON.stringify(config.format.schema)).toContain('off-label-implied');
    expect(JSON.stringify(config.format.schema)).toContain('risk-benefit-balance');
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('temperature');

    expect(res).toMatchObject({
      output,
      model: 'claude-opus-5-5',
      stopReason: 'end_turn',
      servedByFallback: false,
      usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800, cacheWriteTokens: 0 },
    });
  });

  it("sends the request's own output schema (precedent classification, no image)", async () => {
    const answer = {
      classifications: [
        { id: 'c1', category: 'claims', ruleId: null, confidence: 0.9, topic: 'superlatives' },
      ],
    };
    const { fetch, requests } = stubFetch([
      json(message({ content: [{ type: 'text', text: JSON.stringify(answer) }] })),
    ]);
    const res = await provider(fetch).complete({
      ...request,
      task: 'precedent-classification',
      image: null,
      userText: 'COMMENTS',
      outputSchema: classificationSchema(['claims', 'links'], ['superlatives']),
    });
    const body = requests[0]!.body as {
      messages: { content: unknown[] }[];
      output_config: { format: { schema: unknown } };
    };
    expect(body.messages[0]!.content).toEqual([{ type: 'text', text: 'COMMENTS' }]);
    const schema = JSON.stringify(body.output_config.format.schema);
    expect(schema).toContain('classifications');
    // Enums travel as description hints: validateClassifications enforces them.
    expect(schema).toContain(String.raw`{enum: [\"none\",\"claims\",\"links\"]}`);
    expect(schema).not.toContain('pageTip');
    expect(res.output).toEqual(answer);
  });

  it('omits the fallback beta and parameter when disabled', async () => {
    const { fetch, requests } = stubFetch([json(message())]);
    await provider(fetch, { fallback: false }).complete(request);
    expect(requests[0]!.body).not.toHaveProperty('fallbacks');
    expect(requests[0]!.headers.get('anthropic-beta') ?? '').not.toContain('server-side-fallback');
  });

  it('reports when a refusal fallback served the response', async () => {
    const usage = { ...message().usage, iterations: [{ type: 'fallback_message' }] };
    const { fetch } = stubFetch([json(message({ model: 'claude-opus-4-8', usage }))]);
    expect(await provider(fetch).complete(request)).toMatchObject({
      model: 'claude-opus-4-8',
      servedByFallback: true,
    });
  });

  it('retries a 429 (SDK backoff) and surfaces RateLimitError once retries run out', async () => {
    const limited = () =>
      json({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 429, {
        'retry-after': '0',
      });
    const ok = stubFetch([limited(), json(message())]);
    await expect(provider(ok.fetch, {}, 1).complete(request)).resolves.toMatchObject({
      stopReason: 'end_turn',
    });
    expect(ok.requests).toHaveLength(2);

    const fail = stubFetch([limited()]);
    await expect(provider(fail.fetch, {}, 0).complete(request)).rejects.toBeInstanceOf(
      Anthropic.RateLimitError,
    );
  });
});
