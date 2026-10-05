import { z } from 'zod';
export declare const ScanSummarySchema: z.ZodObject<{
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
    findings: z.ZodObject<{
        total: z.ZodNumber;
        byStatus: z.ZodRecord<z.ZodEnum<{
            open: "open";
            accepted: "accepted";
            rejected: "rejected";
            edited: "edited";
        }>, z.ZodNumber>;
        openBySeverity: z.ZodRecord<z.ZodEnum<{
            critical: "critical";
            major: "major";
            minor: "minor";
            info: "info";
        }>, z.ZodNumber>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type ScanSummary = z.infer<typeof ScanSummarySchema>;
/** A finding with the page and rule details the review grid shows. */
export declare const FindingViewSchema: z.ZodObject<{
    id: z.ZodString;
    scanId: z.ZodString;
    pageId: z.ZodNullable<z.ZodString>;
    ruleId: z.ZodString;
    ruleVersion: z.ZodNumber;
    detectedBy: z.ZodEnum<{
        llm: "llm";
        rules_engine: "rules_engine";
    }>;
    severity: z.ZodEnum<{
        critical: "critical";
        major: "major";
        minor: "minor";
        info: "info";
    }>;
    message: z.ZodString;
    evidenceText: z.ZodNullable<z.ZodString>;
    evidenceLocation: z.ZodNullable<z.ZodObject<{
        view: z.ZodEnum<{
            desktop: "desktop";
            mobile: "mobile";
        }>;
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, z.core.$strip>>;
    evidenceCropPath: z.ZodNullable<z.ZodString>;
    suggestedFix: z.ZodNullable<z.ZodString>;
    editedFix: z.ZodNullable<z.ZodString>;
    confidence: z.ZodNullable<z.ZodNumber>;
    status: z.ZodEnum<{
        open: "open";
        accepted: "accepted";
        rejected: "rejected";
        edited: "edited";
    }>;
    authorComment: z.ZodNullable<z.ZodString>;
    revision: z.ZodNumber;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    updatedBy: z.ZodString;
    page: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        number: z.ZodNumber;
        url: z.ZodString;
        title: z.ZodNullable<z.ZodString>;
        screenshots: z.ZodObject<{
            desktop: z.ZodBoolean;
            mobile: z.ZodBoolean;
        }, z.core.$strip>;
        tip: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>>;
    rule: z.ZodObject<{
        title: z.ZodString;
        category: z.ZodEnum<{
            safety_information: "safety_information";
            fair_balance: "fair_balance";
            claims: "claims";
            references: "references";
            branding: "branding";
            links: "links";
            legal_privacy: "legal_privacy";
            accessibility: "accessibility";
        }>;
        description: z.ZodString;
        sourceCitation: z.ZodString;
        sourceUrl: z.ZodNullable<z.ZodString>;
        sourceNote: z.ZodNullable<z.ZodString>;
    }, z.core.$strip>;
    precedents: z.ZodArray<z.ZodObject<{
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
    }, z.core.$strip>>;
}, z.core.$strip>;
export type FindingView = z.infer<typeof FindingViewSchema>;
export declare const BulkFindingUpdateSchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        expectedRevision: z.ZodNumber;
    }, z.core.$strip>>;
    status: z.ZodEnum<{
        open: "open";
        accepted: "accepted";
        rejected: "rejected";
    }>;
    comment: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type BulkFindingUpdate = z.infer<typeof BulkFindingUpdateSchema>;
