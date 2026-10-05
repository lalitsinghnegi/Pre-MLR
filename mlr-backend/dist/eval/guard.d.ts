import type { ModelConfig } from './models.js';
export interface SpendEstimate {
    paidModels: string[];
    /** USD, or null if a model has no known price. */
    estimateUsd: number | null;
}
export declare function estimateSpend(models: ModelConfig[], pages: number, runs: number): SpendEstimate;
/**
 * Refuses to start paid runs without explicit confirmation, or when the estimate already exceeds
 * the budget. Returns an error message, or null when it is fine to proceed.
 */
export declare function checkSpend(est: SpendEstimate, opts: {
    yes: boolean;
    maxCostUsd: number; /** What the run sends to the API. */
    sends?: string;
}): string | null;
