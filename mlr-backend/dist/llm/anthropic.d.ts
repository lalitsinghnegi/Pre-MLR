import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LlmRequest, LlmResponse } from './types.js';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface AnthropicProviderOptions {
    model: string;
    /** Null omits output_config.effort (e.g. Claude Haiku 4.5, which rejects it). */
    effort: Effort | null;
    maxTokens: number;
    /** Server-side refusal fallback: a declined request is re-run on another model in the same call. */
    fallback: boolean;
    /** Passed to the SDK client; tests use a stub fetch and an explicit key. */
    client?: Anthropic;
}
/**
 * Claude via the official SDK. Structured output (output_config.format) constrains the response to
 * the request's schema; the SDK retries 429/5xx with backoff (maxRetries on the client).
 */
export declare class AnthropicProvider implements LLMProvider {
    private readonly opts;
    readonly name: "anthropic";
    readonly model: string;
    readonly settings: Record<string, unknown>;
    private readonly client;
    constructor(opts: AnthropicProviderOptions);
    complete(req: LlmRequest, signal?: AbortSignal): Promise<LlmResponse>;
}
