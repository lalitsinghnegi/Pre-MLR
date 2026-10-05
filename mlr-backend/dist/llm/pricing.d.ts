import type { LlmUsage } from './types.js';
/** Estimated cost, or null for models without a known price (e.g. the mock). */
export declare function estimateCostUsd(model: string, u: LlmUsage): number | null;
