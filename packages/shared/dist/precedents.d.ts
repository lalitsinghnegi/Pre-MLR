import { z } from 'zod';
/**
 * How a historic comment counts in the trends: its rule category, no matching rule, or not
 * (successfully) classified yet.
 */
export declare const PRECEDENT_BUCKETS: readonly ["safety_information", "fair_balance", "claims", "references", "branding", "links", "legal_privacy", "accessibility", "no_matching_rule", "unclassified"];
export declare const PrecedentBucketSchema: z.ZodEnum<{
    safety_information: "safety_information";
    fair_balance: "fair_balance";
    claims: "claims";
    references: "references";
    branding: "branding";
    links: "links";
    legal_privacy: "legal_privacy";
    accessibility: "accessibility";
    no_matching_rule: "no_matching_rule";
    unclassified: "unclassified";
}>;
export type PrecedentBucket = z.infer<typeof PrecedentBucketSchema>;
export declare const PrecedentFilterSchema: z.ZodObject<{
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
    brand: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string | undefined, string>>>;
    reviewerFunction: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string | undefined, string>>>;
}, z.core.$strip>;
export type PrecedentFilter = z.infer<typeof PrecedentFilterSchema>;
export declare const TREND_INTERVALS: readonly ["month", "quarter"];
export declare const TrendsQuerySchema: z.ZodObject<{
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
    brand: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string | undefined, string>>>;
    reviewerFunction: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string | undefined, string>>>;
    interval: z.ZodDefault<z.ZodEnum<{
        month: "month";
        quarter: "quarter";
    }>>;
}, z.core.$strip>;
export type TrendsQuery = z.input<typeof TrendsQuerySchema>;
declare const Counts: z.ZodRecord<z.ZodEnum<{
    safety_information: "safety_information";
    fair_balance: "fair_balance";
    claims: "claims";
    references: "references";
    branding: "branding";
    links: "links";
    legal_privacy: "legal_privacy";
    accessibility: "accessibility";
    no_matching_rule: "no_matching_rule";
    unclassified: "unclassified";
}>, z.ZodNumber>;
export type BucketCounts = z.infer<typeof Counts>;
declare const Group: z.ZodObject<{
    key: z.ZodString;
    total: z.ZodNumber;
    counts: z.ZodRecord<z.ZodEnum<{
        safety_information: "safety_information";
        fair_balance: "fair_balance";
        claims: "claims";
        references: "references";
        branding: "branding";
        links: "links";
        legal_privacy: "legal_privacy";
        accessibility: "accessibility";
        no_matching_rule: "no_matching_rule";
        unclassified: "unclassified";
    }>, z.ZodNumber>;
}, z.core.$strip>;
export type TrendGroup = z.infer<typeof Group>;
export declare const PrecedentTrendsSchema: z.ZodObject<{
    interval: z.ZodEnum<{
        month: "month";
        quarter: "quarter";
    }>;
    totals: z.ZodObject<{
        comments: z.ZodNumber;
        classified: z.ZodNumber;
        noMatchingRule: z.ZodNumber;
        unclassified: z.ZodNumber;
    }, z.core.$strip>;
    overTime: z.ZodArray<z.ZodObject<{
        period: z.ZodString;
        total: z.ZodNumber;
        counts: z.ZodRecord<z.ZodEnum<{
            safety_information: "safety_information";
            fair_balance: "fair_balance";
            claims: "claims";
            references: "references";
            branding: "branding";
            links: "links";
            legal_privacy: "legal_privacy";
            accessibility: "accessibility";
            no_matching_rule: "no_matching_rule";
            unclassified: "unclassified";
        }>, z.ZodNumber>;
    }, z.core.$strip>>;
    byCategory: z.ZodArray<z.ZodObject<{
        bucket: z.ZodEnum<{
            safety_information: "safety_information";
            fair_balance: "fair_balance";
            claims: "claims";
            references: "references";
            branding: "branding";
            links: "links";
            legal_privacy: "legal_privacy";
            accessibility: "accessibility";
            no_matching_rule: "no_matching_rule";
            unclassified: "unclassified";
        }>;
        total: z.ZodNumber;
    }, z.core.$strip>>;
    byBrand: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        total: z.ZodNumber;
        counts: z.ZodRecord<z.ZodEnum<{
            safety_information: "safety_information";
            fair_balance: "fair_balance";
            claims: "claims";
            references: "references";
            branding: "branding";
            links: "links";
            legal_privacy: "legal_privacy";
            accessibility: "accessibility";
            no_matching_rule: "no_matching_rule";
            unclassified: "unclassified";
        }>, z.ZodNumber>;
    }, z.core.$strip>>;
    byReviewerFunction: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        total: z.ZodNumber;
        counts: z.ZodRecord<z.ZodEnum<{
            safety_information: "safety_information";
            fair_balance: "fair_balance";
            claims: "claims";
            references: "references";
            branding: "branding";
            links: "links";
            legal_privacy: "legal_privacy";
            accessibility: "accessibility";
            no_matching_rule: "no_matching_rule";
            unclassified: "unclassified";
        }>, z.ZodNumber>;
    }, z.core.$strip>>;
    filterOptions: z.ZodObject<{
        brands: z.ZodArray<z.ZodString>;
        reviewerFunctions: z.ZodArray<z.ZodString>;
        firstDate: z.ZodNullable<z.ZodString>;
        lastDate: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    classifiers: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type PrecedentTrends = z.infer<typeof PrecedentTrendsSchema>;
export declare const CandidateRulesQuerySchema: z.ZodObject<{
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
    brand: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string | undefined, string>>>;
    reviewerFunction: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string | undefined, string>>>;
    minSize: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type CandidateRulesQuery = z.input<typeof CandidateRulesQuerySchema>;
export declare const PrecedentExampleSchema: z.ZodObject<{
    id: z.ZodString;
    text: z.ZodString;
    brand: z.ZodString;
    reviewerFunction: z.ZodNullable<z.ZodString>;
    commentedAt: z.ZodString;
}, z.core.$strip>;
export declare const CandidateClusterSchema: z.ZodObject<{
    label: z.ZodString;
    terms: z.ZodArray<z.ZodString>;
    count: z.ZodNumber;
    proofs: z.ZodNumber;
    brands: z.ZodArray<z.ZodString>;
    reviewerFunctions: z.ZodArray<z.ZodString>;
    firstSeen: z.ZodString;
    lastSeen: z.ZodString;
    examples: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
        brand: z.ZodString;
        reviewerFunction: z.ZodNullable<z.ZodString>;
        commentedAt: z.ZodString;
    }, z.core.$strip>>;
    precedentIds: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type CandidateCluster = z.infer<typeof CandidateClusterSchema>;
export declare const CandidateRulesSchema: z.ZodObject<{
    noMatchTotal: z.ZodNumber;
    clustered: z.ZodNumber;
    candidates: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        terms: z.ZodArray<z.ZodString>;
        count: z.ZodNumber;
        proofs: z.ZodNumber;
        brands: z.ZodArray<z.ZodString>;
        reviewerFunctions: z.ZodArray<z.ZodString>;
        firstSeen: z.ZodString;
        lastSeen: z.ZodString;
        examples: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            text: z.ZodString;
            brand: z.ZodString;
            reviewerFunction: z.ZodNullable<z.ZodString>;
            commentedAt: z.ZodString;
        }, z.core.$strip>>;
        precedentIds: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type CandidateRules = z.infer<typeof CandidateRulesSchema>;
/** A historic comment attached to a finding as advisory "Precedent" evidence. */
export declare const FindingPrecedentSchema: z.ZodObject<{
    id: z.ZodString;
    text: z.ZodString;
    site: z.ZodNullable<z.ZodString>;
    brand: z.ZodString;
    commentedAt: z.ZodString;
    reviewerFunction: z.ZodNullable<z.ZodString>;
    outcome: z.ZodNullable<z.ZodString>;
    category: z.ZodNullable<z.ZodString>;
    rank: z.ZodNumber;
    similarity: z.ZodNumber;
}, z.core.$strip>;
export type FindingPrecedent = z.infer<typeof FindingPrecedentSchema>;
export declare const CreateRuleCandidateSchema: z.ZodObject<{
    title: z.ZodString;
    precedentIds: z.ZodArray<z.ZodString>;
    findingId: z.ZodOptional<z.ZodString>;
    note: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CreateRuleCandidate = z.infer<typeof CreateRuleCandidateSchema>;
export declare const RuleCandidateSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    status: z.ZodEnum<{
        proposed: "proposed";
    }>;
    precedentIds: z.ZodArray<z.ZodString>;
    findingId: z.ZodNullable<z.ZodString>;
    scanId: z.ZodNullable<z.ZodString>;
    note: z.ZodNullable<z.ZodString>;
    createdBy: z.ZodString;
    createdAt: z.ZodString;
    examples: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
        brand: z.ZodString;
        reviewerFunction: z.ZodNullable<z.ZodString>;
        commentedAt: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type RuleCandidate = z.infer<typeof RuleCandidateSchema>;
export {};
