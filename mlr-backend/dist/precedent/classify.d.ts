import { z } from 'zod';
import type { Db } from '../db/client.js';
import type { LLMProvider } from '../llm/types.js';
/** Bump with a new prompts/precedent-classification/<version>/ directory. */
export declare const CLASSIFY_PROMPT_VERSION = "v1";
/** The category value the model uses for "no matching rule". */
export declare const NO_MATCH = "none";
export interface ClassifierRule {
    ruleId: string;
    version: number;
    category: string;
    title: string;
    description: string;
}
/** Current (non-retired) rules of the loaded pack: what comments are classified against. */
export declare function classifierRules(db: Db): ClassifierRule[];
/** Changes whenever a rule is added, retired, re-versioned or moved to another category. */
export declare function rulePackHash(rules: ClassifierRule[]): string;
/** Categories with their rules; identical for every batch of a run, so it is sent as a cached block. */
export declare function renderCategories(rules: ClassifierRule[]): string;
export declare function renderComments(items: {
    key: string;
    text: string;
    reviewerFunction: string | null;
}[]): string;
/**
 * Structured-output schema. Enums are only hints to the model (see the LLM notes in CLAUDE.md), so
 * validateClassifications re-checks every value.
 */
export declare function classificationSchema(categories: string[], ruleIds: string[]): z.ZodObject<{
    classifications: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        category: z.ZodEnum<{
            [x: string]: string;
        }>;
        ruleId: z.ZodNull | z.ZodNullable<z.ZodEnum<{
            [x: string]: string;
        }>>;
        confidence: z.ZodNumber;
        topic: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export interface ValidClassification {
    category: string | null;
    ruleId: string | null;
    confidence: number;
    noMatchingRule: boolean;
    topic: string;
}
/**
 * Checks model output against the batch: every id answered once, known categories, confidence
 * within 0..1. A rule id that is unknown or outside the chosen category is dropped (the category
 * still stands). Returns the valid answers and the problems to send back on the retry.
 */
export declare function validateClassifications(output: unknown, ctx: {
    ids: string[];
    rules: ClassifierRule[];
}): {
    valid: Map<string, ValidClassification>;
    problems: string[];
};
/** USD estimate for classifying `comments` comments, or null for unpriced models (e.g. the mock). */
export declare function estimateClassificationCost(model: string, comments: number, batchSize?: number): number | null;
export interface ClassifyOptions {
    provider: LLMProvider;
    actor: string;
    /** Re-classify comments whose classification is already current. */
    force?: boolean;
    batchSize?: number;
    concurrency?: number;
    signal?: AbortSignal;
}
export interface ClassifyResult {
    total: number;
    /** Already classified with this provider, model, prompt and rule pack (skipped). */
    upToDate: number;
    classified: number;
    noMatchingRule: number;
    failed: number;
    requests: number;
    costUsd: number;
    promptVersion: string;
    rulePackHash: string;
}
type Pending = {
    id: string;
    text: string;
    reviewerFunction: string | null;
};
/** The precedents that need (re-)classifying for this provider, prompt and rule pack. */
export declare function pendingPrecedents(db: Db, key: {
    provider: string;
    model: string;
    promptVersion: string;
    rulePackHash: string;
}, force?: boolean): {
    total: number;
    pending: Pending[];
};
/**
 * Classifies historic comments against the current rule pack's categories, in batches: one call per
 * batch, validated output, and one retry (for the comments still unanswered) with feedback. Comments
 * that still have no valid answer, or whose batch failed, are stored as 'failed' with no category.
 */
export declare function classifyPrecedents(db: Db, opts: ClassifyOptions): Promise<ClassifyResult>;
export {};
