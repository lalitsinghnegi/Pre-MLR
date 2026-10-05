import { z } from 'zod';
export const RULE_CATEGORIES = [
    'safety_information',
    'fair_balance',
    'claims',
    'references',
    'branding',
    'links',
    'legal_privacy',
    'accessibility',
];
export const RuleCategorySchema = z.enum(RULE_CATEGORIES);
/** Highest first. */
export const SEVERITIES = ['critical', 'major', 'minor', 'info'];
export const SeveritySchema = z.enum(SEVERITIES);
export const CheckTypeSchema = z.enum(['deterministic', 'llm']);
const RuleIdSchema = z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'rule id must be lower-case kebab-case, e.g. "isi-presence"')
    .max(80);
/** Content of one immutable rule version, as authored in a rule pack or the admin screen. */
export const RuleVersionInputSchema = z
    .object({
    ruleId: RuleIdSchema,
    version: z.number().int().min(1),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1),
    category: RuleCategorySchema,
    severity: SeveritySchema,
    checkType: CheckTypeSchema,
    sourceCitation: z.string().trim().min(1),
    sourceUrl: z.url().nullable().default(null),
    /** Caveats about the source, e.g. TODOs where applicability is uncertain. */
    sourceNote: z.string().trim().min(1).nullable().default(null),
    lastVerified: z.iso.date().nullable().default(null),
    promptTemplate: z.string().trim().min(1).nullable().default(null),
    params: z.record(z.string(), z.unknown()).default({}),
    enabledByDefault: z.boolean().default(true),
    origin: z.string().min(1),
})
    .refine((r) => r.checkType !== 'llm' || r.promptTemplate !== null, {
    message: 'LLM rules need a promptTemplate',
    path: ['promptTemplate'],
});
export const RuleVersionSchema = z.object({
    ruleId: z.string(),
    version: z.number().int(),
    title: z.string(),
    description: z.string(),
    category: RuleCategorySchema,
    severity: SeveritySchema,
    checkType: CheckTypeSchema,
    sourceCitation: z.string(),
    sourceUrl: z.string().nullable(),
    sourceNote: z.string().nullable(),
    lastVerified: z.string().nullable(),
    promptTemplate: z.string().nullable(),
    params: z.record(z.string(), z.unknown()),
    enabledByDefault: z.boolean(),
    origin: z.string(),
    contentHash: z.string(),
    createdAt: z.string(),
    createdBy: z.string(),
});
/** The fields an admin can edit; every save becomes a new immutable version. */
const RuleFieldsSchema = z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(5000),
    category: RuleCategorySchema,
    severity: SeveritySchema,
    checkType: CheckTypeSchema,
    sourceCitation: z.string().trim().min(1).max(500),
    sourceUrl: z.url({ protocol: /^https?$/ }).nullable(),
    sourceNote: z.string().trim().min(1).max(2000).nullable(),
    lastVerified: z.iso.date().nullable(),
    promptTemplate: z.string().trim().min(1).max(5000).nullable(),
    params: z.record(z.string(), z.unknown()),
    enabledByDefault: z.boolean(),
});
const needsPrompt = (r) => r.checkType !== 'llm' || r.promptTemplate !== null;
const promptIssue = { message: 'LLM rules need a prompt template', path: ['promptTemplate'] };
export const CreateRuleSchema = RuleFieldsSchema.extend({ ruleId: RuleIdSchema }).refine(needsPrompt, promptIssue);
export const NewRuleVersionSchema = RuleFieldsSchema.extend({
    /** The version the editor started from; a newer one means someone else saved first (409). */
    expectedLatestVersion: z.number().int().min(1),
}).refine(needsPrompt, promptIssue);
export const RuleSummarySchema = z.object({
    ruleId: z.string(),
    latest: RuleVersionSchema,
    versionCount: z.number().int(),
    retiredAt: z.string().nullable(),
    /** Scans whose snapshot included this rule (any version). */
    scans: z.number().int(),
    findings: z.number().int(),
});
export const RuleFieldChangeSchema = z.object({
    field: z.string(),
    from: z.unknown(),
    to: z.unknown(),
});
export const RuleDetailSchema = z.object({
    ruleId: z.string(),
    createdAt: z.string(),
    retiredAt: z.string().nullable(),
    /** Newest first. `changes` compares each version with the one before it. */
    versions: z.array(RuleVersionSchema.extend({
        changes: z.array(RuleFieldChangeSchema),
        scans: z.number().int(),
        findings: z.number().int(),
    })),
    /** Scans that ran this rule, newest first, with the version each used. */
    usage: z.array(z.object({
        scanId: z.string(),
        startUrl: z.string(),
        createdAt: z.string(),
        version: z.number().int(),
        enabled: z.boolean(),
        findings: z.number().int(),
    })),
});
/** A rule as frozen in a scan's snapshot. */
export const ScanRuleSchema = z.object({
    ruleId: z.string(),
    version: z.number().int(),
    title: z.string(),
    category: RuleCategorySchema,
    severity: SeveritySchema,
    checkType: CheckTypeSchema,
    enabled: z.boolean(),
    findings: z.number().int(),
});
//# sourceMappingURL=rules.js.map