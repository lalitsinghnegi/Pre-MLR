import { z } from 'zod';
export declare const SCAN_LIMITS: {
    readonly maxPages: {
        readonly default: 25;
        readonly max: 200;
    };
    readonly maxDepth: {
        readonly default: 3;
        readonly max: 10;
    };
};
export declare const ScanStatusSchema: z.ZodEnum<{
    queued: "queued";
    running: "running";
    completed: "completed";
    failed: "failed";
}>;
export type ScanStatus = z.infer<typeof ScanStatusSchema>;
export declare const ScanPhaseSchema: z.ZodEnum<{
    crawling: "crawling";
    checking: "checking";
    analyzing: "analyzing";
    matching: "matching";
}>;
export type ScanPhase = z.infer<typeof ScanPhaseSchema>;
/** Product details some rules need (brand and established names). Kept out of the rule pack. */
export declare const ProductProfileSchema: z.ZodObject<{
    brandNames: z.ZodArray<z.ZodString>;
    establishedName: z.ZodString;
}, z.core.$strip>;
export type ProductProfile = z.infer<typeof ProductProfileSchema>;
export declare const CreateScanRequestSchema: z.ZodObject<{
    startUrl: z.ZodURL;
    maxPages: z.ZodDefault<z.ZodNumber>;
    maxDepth: z.ZodDefault<z.ZodNumber>;
    product: z.ZodOptional<z.ZodObject<{
        brandNames: z.ZodArray<z.ZodString>;
        establishedName: z.ZodString;
    }, z.core.$strip>>;
    rules: z.ZodOptional<z.ZodObject<{
        enable: z.ZodDefault<z.ZodArray<z.ZodString>>;
        disable: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type CreateScanRequest = z.input<typeof CreateScanRequestSchema>;
export declare const ScanSchema: z.ZodObject<{
    id: z.ZodString;
    startUrl: z.ZodString;
    maxPages: z.ZodNumber;
    maxDepth: z.ZodNumber;
    status: z.ZodEnum<{
        queued: "queued";
        running: "running";
        completed: "completed";
        failed: "failed";
    }>;
    phase: z.ZodNullable<z.ZodEnum<{
        crawling: "crawling";
        checking: "checking";
        analyzing: "analyzing";
        matching: "matching";
    }>>;
    error: z.ZodNullable<z.ZodString>;
    pagesCrawled: z.ZodNumber;
    product: z.ZodNullable<z.ZodObject<{
        brandNames: z.ZodArray<z.ZodString>;
        establishedName: z.ZodString;
    }, z.core.$strip>>;
    createdBy: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    startedAt: z.ZodNullable<z.ZodString>;
    finishedAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type Scan = z.infer<typeof ScanSchema>;
/** An <a href> found on a page. `href` is absolute when resolvable; non-http schemes are kept as-is. */
export declare const PageLinkSchema: z.ZodObject<{
    href: z.ZodString;
    text: z.ZodString;
}, z.core.$strip>;
export type PageLink = z.infer<typeof PageLinkSchema>;
export declare const PageSummarySchema: z.ZodObject<{
    id: z.ZodString;
    scanId: z.ZodString;
    crawlIndex: z.ZodNumber;
    url: z.ZodString;
    depth: z.ZodNumber;
    parentPageId: z.ZodNullable<z.ZodString>;
    title: z.ZodNullable<z.ZodString>;
    httpStatus: z.ZodNullable<z.ZodNumber>;
    error: z.ZodNullable<z.ZodString>;
    textLength: z.ZodNumber;
    links: z.ZodArray<z.ZodObject<{
        href: z.ZodString;
        text: z.ZodString;
    }, z.core.$strip>>;
    screenshots: z.ZodObject<{
        desktop: z.ZodBoolean;
        mobile: z.ZodBoolean;
    }, z.core.$strip>;
}, z.core.$strip>;
export type PageSummary = z.infer<typeof PageSummarySchema>;
