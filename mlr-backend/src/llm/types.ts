import type { z } from 'zod';

export type LlmTask = 'page-analysis' | 'precedent-classification';

/** What a caller sends to a provider. Providers only transport; prompts are built by the caller. */
export interface LlmRequest {
  task: LlmTask;
  /** Static instructions (cached). */
  system: string;
  /** Rule list (cached across a scan's pages or a classification run's batches). */
  rulesBlock: string;
  /** Per-request content (a page, or a batch of comments). */
  userText: string;
  image: { mediaType: 'image/jpeg' | 'image/png'; base64: string } | null;
  /** Rule ids the response may cite. */
  ruleIds: string[];
  /** Structured-output schema for the response (a hint to the model; callers still validate). */
  outputSchema: z.ZodType;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface LlmResponse {
  /** Parsed JSON output, or null if the model returned nothing parseable. */
  output: unknown;
  rawText: string;
  /** Model that produced the response (differs from the requested one when a fallback served it). */
  model: string;
  stopReason: string | null;
  servedByFallback: boolean;
  usage: LlmUsage;
}

export interface LLMProvider {
  readonly name: 'anthropic' | 'mock';
  readonly model: string;
  /** Settings that change the output; part of the cache key. */
  readonly settings: Record<string, unknown>;
  complete(request: LlmRequest, signal?: AbortSignal): Promise<LlmResponse>;
}

export const ZERO_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};
