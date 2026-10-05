import { z } from 'zod';
import { SeveritySchema } from './rules.js';

export const FINDING_STATUSES = ['open', 'accepted', 'rejected', 'edited'] as const;
export const FindingStatusSchema = z.enum(FINDING_STATUSES);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const DetectedBySchema = z.enum(['rules_engine', 'llm']);
export type DetectedBy = z.infer<typeof DetectedBySchema>;

/** Where the evidence is on a page screenshot, in screenshot pixels. */
export const EvidenceLocationSchema = z.object({
  view: z.enum(['desktop', 'mobile']),
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type EvidenceLocation = z.infer<typeof EvidenceLocationSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  scanId: z.string(),
  /** Null for site-wide findings. */
  pageId: z.string().nullable(),
  ruleId: z.string(),
  ruleVersion: z.number().int(),
  detectedBy: DetectedBySchema,
  severity: SeveritySchema,
  message: z.string(),
  evidenceText: z.string().nullable(),
  evidenceLocation: EvidenceLocationSchema.nullable(),
  evidenceCropPath: z.string().nullable(),
  /** As proposed by the engine or LLM; never modified. */
  suggestedFix: z.string().nullable(),
  /** The author's version of the fix. */
  editedFix: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  status: FindingStatusSchema,
  authorComment: z.string().nullable(),
  revision: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

/**
 * An author's change to a finding. Setting editedFix implies status "edited";
 * expectedRevision guards against overwriting someone else's newer change.
 */
export const FindingUpdateSchema = z
  .object({
    status: FindingStatusSchema.optional(),
    editedFix: z.string().trim().min(1).max(5000).optional(),
    comment: z.string().trim().max(5000).nullable().optional(),
    expectedRevision: z.number().int().min(1).optional(),
  })
  .refine((u) => u.status !== undefined || u.editedFix !== undefined || u.comment !== undefined, {
    message: 'Nothing to update',
  })
  .refine((u) => u.editedFix === undefined || u.status === undefined || u.status === 'edited', {
    message: 'editedFix can only be combined with status "edited"',
    path: ['status'],
  });
export type FindingUpdate = z.infer<typeof FindingUpdateSchema>;

export const AuditEntrySchema = z.object({
  id: z.number().int(),
  entityType: z.string(),
  entityId: z.string(),
  scanId: z.string().nullable(),
  action: z.string(),
  changes: z.record(z.string(), z.tuple([z.unknown(), z.unknown()])),
  actor: z.string(),
  at: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
