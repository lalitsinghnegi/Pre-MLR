import type { PrecedentBucket, PrecedentTrends } from '@pre-mlr/shared';
import { CATEGORY_LABEL } from '../review/model';

export const BUCKET_LABEL: Record<PrecedentBucket, string> = {
  ...CATEGORY_LABEL,
  no_matching_rule: 'No matching rule',
  unclassified: 'Unclassified',
};

/** Buckets that have comments, most frequent first (the order every view uses). */
export const bucketsOf = (t: PrecedentTrends): PrecedentBucket[] =>
  t.byCategory.map((c) => c.bucket);

/** "commercial" → "Commercial". */
export const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
