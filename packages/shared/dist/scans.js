import { z } from 'zod';
export const SCAN_LIMITS = {
    maxPages: { default: 25, max: 200 },
    maxDepth: { default: 3, max: 10 },
};
export const ScanStatusSchema = z.enum(['queued', 'running', 'completed', 'failed']);
export const ScanPhaseSchema = z.enum(['crawling', 'checking', 'analyzing', 'matching']);
/** Product details some rules need (brand and established names). Kept out of the rule pack. */
export const ProductProfileSchema = z.object({
    brandNames: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
    establishedName: z.string().trim().min(1).max(200),
});
export const CreateScanRequestSchema = z.object({
    startUrl: z.url({ protocol: /^https?$/, error: 'startUrl must be an http(s) URL' }),
    maxPages: z
        .number()
        .int()
        .min(1)
        .max(SCAN_LIMITS.maxPages.max)
        .default(SCAN_LIMITS.maxPages.default),
    maxDepth: z
        .number()
        .int()
        .min(0)
        .max(SCAN_LIMITS.maxDepth.max)
        .default(SCAN_LIMITS.maxDepth.default),
    product: ProductProfileSchema.optional(),
    /** Turn rules on or off for this scan only (by rule id), overriding enabled_by_default. */
    rules: z
        .object({
        enable: z.array(z.string()).default([]),
        disable: z.array(z.string()).default([]),
    })
        .optional(),
});
export const ScanSchema = z.object({
    id: z.string(),
    startUrl: z.string(),
    maxPages: z.number().int(),
    maxDepth: z.number().int(),
    status: ScanStatusSchema,
    /** Step a running scan is on; null when not running. */
    phase: ScanPhaseSchema.nullable(),
    error: z.string().nullable(),
    pagesCrawled: z.number().int(),
    product: ProductProfileSchema.nullable(),
    /** Who requested the scan; null for scans from before sign-in existed. */
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
});
/** An <a href> found on a page. `href` is absolute when resolvable; non-http schemes are kept as-is. */
export const PageLinkSchema = z.object({
    href: z.string(),
    text: z.string(),
});
export const PageSummarySchema = z.object({
    id: z.string(),
    scanId: z.string(),
    crawlIndex: z.number().int(),
    url: z.string(),
    depth: z.number().int(),
    parentPageId: z.string().nullable(),
    title: z.string().nullable(),
    httpStatus: z.number().int().nullable(),
    error: z.string().nullable(),
    textLength: z.number().int(),
    links: z.array(PageLinkSchema),
    screenshots: z.object({ desktop: z.boolean(), mobile: z.boolean() }),
});
//# sourceMappingURL=scans.js.map