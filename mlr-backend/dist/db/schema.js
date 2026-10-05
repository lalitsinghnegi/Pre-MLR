import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex, } from 'drizzle-orm/sqlite-core';
// Timestamps are ISO-8601 text and JSON is stored as text, so the schema ports to Postgres directly.
export const scans = sqliteTable('scans', {
    id: text('id').primaryKey(),
    startUrl: text('start_url').notNull(),
    maxPages: integer('max_pages').notNull(),
    maxDepth: integer('max_depth').notNull(),
    status: text('status').$type().notNull(),
    error: text('error'),
    pagesCrawled: integer('pages_crawled').notNull().default(0),
    /** What a running scan is doing: crawling, checking (rules engine) or analyzing (LLM). */
    phase: text('phase').$type(),
    /** Brand/established names for rules that need them; null skips those rules. */
    product: text('product', { mode: 'json' }).$type(),
    /** Who requested the scan (null for scans from before sign-in existed). */
    createdBy: text('created_by'),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
});
export const pages = sqliteTable('pages', {
    id: text('id').primaryKey(),
    scanId: text('scan_id')
        .notNull()
        .references(() => scans.id, { onDelete: 'cascade' }),
    /** Order in which the crawler visited the page (0 = start URL). */
    crawlIndex: integer('crawl_index').notNull(),
    url: text('url').notNull(),
    depth: integer('depth').notNull(),
    /** First page that linked here; drives the site-map hierarchy. */
    parentPageId: text('parent_page_id').references(() => pages.id),
    title: text('title'),
    text: text('text'),
    links: text('links', { mode: 'json' })
        .$type()
        .notNull()
        .default(sql `'[]'`),
    httpStatus: integer('http_status'),
    /** Text blocks, styles and images from the desktop view; null for pages crawled before Prompt 6. */
    facts: text('facts', { mode: 'json' }).$type(),
    /** Paths relative to DATA_DIR. */
    desktopScreenshotPath: text('desktop_screenshot_path'),
    mobileScreenshotPath: text('mobile_screenshot_path'),
    error: text('error'),
    crawledAt: text('crawled_at').notNull(),
}, (t) => [
    uniqueIndex('pages_scan_url_idx').on(t.scanId, t.url),
    index('pages_scan_crawl_index_idx').on(t.scanId, t.crawlIndex),
]);
/** Result of checking one link URL during a scan (crawled pages reuse their own status). */
export const linkChecks = sqliteTable('link_checks', {
    scanId: text('scan_id')
        .notNull()
        .references(() => scans.id, { onDelete: 'cascade' }),
    /** Normalized URL (see crawler/url.ts). */
    url: text('url').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    httpStatus: integer('http_status'),
    error: text('error'),
    finalUrl: text('final_url'),
    contentType: text('content_type'),
    /** The site refused automated checks even from a browser: neither confirmed nor broken. */
    unverified: integer('unverified', { mode: 'boolean' }).notNull().default(false),
    /** 'http', or 'browser' when re-checked in the crawler's browser after a refusal. */
    checkedVia: text('checked_via').$type().notNull().default('http'),
    checkedAt: text('checked_at').notNull(),
}, (t) => [primaryKey({ columns: [t.scanId, t.url] })]);
/**
 * One LLM analysis of one page. Rows with status "ok" double as the response cache: a later page
 * with the same cache_key (model, settings, prompt version, rule versions, page content) reuses it.
 */
export const llmAnalyses = sqliteTable('llm_analyses', {
    id: text('id').primaryKey(),
    scanId: text('scan_id')
        .notNull()
        .references(() => scans.id, { onDelete: 'cascade' }),
    pageId: text('page_id')
        .notNull()
        .references(() => pages.id, { onDelete: 'cascade' }),
    cacheKey: text('cache_key').notNull(),
    provider: text('provider').notNull(),
    /** Model requested; servedModel differs when a refusal fallback answered. */
    model: text('model').notNull(),
    servedModel: text('served_model'),
    promptVersion: text('prompt_version').notNull(),
    status: text('status').$type().notNull(),
    /** Reused from an earlier analysis with the same cache key (no API call). */
    cached: integer('cached', { mode: 'boolean' }).notNull(),
    attempts: integer('attempts').notNull(),
    pageTip: text('page_tip'),
    /** The validated model output (findings + tip). */
    output: text('output', { mode: 'json' }).$type(),
    /** Problems found in the output (dropped findings, retry reasons). */
    problems: text('problems', { mode: 'json' })
        .$type()
        .notNull()
        .default(sql `'[]'`),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    costUsd: real('cost_usd'),
    latencyMs: integer('latency_ms').notNull().default(0),
    error: text('error'),
    createdAt: text('created_at').notNull(),
}, (t) => [
    index('llm_analyses_cache_idx').on(t.cacheKey, t.status),
    index('llm_analyses_page_idx').on(t.pageId),
]);
/** One run of the precedent importer (a file of historic MLR comments). */
export const precedentImports = sqliteTable('precedent_imports', {
    id: text('id').primaryKey(),
    fileName: text('file_name').notNull(),
    fileSha256: text('file_sha256').notNull(),
    mapping: text('mapping').notNull(),
    site: text('site'),
    rowsTotal: integer('rows_total').notNull(),
    rowsImported: integer('rows_imported').notNull(),
    rowsSkipped: integer('rows_skipped').notNull(),
    rowsDuplicate: integer('rows_duplicate').notNull(),
    /** [{ row, errors[] }] for skipped rows. */
    rowErrors: text('row_errors', { mode: 'json' })
        .$type()
        .notNull(),
    importedBy: text('imported_by').notNull(),
    createdAt: text('created_at').notNull(),
});
/**
 * A historic MLR review comment. Reviewer names are never stored: only a keyed pseudonym.
 * Emails and phone numbers in the text are redacted on import.
 */
export const precedents = sqliteTable('precedents', {
    id: text('id').primaryKey(),
    importId: text('import_id')
        .notNull()
        .references(() => precedentImports.id, { onDelete: 'cascade' }),
    sourceCommentId: text('source_comment_id'),
    /** Site the comment relates to (host or URL), from the file or the import's --site. */
    site: text('site'),
    brand: text('brand').notNull(),
    country: text('country'),
    proofName: text('proof_name'),
    proofVersion: text('proof_version'),
    pageRef: text('page_ref'),
    commentText: text('comment_text').notNull(),
    reviewerPseudonym: text('reviewer_pseudonym'),
    reviewerFunction: text('reviewer_function'),
    status: text('status'),
    /** YYYY-MM-DD */
    commentedAt: text('commented_at').notNull(),
    /** Hash of site, brand, date, proof, page, text and reviewer; re-imports skip existing ones. */
    fingerprint: text('fingerprint').notNull(),
    createdAt: text('created_at').notNull(),
}, (t) => [
    uniqueIndex('precedents_fingerprint_idx').on(t.fingerprint),
    index('precedents_brand_date_idx').on(t.brand, t.commentedAt),
    index('precedents_site_idx').on(t.site),
]);
/**
 * The current LLM classification of a precedent comment against the rule pack's categories (one
 * row per precedent; re-classifying replaces it, and the audit log keeps the history).
 */
export const precedentClassifications = sqliteTable('precedent_classifications', {
    precedentId: text('precedent_id')
        .primaryKey()
        .references(() => precedents.id, { onDelete: 'cascade' }),
    /** 'ok', or 'failed' when no valid answer came back after the retry (category stays null). */
    status: text('status', { enum: ['ok', 'failed'] }).notNull(),
    /** A rule category, or null when no rule matches (or the classification failed). */
    category: text('category'),
    /** The single rule the comment most clearly concerns, if any. */
    ruleId: text('rule_id'),
    confidence: real('confidence'),
    noMatchingRule: integer('no_matching_rule', { mode: 'boolean' }).notNull(),
    /** Short issue label from the model; used to group recurring no-match comments. */
    topic: text('topic'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    /** Hash of the rule ids, versions and categories the comment was classified against. */
    rulePackHash: text('rule_pack_hash').notNull(),
    error: text('error'),
    classifiedBy: text('classified_by').notNull(),
    classifiedAt: text('classified_at').notNull(),
}, (t) => [index('precedent_classifications_category_idx').on(t.category)]);
/** Stable rule identity. Content lives in immutable rule_versions. */
export const rules = sqliteTable('rules', {
    id: text('id').primaryKey(),
    createdAt: text('created_at').notNull(),
    retiredAt: text('retired_at'),
});
/** Immutable: a changed rule is a new version. */
export const ruleVersions = sqliteTable('rule_versions', {
    ruleId: text('rule_id')
        .notNull()
        .references(() => rules.id),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    category: text('category').$type().notNull(),
    severity: text('severity').$type().notNull(),
    checkType: text('check_type').$type().notNull(),
    sourceCitation: text('source_citation').notNull(),
    sourceUrl: text('source_url'),
    sourceNote: text('source_note'),
    lastVerified: text('last_verified'),
    promptTemplate: text('prompt_template'),
    /** Settings for deterministic checks (e.g. phrase lists), so they stay data rather than code. */
    params: text('params', { mode: 'json' })
        .$type()
        .notNull()
        .default(sql `'{}'`),
    enabledByDefault: integer('enabled_by_default', { mode: 'boolean' }).notNull(),
    /** Where this version came from, e.g. "pack:public@1.0" or "admin". */
    origin: text('origin').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by').notNull(),
}, (t) => [primaryKey({ columns: [t.ruleId, t.version] })]);
/** The rule versions a scan ran with, frozen when the scan starts. */
export const scanRules = sqliteTable('scan_rules', {
    scanId: text('scan_id')
        .notNull()
        .references(() => scans.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
}, (t) => [
    primaryKey({ columns: [t.scanId, t.ruleId] }),
    foreignKey({
        columns: [t.ruleId, t.ruleVersion],
        foreignColumns: [ruleVersions.ruleId, ruleVersions.version],
    }),
]);
export const findings = sqliteTable('findings', {
    id: text('id').primaryKey(),
    scanId: text('scan_id')
        .notNull()
        .references(() => scans.id, { onDelete: 'cascade' }),
    /** Null for site-wide findings. */
    pageId: text('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    detectedBy: text('detected_by').$type().notNull(),
    severity: text('severity').$type().notNull(),
    message: text('message').notNull(),
    evidenceText: text('evidence_text'),
    evidenceLocation: text('evidence_location', { mode: 'json' }).$type(),
    /** Relative to DATA_DIR. */
    evidenceCropPath: text('evidence_crop_path'),
    /** As proposed by the engine/LLM; never modified. */
    suggestedFix: text('suggested_fix'),
    editedFix: text('edited_fix'),
    confidence: real('confidence'),
    status: text('status').$type().notNull(),
    authorComment: text('author_comment'),
    /** Incremented on every change; used for optimistic concurrency. */
    revision: integer('revision').notNull(),
    /** Hash of rule + page + evidence; de-duplicates findings within a scan. */
    fingerprint: text('fingerprint').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    updatedBy: text('updated_by').notNull(),
}, (t) => [
    foreignKey({
        columns: [t.ruleId, t.ruleVersion],
        foreignColumns: [ruleVersions.ruleId, ruleVersions.version],
    }),
    uniqueIndex('findings_scan_fingerprint_idx').on(t.scanId, t.fingerprint),
    index('findings_scan_status_idx').on(t.scanId, t.status),
    index('findings_page_idx').on(t.pageId),
]);
/** Sentence embeddings of precedent comments, one per embedder (model) so models can change. */
export const precedentEmbeddings = sqliteTable('precedent_embeddings', {
    precedentId: text('precedent_id')
        .notNull()
        .references(() => precedents.id, { onDelete: 'cascade' }),
    /** e.g. "local:Xenova/all-MiniLM-L6-v2#q8" or "hash-v1". */
    embedder: text('embedder').notNull(),
    /** Unit-length vector. JSON keeps it portable (Postgres can move to pgvector later). */
    vector: text('vector', { mode: 'json' }).$type().notNull(),
    createdAt: text('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.precedentId, t.embedder] })]);
/** Precedent comments attached to a finding as advisory evidence (top matches, ranked). */
export const findingPrecedents = sqliteTable('finding_precedents', {
    findingId: text('finding_id')
        .notNull()
        .references(() => findings.id, { onDelete: 'cascade' }),
    precedentId: text('precedent_id')
        .notNull()
        .references(() => precedents.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull(),
    similarity: real('similarity').notNull(),
    embedder: text('embedder').notNull(),
    createdAt: text('created_at').notNull(),
}, (t) => [
    primaryKey({ columns: [t.findingId, t.precedentId] }),
    index('finding_precedents_precedent_idx').on(t.precedentId),
]);
/**
 * A proposal for a new rule, promoted by a rule admin from historic comments. Not a rule: rule
 * owners review it (rule management arrives in Prompt 15). Source ids are kept even if the
 * precedents are later deleted, so the proposal stays traceable.
 */
export const ruleCandidates = sqliteTable('rule_candidates', {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    status: text('status', { enum: ['proposed'] }).notNull(),
    precedentIds: text('precedent_ids', { mode: 'json' }).$type().notNull(),
    findingId: text('finding_id'),
    scanId: text('scan_id'),
    note: text('note'),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
});
/**
 * Append-only change history. UPDATE and DELETE are blocked by triggers (see the
 * audit_log_append_only migration); no foreign keys, so history outlives deleted scans and findings.
 */
export const auditLog = sqliteTable('audit_log', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    scanId: text('scan_id'),
    action: text('action').notNull(),
    /** { field: [old, new] } */
    changes: text('changes', { mode: 'json' })
        .$type()
        .notNull(),
    actor: text('actor').notNull(),
    at: text('at').notNull(),
}, (t) => [
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
    index('audit_log_scan_idx').on(t.scanId),
]);
/** A person who can sign in. Passwords are stored only as scrypt hashes. */
export const users = sqliteTable('users', {
    id: text('id').primaryKey(),
    /** Display name, used as the actor in the audit log. */
    name: text('name').notNull(),
    /** Lower-cased name: sign-in is case-insensitive and names are unique ignoring case. */
    nameKey: text('name_key').notNull(),
    role: text('role').$type().notNull(),
    passwordHash: text('password_hash').notNull(),
    disabledAt: text('disabled_at'),
    createdAt: text('created_at').notNull(),
    lastLoginAt: text('last_login_at'),
}, (t) => [uniqueIndex('users_name_key_idx').on(t.nameKey)]);
/** A signed-in browser. Only a hash of the cookie's token is stored. */
export const sessions = sqliteTable('sessions', {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);
//# sourceMappingURL=schema.js.map