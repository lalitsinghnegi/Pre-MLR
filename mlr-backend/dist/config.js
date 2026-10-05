import { z } from 'zod';
import { DEFAULT_RULE_PACK_DIR } from './rules/pack.js';
const EnvSchema = z.object({
    PORT: z.coerce.number().int().positive().default(8000),
    HOST: z.string().default('127.0.0.1'),
    DATABASE_URL: z.string().default('./data/pre-mlr.db'),
    DATA_DIR: z.string().default('./data'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    /** Rule pack loaded at startup; empty string disables loading. */
    RULE_PACK_DIR: z.string().default(DEFAULT_RULE_PACK_DIR),
    /**
     * Hosts that scans may reach even though they are on a private network, as host or host:port,
     * comma-separated (e.g. the local Examplin site: localhost:4100,127.0.0.1:4100). Everything else
     * private (loopback, RFC 1918, link-local/cloud metadata, ...) is always blocked.
     */
    SCAN_PRIVATE_ALLOWLIST: z
        .string()
        .default('')
        .transform((s) => s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)),
    /** Scans waiting or running at once, across all users; more are refused (429). */
    MAX_QUEUED_SCANS: z.coerce.number().int().min(1).max(100).default(5),
    /** Scans one user may have waiting or running at once. */
    MAX_ACTIVE_SCANS_PER_USER: z.coerce.number().int().min(1).max(50).default(2),
    /** A scan running longer than this is stopped and marked failed. */
    SCAN_TIMEOUT_MINUTES: z.coerce
        .number()
        .int()
        .min(1)
        .max(24 * 60)
        .default(30),
    /** Most link URLs requested per scan. */
    LINK_CHECK_MAX: z.coerce.number().int().min(0).default(500),
    /** LLM analysis: off unless set. "anthropic" sends page text and screenshots to the Anthropic API. */
    LLM_PROVIDER: z.enum(['none', 'anthropic', 'mock']).default('none'),
    LLM_MODEL: z.string().min(1).default('claude-opus-5-5'),
    LLM_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
    LLM_MAX_TOKENS: z.coerce.number().int().min(1024).max(64000).default(16000),
    /** Pages analysed at once (also bounds request rate). */
    LLM_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    /** Server-side refusal fallback (Claude API only). */
    LLM_FALLBACK: z
        .enum(['true', 'false'])
        .default('true')
        .transform((v) => v === 'true'),
    /** Secret for pseudonymising reviewer names in imported precedent comments (keep out of git). */
    PRECEDENT_PSEUDONYM_KEY: z.string().default(''),
    /**
     * Embeddings for similar-precedent retrieval: "local" runs a small sentence model in-process
     * (downloaded once into DATA_DIR/models; text never leaves the machine), "hash" is a lexical
     * fallback with no download, "none" turns retrieval off.
     */
    EMBEDDINGS: z.enum(['local', 'hash', 'none']).default('local'),
    EMBEDDING_MODEL: z.string().min(1).default('Xenova/all-MiniLM-L6-v2'),
    /** Only precedents commented within this many months are attached to findings. */
    PRECEDENT_MAX_AGE_MONTHS: z.coerce.number().int().min(1).max(240).default(36),
    /** How long a sign-in lasts. */
    SESSION_TTL_HOURS: z.coerce
        .number()
        .int()
        .min(1)
        .max(24 * 30)
        .default(12),
    /** Send the session cookie over HTTPS only. Set true anywhere but local http development. */
    COOKIE_SECURE: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
    PDF_PAGE_SIZE: z.enum(['Letter', 'A4']).default('Letter'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});
export function loadConfig(env = process.env) {
    const parsed = EnvSchema.safeParse(env);
    if (!parsed.success) {
        throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
    }
    return parsed.data;
}
//# sourceMappingURL=config.js.map