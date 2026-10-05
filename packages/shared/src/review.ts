import { z } from 'zod';
import { FindingSchema, FindingStatusSchema } from './findings.js';
import { FindingPrecedentSchema } from './precedents.js';
import { RuleCategorySchema, SeveritySchema } from './rules.js';
import { ScanSchema } from './scans.js';

export const ScanSummarySchema = ScanSchema.extend({
  findings: z.object({
    total: z.number().int(),
    byStatus: z.record(FindingStatusSchema, z.number().int()),
    /** Open findings by severity. */
    openBySeverity: z.record(SeveritySchema, z.number().int()),
  }),
});
export type ScanSummary = z.infer<typeof ScanSummarySchema>;

/** A finding with the page and rule details the review grid shows. */
export const FindingViewSchema = FindingSchema.extend({
  page: z
    .object({
      id: z.string(),
      /** 1-based crawl order; matches the site map and PDF. */
      number: z.number().int(),
      url: z.string(),
      title: z.string().nullable(),
      screenshots: z.object({ desktop: z.boolean(), mobile: z.boolean() }),
      /** LLM page tip, when the page was analysed. */
      tip: z.string().nullable(),
    })
    .nullable(),
  rule: z.object({
    title: z.string(),
    category: RuleCategorySchema,
    description: z.string(),
    sourceCitation: z.string(),
    sourceUrl: z.string().nullable(),
    sourceNote: z.string().nullable(),
  }),
  /** Similar historic MLR comments (advisory; lower authority than the rule). Most similar first. */
  precedents: z.array(FindingPrecedentSchema),
});
export type FindingView = z.infer<typeof FindingViewSchema>;

export const BulkFindingUpdateSchema = z.object({
  items: z
    .array(z.object({ id: z.string(), expectedRevision: z.number().int().min(1) }))
    .min(1)
    .max(1000),
  /** Bulk actions don't edit fixes, so "edited" isn't allowed here. */
  status: FindingStatusSchema.exclude(['edited']),
  comment: z.string().trim().max(5000).optional(),
});
export type BulkFindingUpdate = z.infer<typeof BulkFindingUpdateSchema>;
