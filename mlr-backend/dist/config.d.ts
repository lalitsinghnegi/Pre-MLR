import { z } from 'zod';
declare const EnvSchema: z.ZodObject<{
    PORT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    HOST: z.ZodDefault<z.ZodString>;
    DATABASE_URL: z.ZodDefault<z.ZodString>;
    DATA_DIR: z.ZodDefault<z.ZodString>;
    CORS_ORIGIN: z.ZodDefault<z.ZodString>;
    RULE_PACK_DIR: z.ZodDefault<z.ZodString>;
    SCAN_PRIVATE_ALLOWLIST: z.ZodPipe<z.ZodDefault<z.ZodString>, z.ZodTransform<string[], string>>;
    MAX_QUEUED_SCANS: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    MAX_ACTIVE_SCANS_PER_USER: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    SCAN_TIMEOUT_MINUTES: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    LINK_CHECK_MAX: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    LLM_PROVIDER: z.ZodDefault<z.ZodEnum<{
        none: "none";
        anthropic: "anthropic";
        mock: "mock";
    }>>;
    LLM_MODEL: z.ZodDefault<z.ZodString>;
    LLM_EFFORT: z.ZodDefault<z.ZodEnum<{
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        max: "max";
    }>>;
    LLM_MAX_TOKENS: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    LLM_CONCURRENCY: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    LLM_FALLBACK: z.ZodPipe<z.ZodDefault<z.ZodEnum<{
        true: "true";
        false: "false";
    }>>, z.ZodTransform<boolean, "true" | "false">>;
    PRECEDENT_PSEUDONYM_KEY: z.ZodDefault<z.ZodString>;
    EMBEDDINGS: z.ZodDefault<z.ZodEnum<{
        none: "none";
        local: "local";
        hash: "hash";
    }>>;
    EMBEDDING_MODEL: z.ZodDefault<z.ZodString>;
    PRECEDENT_MAX_AGE_MONTHS: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    SESSION_TTL_HOURS: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    COOKIE_SECURE: z.ZodPipe<z.ZodDefault<z.ZodEnum<{
        true: "true";
        false: "false";
    }>>, z.ZodTransform<boolean, "true" | "false">>;
    PDF_PAGE_SIZE: z.ZodDefault<z.ZodEnum<{
        Letter: "Letter";
        A4: "A4";
    }>>;
    LOG_LEVEL: z.ZodDefault<z.ZodEnum<{
        error: "error";
        info: "info";
        fatal: "fatal";
        warn: "warn";
        debug: "debug";
        trace: "trace";
        silent: "silent";
    }>>;
}, z.core.$strip>;
export type Config = z.infer<typeof EnvSchema>;
export declare function loadConfig(env?: NodeJS.ProcessEnv): Config;
export {};
