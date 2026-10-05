import type { CandidateCluster } from '@pre-mlr/shared';
export interface ClusterInput {
    id: string;
    text: string;
    topic: string | null;
    brand: string;
    proofName: string | null;
    reviewerFunction: string | null;
    commentedAt: string;
}
export interface ClusterOptions {
    /** Cosine similarity to a cluster's centroid needed to join it. */
    threshold?: number;
    /** Smallest cluster reported. */
    minSize?: number;
    /** Fewest distinct proofs a cluster must span (one proof repeating itself is not a trend). */
    minProofs?: number;
    /** Weight of the classifier's topic words relative to the comment's own words. */
    topicWeight?: number;
}
/** Lowercased words of 3+ letters, minus stopwords, with plural "s" stripped. */
export declare function tokenize(text: string): string[];
/**
 * Groups comments that no rule covers into recurring themes: TF-IDF vectors of the comment text
 * plus the classifier's topic (weighted), joined greedily to the most similar cluster centroid in
 * date order. Deterministic and dependency-free; embedding similarity arrives with Prompt 14.
 * Returns only clusters big enough to suggest a new rule, largest first.
 */
export declare function clusterNoMatch(items: ClusterInput[], opts?: ClusterOptions): CandidateCluster[];
