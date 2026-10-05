import type { LlmUsage } from './types.js';

/**
 * USD per million tokens (Anthropic first-party list prices as of 2026-09; verify before relying on
 * them). Cache writes use the 5-minute rate (1.25x input).
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};

/** Estimated cost, or null for models without a known price (e.g. the mock). */
export function estimateCostUsd(model: string, u: LlmUsage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const cost =
    (u.inputTokens * p.input +
      u.cacheWriteTokens * p.input * 1.25 +
      u.cacheReadTokens * p.cacheRead +
      u.outputTokens * p.output) /
    1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}
