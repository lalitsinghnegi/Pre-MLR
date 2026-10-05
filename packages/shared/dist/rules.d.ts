import { z } from 'zod';
export declare const RULE_CATEGORIES: readonly ["safety_information", "fair_balance", "claims", "references", "branding", "links", "legal_privacy", "accessibility"];
export declare const RuleCategorySchema: z.ZodEnum<{
    safety_information: "safety_information";
    fair_balance: "fair_balance";
    claims: "claims";
    references: "references";
    branding: "branding";
    links: "links";
    legal_privacy: "legal_privacy";
    accessibility: "accessibility";
}>;
export type RuleCategory = z.infer<typeof RuleCategorySchema>;
/** Highest first. */
export declare const SEVERITIES: readonly ["critical", "major", "minor", "info"];
export declare const SeveritySchema: z.ZodEnum<{
    critical: "critical";
    major: "major";
    minor: "minor";
    info: "info";
}>;
export type Severity = z.infer<typeof SeveritySchema>;
export declare const CheckTypeSchema: z.ZodEnum<{
    deterministic: "deterministic";
    llm: "llm";
}>;
export type CheckType = z.infer<typeof CheckTypeSchema>;
/** Content of one immutable rule version, as authored in a rule pack or the admin screen. */
export declare const RuleVersionInputSchema: z.ZodObject<{
    ruleId: z.ZodString;
    version: z.ZodNumber;
    title: z.ZodString;
    description: z.ZodString;
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
    severity: z.ZodEnum<{
        critical: "critical";
        major: "major";
        minor: "minor";
        info: "info";
    }>;
    checkType: z.ZodEnum<{
        deterministic: "deterministic";
        llm: "llm";
    }>;
    sourceCitation: z.ZodString;
    sourceUrl: z.ZodDefault<z.ZodNullable<z.ZodURL>>;
    sourceNote: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    lastVerified: z.ZodDefault<z.ZodNullable<z.ZodISODate>>;
    promptTemplate: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    params: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    enabledByDefault: z.ZodDefault<z.ZodBoolean>;
    origin: z.ZodString;
}, z.core.$strip>;
export type RuleVersionInput = z.input<typeof RuleVersionInputSchema>;
export type RuleVersionData = z.output<typeof RuleVersionInputSchema>;
export declare const RuleVersionSchema: z.ZodObject<{
    ruleId: z.ZodString;
    version: z.ZodNumber;
    title: z.ZodString;
    description: z.ZodString;
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
    severity: z.ZodEnum<{
        critical: "critical";
        major: "major";
        minor: "minor";
        info: "info";
    }>;
    checkType: z.ZodEnum<{
        deterministic: "deterministic";
        llm: "llm";
    }>;
    sourceCitation: z.ZodString;
    sourceUrl: z.ZodNullable<z.ZodString>;
    sourceNote: z.ZodNullable<z.ZodString>;
    lastVerified: z.ZodNullable<z.ZodString>;
    promptTemplate: z.ZodNullable<z.ZodString>;
    params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    enabledByDefault: z.ZodBoolean;
    origin: z.ZodString;
    contentHash: z.ZodString;
    createdAt: z.ZodString;
    createdBy: z.ZodString;
}, z.core.$strip>;
export type RuleVersion = z.infer<typeof RuleVersionSchema>;
/** The fields an admin can edit; every save becomes a new immutable version. */
declare const RuleFieldsSchema: z.ZodObject<{
    title: z.ZodString;
    description: z.ZodString;
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
    severity: z.ZodEnum<{
        critical: "critical";
        major: "major";
        minor: "minor";
        info: "info";
    }>;
    checkType: z.ZodEnum<{
        deterministic: "deterministic";
        llm: "llm";
    }>;
    sourceCitation: z.ZodString;
    sourceUrl: z.ZodNullable<z.ZodURL>;
    sourceNote: z.ZodNullable<z.ZodString>;
    lastVerified: z.ZodNullable<z.ZodISODate>;
    promptTemplate: z.ZodNullable<z.ZodString>;
    params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    enabledByDefault: z.ZodBoolean;
}, z.core.$strip>;
export declare const CreateRuleSchema: z.ZodObject<{
    title: z.ZodString;
    description: z.ZodString;
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
    severity: z.ZodEnum<{
        critical: "critical";
        major: "major";
        minor: "minor";
        info: "info";
    }>;
    checkType: z.ZodEnum<{
        deterministic: "deterministic";
        llm: "llm";
    }>;
    sourceCitation: z.ZodString;
    sourceUrl: z.ZodNullable<z.ZodURL>;
    sourceNote: z.ZodNullable<z.ZodString>;
    lastVerified: z.ZodNullable<z.ZodISODate>;
    promptTemplate: z.ZodNullable<z.ZodString>;
    params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    enabledByDefault: z.ZodBoolean;
    ruleId: z.ZodString;
}, z.core.$strip>;
export type CreateRule = z.infer<typeof CreateRuleSchema>;
export declare const NewRuleVersionSchema: z.ZodObject<{
    title: z.ZodString;
    description: z.ZodString;
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
    severity: z.ZodEnum<{
        critical: "critical";
        major: "major";
        minor: "minor";
        info: "info";
    }>;
    checkType: z.ZodEnum<{
        deterministic: "deterministic";
        llm: "llm";
    }>;
    sourceCitation: z.ZodString;
    sourceUrl: z.ZodNullable<z.ZodURL>;
    sourceNote: z.ZodNullable<z.ZodString>;
    lastVerified: z.ZodNullable<z.ZodISODate>;
    promptTemplate: z.ZodNullable<z.ZodString>;
    params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    enabledByDefault: z.ZodBoolean;
    expectedLatestVersion: z.ZodNumber;
}, z.core.$strip>;
export type NewRuleVersion = z.infer<typeof NewRuleVersionSchema>;
export type RuleFields = z.infer<typeof RuleFieldsSchema>;
export declare const RuleSummarySchema: z.ZodObject<{
    ruleId: z.ZodString;
    latest: z.ZodObject<{
        ruleId: z.ZodString;
        version: z.ZodNumber;
        title: z.ZodString;
        description: z.ZodString;
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
        severity: z.ZodEnum<{
            critical: "critical";
            major: "major";
            minor: "minor";
            info: "info";
        }>;
        checkType: z.ZodEnum<{
            deterministic: "deterministic";
            llm: "llm";
        }>;
        sourceCitation: z.ZodString;
        sourceUrl: z.ZodNullable<z.ZodString>;
        sourceNote: z.ZodNullable<z.ZodString>;
        lastVerified: z.ZodNullable<z.ZodString>;
        promptTemplate: z.ZodNullable<z.ZodString>;
        params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        enabledByDefault: z.ZodBoolean;
        origin: z.ZodString;
        contentHash: z.ZodString;
        createdAt: z.ZodString;
        createdBy: z.ZodString;
    }, z.core.$strip>;
    versionCount: z.ZodNumber;
    retiredAt: z.ZodNullable<z.ZodString>;
    scans: z.ZodNumber;
    findings: z.ZodNumber;
}, z.core.$strip>;
export type RuleSummary = z.infer<typeof RuleSummarySchema>;
export declare const RuleFieldChangeSchema: z.ZodObject<{
    field: z.ZodString;
    from: z.ZodUnknown;
    to: z.ZodUnknown;
}, z.core.$strip>;
export declare const RuleDetailSchema: z.ZodObject<{
    ruleId: z.ZodString;
    createdAt: z.ZodString;
    retiredAt: z.ZodNullable<z.ZodString>;
    versions: z.ZodArray<z.ZodObject<{
        ruleId: z.ZodString;
        version: z.ZodNumber;
        title: z.ZodString;
        description: z.ZodString;
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
        severity: z.ZodEnum<{
            critical: "critical";
            major: "major";
            minor: "minor";
            info: "info";
        }>;
        checkType: z.ZodEnum<{
            deterministic: "deterministic";
            llm: "llm";
        }>;
        sourceCitation: z.ZodString;
        sourceUrl: z.ZodNullable<z.ZodString>;
        sourceNote: z.ZodNullable<z.ZodString>;
        lastVerified: z.ZodNullable<z.ZodString>;
        promptTemplate: z.ZodNullable<z.ZodString>;
        params: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        enabledByDefault: z.ZodBoolean;
        origin: z.ZodString;
        contentHash: z.ZodString;
        createdAt: z.ZodString;
        createdBy: z.ZodString;
        changes: z.ZodArray<z.ZodObject<{
            field: z.ZodString;
            from: z.ZodUnknown;
            to: z.ZodUnknown;
        }, z.core.$strip>>;
        scans: z.ZodNumber;
        findings: z.ZodNumber;
    }, z.core.$strip>>;
    usage: z.ZodArray<z.ZodObject<{
        scanId: z.ZodString;
        startUrl: z.ZodString;
        createdAt: z.ZodString;
        version: z.ZodNumber;
        enabled: z.ZodBoolean;
        findings: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type RuleDetail = z.infer<typeof RuleDetailSchema>;
/** A rule as frozen in a scan's snapshot. */
export declare const ScanRuleSchema: z.ZodObject<{
    ruleId: z.ZodString;
    version: z.ZodNumber;
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
    severity: z.ZodEnum<{
        critical: "critical";
        major: "major";
        minor: "minor";
        info: "info";
    }>;
    checkType: z.ZodEnum<{
        deterministic: "deterministic";
        llm: "llm";
    }>;
    enabled: z.ZodBoolean;
    findings: z.ZodNumber;
}, z.core.$strip>;
export type ScanRule = z.infer<typeof ScanRuleSchema>;
export {};
