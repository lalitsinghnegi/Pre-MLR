import { z } from 'zod';
import { RULE_CATEGORIES } from './rules.js';
/**
 * How a historic comment counts in the trends: its rule category, no matching rule, or not
 * (successfully) classified yet.
 */
export const PRECEDENT_BUCKETS = [...RULE_CATEGORIES, 'no_matching_rule', 'unclassified'];
export const PrecedentBucketSchema = z.enum(PRECEDENT_BUCKETS);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const nonEmpty = z
    .string()
    .trim()
    .transform((s) => s || undefined)
    .optional();
export const PrecedentFilterSchema = z.object({
    /** Inclusive, YYYY-MM-DD (the comment date). */
    from: IsoDate.optional(),
    to: IsoDate.optional(),
    brand: nonEmpty,
    reviewerFunction: nonEmpty,
});
export const TREND_INTERVALS = ['month', 'quarter'];
export const TrendsQuerySchema = PrecedentFilterSchema.extend({
    interval: z.enum(TREND_INTERVALS).default('month'),
});
const Counts = z.record(PrecedentBucketSchema, z.number().int());
const Group = z.object({ key: z.string(), total: z.number().int(), counts: Counts });
export const PrecedentTrendsSchema = z.object({
    interval: z.enum(TREND_INTERVALS),
    totals: z.object({
        comments: z.number().int(),
        classified: z.number().int(),
        noMatchingRule: z.number().int(),
        unclassified: z.number().int(),
    }),
    /** Every period from the first to the last comment in range, including empty ones. */
    overTime: z.array(z.object({ period: z.string(), total: z.number().int(), counts: Counts })),
    byCategory: z.array(z.object({ bucket: PrecedentBucketSchema, total: z.number().int() })),
    byBrand: z.array(Group),
    byReviewerFunction: z.array(Group),
    /** Values for the filter controls, across all comments (ignoring the current filter). */
    filterOptions: z.object({
        brands: z.array(z.string()),
        reviewerFunctions: z.array(z.string()),
        firstDate: z.string().nullable(),
        lastDate: z.string().nullable(),
    }),
    /** Which classifiers produced the counts (e.g. "anthropic:claude-opus-5-5"). */
    classifiers: z.array(z.string()),
});
export const CandidateRulesQuerySchema = PrecedentFilterSchema.extend({
    /** Smallest cluster reported as a candidate. */
    minSize: z.coerce.number().int().min(2).max(50).default(3),
});
export const PrecedentExampleSchema = z.object({
    id: z.string(),
    text: z.string(),
    brand: z.string(),
    reviewerFunction: z.string().nullable(),
    commentedAt: z.string(),
});
export const CandidateClusterSchema = z.object({
    /** Most common topic the classifier gave the cluster's comments. */
    label: z.string(),
    /** Most characteristic words. */
    terms: z.array(z.string()),
    count: z.number().int(),
    proofs: z.number().int(),
    brands: z.array(z.string()),
    reviewerFunctions: z.array(z.string()),
    firstSeen: z.string(),
    lastSeen: z.string(),
    examples: z.array(PrecedentExampleSchema),
    precedentIds: z.array(z.string()),
});
export const CandidateRulesSchema = z.object({
    /** Classified comments with no matching rule, in the filter range. */
    noMatchTotal: z.number().int(),
    /** How many of those fall in a reported candidate cluster. */
    clustered: z.number().int(),
    candidates: z.array(CandidateClusterSchema),
});
/** A historic comment attached to a finding as advisory "Precedent" evidence. */
export const FindingPrecedentSchema = z.object({
    id: z.string(),
    text: z.string(),
    site: z.string().nullable(),
    brand: z.string(),
    commentedAt: z.string(),
    reviewerFunction: z.string().nullable(),
    /** The comment's status in the proofing tool (e.g. resolved, rejected). */
    outcome: z.string().nullable(),
    category: z.string().nullable(),
    /** 1 = most similar. */
    rank: z.number().int(),
    /** Cosine similarity, 0..1 (higher is closer). */
    similarity: z.number(),
});
export const CreateRuleCandidateSchema = z.object({
    /** Working title for the proposed rule. */
    title: z.string().trim().min(3).max(200),
    precedentIds: z.array(z.string().min(1)).min(1).max(100),
    /** The finding the precedent was shown on, if promoted from the review grid. */
    findingId: z.string().min(1).optional(),
    note: z.string().trim().max(2000).optional(),
});
export const RuleCandidateSchema = z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(['proposed']),
    precedentIds: z.array(z.string()),
    findingId: z.string().nullable(),
    scanId: z.string().nullable(),
    note: z.string().nullable(),
    createdBy: z.string(),
    createdAt: z.string(),
    /** Up to three of the source comments, for context. */
    examples: z.array(PrecedentExampleSchema),
});
//# sourceMappingURL=precedents.js.map