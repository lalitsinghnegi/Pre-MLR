import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { CheckTypeSchema, RuleCategorySchema, RuleVersionInputSchema, SeveritySchema, } from '@pre-mlr/shared';
import { getCheck } from '../checks/registry.js';
import { ValidationError } from '../errors.js';
import { createRuleVersion, latestVersionOf, ruleContentHash } from './repository.js';
/** rule-packs/public at the repo root, resolved the same way from src/ (tsx) and dist/ (node). */
export const DEFAULT_RULE_PACK_DIR = fileURLToPath(new URL('../../../rule-packs/public', import.meta.url));
const PackFileSchema = z
    .object({
    name: z.string().regex(/^[a-z0-9-]+$/),
    version: z.string().min(1),
    description: z.string().min(1),
    defaults: z
        .object({ excludePaths: z.array(z.string()).default([]) })
        .strict()
        .default({ excludePaths: [] }),
})
    .strict();
/** One rule file. snake_case on disk; mapped to RuleVersionInput. */
const RuleFileSchema = z
    .object({
    id: z.string(),
    version: z.number().int(),
    title: z.string(),
    category: RuleCategorySchema,
    severity: SeveritySchema,
    check_type: CheckTypeSchema,
    enabled_by_default: z.boolean().default(true),
    description: z.string(),
    source: z
        .object({
        citation: z.string(),
        url: z.string().nullable().default(null),
        note: z.string().nullable().default(null),
        last_verified: z.string().nullable().default(null),
    })
        .strict(),
    prompt_template: z.string().nullable().default(null),
    params: z.record(z.string(), z.unknown()).default({}),
})
    .strict();
/** Problems with a rule's params: deterministic rules must name a known check with valid settings. */
export function checkParamsProblems(checkType, params) {
    if (checkType !== 'deterministic')
        return [];
    const check = getCheck(params.check);
    if (!check)
        return [`params.check must name a known check, got "${String(params.check)}"`];
    const p = check.params.safeParse(params);
    return p.success ? [] : [`invalid params: ${z.prettifyError(p.error)}`];
}
/** A rule version in the pack's file format, so admin edits can be committed back to rule-packs/. */
export function ruleVersionYaml(r) {
    const doc = {
        id: r.ruleId,
        version: r.version,
        title: r.title,
        category: r.category,
        severity: r.severity,
        check_type: r.checkType,
        enabled_by_default: r.enabledByDefault,
        description: r.description,
        source: {
            citation: r.sourceCitation,
            url: r.sourceUrl,
            ...(r.sourceNote ? { note: r.sourceNote } : {}),
            last_verified: r.lastVerified,
        },
        ...(r.promptTemplate ? { prompt_template: r.promptTemplate } : {}),
        params: r.params,
    };
    return `# Exported from Pre-MLR Checker (${r.origin}, by ${r.createdBy} at ${r.createdAt}).\n${stringify(doc, { lineWidth: 100 })}`;
}
/**
 * Reads pack.yaml and rules/*.yaml. Every rule is validated, including its check params, so a bad
 * pack fails at startup rather than mid-scan. Rules without excludePaths inherit the pack default.
 */
export async function loadRulePack(dir) {
    const pack = PackFileSchema.parse(parse(await readFile(join(dir, 'pack.yaml'), 'utf8')));
    const origin = `pack:${pack.name}@${pack.version}`;
    const files = (await readdir(join(dir, 'rules'))).filter((f) => f.endsWith('.yaml')).sort();
    const errors = [];
    const rules = [];
    const ids = new Set();
    for (const file of files) {
        const where = `${pack.name}/rules/${file}`;
        const parsed = RuleFileSchema.safeParse(parse(await readFile(join(dir, 'rules', file), 'utf8')));
        if (!parsed.success) {
            errors.push(`${where}: ${z.prettifyError(parsed.error)}`);
            continue;
        }
        const r = parsed.data;
        if (`${r.id}.yaml` !== file)
            errors.push(`${where}: file name must be "${r.id}.yaml"`);
        if (ids.has(r.id))
            errors.push(`${where}: duplicate rule id "${r.id}"`);
        ids.add(r.id);
        const params = { ...r.params };
        // Page-level exclusions apply to LLM rules too (no need to send privacy/terms pages to a model).
        params.excludePaths ??= pack.defaults.excludePaths;
        errors.push(...checkParamsProblems(r.check_type, params).map((e) => `${where}: ${e}`));
        const input = {
            ruleId: r.id,
            version: r.version,
            title: r.title,
            description: r.description,
            category: r.category,
            severity: r.severity,
            checkType: r.check_type,
            sourceCitation: r.source.citation,
            sourceUrl: r.source.url,
            sourceNote: r.source.note,
            lastVerified: r.source.last_verified,
            promptTemplate: r.prompt_template,
            params,
            enabledByDefault: r.enabled_by_default,
            origin,
        };
        const check = RuleVersionInputSchema.safeParse(input);
        if (!check.success)
            errors.push(`${where}: ${z.prettifyError(check.error)}`);
        rules.push(input);
    }
    if (errors.length)
        throw new ValidationError(`Rule pack "${pack.name}" is invalid:\n${errors.join('\n')}`, errors);
    return { name: pack.name, version: pack.version, rules };
}
export const RULE_PACK_ACTOR = 'rule-pack-loader';
/**
 * Loads the pack into the database. Safe to repeat. A rule that an admin has since edited in the app
 * wins: a YAML version that isn't newer than the app's latest is skipped with a reason (commit the
 * exported YAML to bring the file up to date). Changing a pack rule's YAML without bumping its
 * version is still an error.
 */
export async function syncRulePack(db, dir) {
    const pack = await loadRulePack(dir);
    const created = [];
    const skipped = [];
    let unchanged = 0;
    for (const rule of pack.rules) {
        const latest = latestVersionOf(db, rule.ruleId);
        if (latest && latest.createdBy !== RULE_PACK_ACTOR && rule.version <= latest.version) {
            // The admin's export committed back to the file is up to date; anything older is skipped.
            const current = rule.version === latest.version &&
                ruleContentHash(RuleVersionInputSchema.parse(rule)) === latest.contentHash;
            if (current)
                unchanged++;
            else {
                skipped.push(`${rule.ruleId}@${rule.version}: edited in the app (v${latest.version} by ${latest.createdBy}); the YAML is older`);
            }
            continue;
        }
        const res = createRuleVersion(db, rule, RULE_PACK_ACTOR);
        if (res.status === 'created')
            created.push(`${rule.ruleId}@${rule.version}`);
        else
            unchanged++;
    }
    return { pack: `${pack.name}@${pack.version}`, created, unchanged, skipped };
}
//# sourceMappingURL=pack.js.map