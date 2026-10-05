import { z } from 'zod';
export declare const FINDING_STATUSES: readonly ["open", "accepted", "rejected", "edited"];
export declare const FindingStatusSchema: z.ZodEnum<{
    open: "open";
    accepted: "accepted";
    rejected: "rejected";
    edited: "edited";
}>;
export type FindingStatus = z.infer<typeof FindingStatusSchema>;
export declare const DetectedBySchema: z.ZodEnum<{
    llm: "llm";
    rules_engine: "rules_engine";
}>;
export type DetectedBy = z.infer<typeof DetectedBySchema>;
/** Where the evidence is on a page screenshot, in screenshot pixels. */
export declare const EvidenceLocationSchema: z.ZodObject<{
    view: z.ZodEnum<{
        desktop: "desktop";
        mobile: "mobile";
    }>;
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
}, z.core.$strip>;
export type EvidenceLocation = z.infer<typeof EvidenceLocationSchema>;
export declare const FindingSchema: z.ZodObject<{
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
}, z.core.$strip>;
export type Finding = z.infer<typeof FindingSchema>;
/**
 * An author's change to a finding. Setting editedFix implies status "edited";
 * expectedRevision guards against overwriting someone else's newer change.
 */
export declare const FindingUpdateSchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<{
        open: "open";
        accepted: "accepted";
        rejected: "rejected";
        edited: "edited";
    }>>;
    editedFix: z.ZodOptional<z.ZodString>;
    comment: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    expectedRevision: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type FindingUpdate = z.infer<typeof FindingUpdateSchema>;
export declare const AuditEntrySchema: z.ZodObject<{
    id: z.ZodNumber;
    entityType: z.ZodString;
    entityId: z.ZodString;
    scanId: z.ZodNullable<z.ZodString>;
    action: z.ZodString;
    changes: z.ZodRecord<z.ZodString, z.ZodTuple<[z.ZodUnknown, z.ZodUnknown], null>>;
    actor: z.ZodString;
    at: z.ZodString;
}, z.core.$strip>;
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
