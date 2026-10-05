import { createHash } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAudit } from '../audit/log.js';
import { precedentClassifications, precedents } from '../db/schema.js';
import { describeError } from '../llm/analyze.js';
import { estimateCostUsd } from '../llm/pricing.js';
import { loadPrompts } from '../llm/prompt.js';
import { latestRuleVersions } from '../rules/repository.js';
/** Bump with a new prompts/precedent-classification/<version>/ directory. */
export const CLASSIFY_PROMPT_VERSION = 'v1';
/** The category value the model uses for "no matching rule". */
export const NO_MATCH = 'none';
const MAX_TOPIC_LENGTH = 60;
/** Current (non-retired) rules of the loaded pack: what comments are classified against. */
export function classifierRules(db) {
    return latestRuleVersions(db).map((r) => ({
        ruleId: r.ruleId,
        version: r.version,
        category: r.category,
        title: r.title,
        description: r.description,
    }));
}
/** Changes whenever a rule is added, retired, re-versioned or moved to another category. */
export function rulePackHash(rules) {
    return createHash('sha256')
        .update(rules
        .map((r) => `${r.ruleId}@${r.version}:${r.category}`)
        .sort()
        .join('\n'))
        .digest('hex')
        .slice(0, 12);
}
/** Categories with their rules; identical for every batch of a run, so it is sent as a cached block. */
export function renderCategories(rules) {
    const categories = [...new Set(rules.map((r) => r.category))].sort();
    const sections = categories.map((category) => [
        `<category id="${category}">`,
        ...rules
            .filter((r) => r.category === category)
            .map((r) => `- ${r.ruleId}: ${r.title}. ${firstSentence(r.description)}`),
        '</category>',
    ].join('\n'));
    return `Categories and review rules (use category "${NO_MATCH}" when none fits):\n\n${sections.join('\n\n')}`;
}
const firstSentence = (s) => {
    const t = s.trim().replace(/\s+/g, ' ');
    return /^.*?[.!?](?=\s|$)/.exec(t)?.[0] ?? t;
};
const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function renderComments(items) {
    return items
        .map((c) => `<comment id="${c.key}" function="${escapeXml(c.reviewerFunction ?? 'unknown').replace(/"/g, '&quot;')}">${escapeXml(c.text)}</comment>`)
        .join('\n');
}
function renderUser(template, comments, feedback) {
    const values = {
        comments,
        feedback: feedback
            ? `\nA previous answer was rejected for these reasons; classify these comments again:\n${feedback}\n`
            : '',
    };
    return template.replace(/\{\{(\w+)\}\}/g, (m, key) => values[key] ?? m).trim();
}
/**
 * Structured-output schema. Enums are only hints to the model (see the LLM notes in CLAUDE.md), so
 * validateClassifications re-checks every value.
 */
export function classificationSchema(categories, ruleIds) {
    return z.object({
        classifications: z.array(z.object({
            id: z.string(),
            category: z.enum([NO_MATCH, ...categories]),
            ruleId: ruleIds.length ? z.enum(ruleIds).nullable() : z.null(),
            confidence: z.number(),
            topic: z.string(),
        })),
    });
}
const LooseOutput = z.object({ classifications: z.array(z.unknown()) });
const LooseItem = z.object({
    id: z.string(),
    category: z.string(),
    ruleId: z.string().nullable().optional(),
    confidence: z.number(),
    topic: z.string().optional(),
});
/**
 * Checks model output against the batch: every id answered once, known categories, confidence
 * within 0..1. A rule id that is unknown or outside the chosen category is dropped (the category
 * still stands). Returns the valid answers and the problems to send back on the retry.
 */
export function validateClassifications(output, ctx) {
    const valid = new Map();
    const problems = [];
    const shape = LooseOutput.safeParse(output);
    if (!shape.success) {
        return { valid, problems: ['The answer must be an object with a "classifications" array.'] };
    }
    const ids = new Set(ctx.ids);
    const categories = new Set(ctx.rules.map((r) => r.category));
    const ruleCategory = new Map(ctx.rules.map((r) => [r.ruleId, r.category]));
    shape.data.classifications.forEach((raw, i) => {
        const item = LooseItem.safeParse(raw);
        if (!item.success) {
            problems.push(`Item ${i + 1} is missing id, category or confidence, or has the wrong types.`);
            return;
        }
        const { id, category, confidence } = item.data;
        if (!ids.has(id))
            return void problems.push(`Unknown comment id "${id}".`);
        if (valid.has(id))
            return void problems.push(`Comment ${id} was classified more than once.`);
        if (category !== NO_MATCH && !categories.has(category)) {
            return void problems.push(`Comment ${id}: unknown category "${category}".`);
        }
        if (!(confidence >= 0 && confidence <= 1)) {
            return void problems.push(`Comment ${id}: confidence must be between 0 and 1.`);
        }
        const noMatchingRule = category === NO_MATCH;
        const ruleId = !noMatchingRule && item.data.ruleId && ruleCategory.get(item.data.ruleId) === category
            ? item.data.ruleId
            : null;
        const topic = (item.data.topic ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TOPIC_LENGTH);
        valid.set(id, {
            category: noMatchingRule ? null : category,
            ruleId,
            confidence,
            noMatchingRule,
            topic: topic || (noMatchingRule ? 'other' : category),
        });
    });
    const missing = ctx.ids.filter((id) => !valid.has(id));
    if (missing.length && !problems.length) {
        problems.push(`No classification was returned for: ${missing.join(', ')}.`);
    }
    else if (missing.length) {
        problems.push(`Still needed: a valid classification for ${missing.join(', ')}.`);
    }
    return { valid, problems };
}
/** Rough tokens per batch for the spend estimate: cached rules block, comments, and the answer. */
const EST_INPUT_TOKENS_PER_BATCH = 2500;
const EST_INPUT_TOKENS_PER_COMMENT = 80;
const EST_OUTPUT_TOKENS_PER_COMMENT = 120;
/** USD estimate for classifying `comments` comments, or null for unpriced models (e.g. the mock). */
export function estimateClassificationCost(model, comments, batchSize = DEFAULT_BATCH_SIZE) {
    const batches = Math.ceil(comments / batchSize);
    return estimateCostUsd(model, {
        inputTokens: batches * EST_INPUT_TOKENS_PER_BATCH + comments * EST_INPUT_TOKENS_PER_COMMENT,
        outputTokens: comments * EST_OUTPUT_TOKENS_PER_COMMENT,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
    });
}
const DEFAULT_BATCH_SIZE = 20;
/** The precedents that need (re-)classifying for this provider, prompt and rule pack. */
export function pendingPrecedents(db, key, force = false) {
    const rows = db
        .select({
        id: precedents.id,
        text: precedents.commentText,
        reviewerFunction: precedents.reviewerFunction,
        c: precedentClassifications,
    })
        .from(precedents)
        .leftJoin(precedentClassifications, eq(precedentClassifications.precedentId, precedents.id))
        .orderBy(asc(precedents.commentedAt), asc(precedents.id))
        .all();
    const current = (c) => c?.status === 'ok' &&
        c.provider === key.provider &&
        c.model === key.model &&
        c.promptVersion === key.promptVersion &&
        c.rulePackHash === key.rulePackHash;
    return {
        total: rows.length,
        pending: rows
            .filter((r) => force || !current(r.c))
            .map((r) => ({ id: r.id, text: r.text, reviewerFunction: r.reviewerFunction })),
    };
}
/**
 * Classifies historic comments against the current rule pack's categories, in batches: one call per
 * batch, validated output, and one retry (for the comments still unanswered) with feedback. Comments
 * that still have no valid answer, or whose batch failed, are stored as 'failed' with no category.
 */
export async function classifyPrecedents(db, opts) {
    const rules = classifierRules(db);
    const hash = rulePackHash(rules);
    const prompts = await loadPrompts(CLASSIFY_PROMPT_VERSION, 'precedent-classification');
    const { provider } = opts;
    const { total, pending } = pendingPrecedents(db, {
        provider: provider.name,
        model: provider.model,
        promptVersion: prompts.version,
        rulePackHash: hash,
    }, opts.force);
    const result = {
        total,
        upToDate: total - pending.length,
        classified: 0,
        noMatchingRule: 0,
        failed: 0,
        requests: 0,
        costUsd: 0,
        promptVersion: prompts.version,
        rulePackHash: hash,
    };
    if (!pending.length)
        return result;
    if (!rules.length)
        throw new Error('No rules are loaded; load a rule pack before classifying.');
    const size = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    const batches = [];
    for (let i = 0; i < pending.length; i += size)
        batches.push(pending.slice(i, i + size));
    const ctx = {
        db,
        opts,
        rules,
        hash,
        prompts,
        rulesBlock: renderCategories(rules),
        categories: [...new Set(rules.map((r) => r.category))].sort(),
    };
    let next = 0;
    const worker = async () => {
        while (next < batches.length) {
            opts.signal?.throwIfAborted();
            const out = await classifyBatch(ctx, batches[next++]);
            result.classified += out.classified;
            result.noMatchingRule += out.noMatchingRule;
            result.failed += out.failed;
            result.requests += out.requests;
            result.costUsd += out.costUsd;
        }
    };
    await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 2, batches.length) }, worker));
    result.costUsd = Math.round(result.costUsd * 1e6) / 1e6;
    return result;
}
async function classifyBatch(ctx, batch) {
    const { provider } = ctx.opts;
    const keyed = batch.map((p, i) => ({ ...p, key: `c${i + 1}` }));
    const answers = new Map();
    let requests = 0;
    let costUsd = 0;
    let error = null;
    let feedback;
    try {
        for (let attempt = 1; attempt <= 2; attempt++) {
            const todo = keyed.filter((c) => !answers.has(c.key));
            if (!todo.length)
                break;
            const request = {
                task: 'precedent-classification',
                system: ctx.prompts.system,
                rulesBlock: ctx.rulesBlock,
                userText: renderUser(ctx.prompts.userTemplate, renderComments(todo), feedback),
                image: null,
                ruleIds: ctx.rules.map((r) => r.ruleId),
                outputSchema: classificationSchema(ctx.categories, ctx.rules.map((r) => r.ruleId)),
            };
            const response = await provider.complete(request, ctx.opts.signal);
            requests++;
            costUsd += estimateCostUsd(response.model, response.usage) ?? 0;
            if (response.stopReason === 'refusal') {
                error = 'The model declined to classify this batch (refusal).';
                break;
            }
            const { valid, problems } = validateClassifications(response.output, {
                ids: todo.map((c) => c.key),
                rules: ctx.rules,
            });
            for (const [k, v] of valid)
                answers.set(k, v);
            if (!problems.length)
                break;
            feedback = problems.join('\n');
        }
        if (!error && answers.size < keyed.length)
            error = 'No valid classification after one retry.';
    }
    catch (err) {
        error = describeError(err);
    }
    const now = new Date().toISOString();
    const rows = keyed.map((c) => {
        const a = answers.get(c.key);
        return {
            precedentId: c.id,
            status: a ? 'ok' : 'failed',
            category: a?.category ?? null,
            ruleId: a?.ruleId ?? null,
            confidence: a?.confidence ?? null,
            noMatchingRule: a?.noMatchingRule ?? false,
            topic: a?.topic ?? null,
            provider: provider.name,
            model: provider.model,
            promptVersion: ctx.prompts.version,
            rulePackHash: ctx.hash,
            error: a ? null : error,
            classifiedBy: ctx.opts.actor,
            classifiedAt: now,
        };
    });
    saveClassifications(ctx.db, rows, ctx.opts.actor, now);
    const ok = rows.filter((r) => r.status === 'ok');
    return {
        classified: ok.length,
        noMatchingRule: ok.filter((r) => r.noMatchingRule).length,
        failed: rows.length - ok.length,
        requests,
        costUsd,
    };
}
/** Upserts the batch and audits each comment whose outcome changed, in one transaction. */
function saveClassifications(db, rows, actor, at) {
    const classifier = (r) => `${r.provider}:${r.model}#${r.promptVersion}#${r.rulePackHash}`;
    db.transaction((tx) => {
        const audits = [];
        for (const row of rows) {
            const before = tx
                .select()
                .from(precedentClassifications)
                .where(eq(precedentClassifications.precedentId, row.precedentId))
                .get();
            const { precedentId, ...set } = row;
            tx.insert(precedentClassifications)
                .values(row)
                .onConflictDoUpdate({ target: precedentClassifications.precedentId, set })
                .run();
            const changes = {};
            const compare = {
                status: [before?.status ?? null, row.status],
                category: [before?.category ?? null, row.category ?? null],
                ruleId: [before?.ruleId ?? null, row.ruleId ?? null],
                noMatchingRule: [before?.noMatchingRule ?? null, row.noMatchingRule],
                classifier: [before ? classifier(before) : null, classifier(row)],
            };
            for (const [k, [a, b]] of Object.entries(compare))
                if (a !== b)
                    changes[k] = [a, b];
            if (Object.keys(changes).length) {
                audits.push({
                    entityType: 'precedent',
                    entityId: precedentId,
                    action: 'classified',
                    changes,
                    actor,
                    at,
                });
            }
        }
        appendAudit(tx, audits);
    });
}
//# sourceMappingURL=classify.js.map