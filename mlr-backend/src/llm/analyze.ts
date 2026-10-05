import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import sharp from 'sharp';
import type { Severity } from '@pre-mlr/shared';
import { findBlockContaining, isExcluded, locationOf, type CheckBlock } from '../checks/text.js';
import type { Db } from '../db/client.js';
import { llmAnalyses, pages, type PageRow, type RuleVersionRow } from '../db/schema.js';
import { recordFindings, type NewFinding } from '../findings/service.js';
import { scanRuleVersions } from '../rules/repository.js';
import { estimateCostUsd } from './pricing.js';
import { loadPrompts, renderRules, renderUser } from './prompt.js';
import { normalizeForMatch, outputSchema, validateOutput, type ValidFinding } from './schema.js';
import { ZERO_USAGE, type LLMProvider, type LlmRequest, type LlmUsage } from './types.js';

export const LLM_ACTOR = 'llm';
/** Longest image edge sent to the model; larger images are downscaled by the API anyway. */
const MAX_IMAGE_EDGE = 1568;

export interface AnalyzeOptions {
  provider: LLMProvider;
  dataDir: string;
  log: FastifyBaseLogger;
  concurrency?: number;
  signal?: AbortSignal;
  /** Reuse earlier analyses of identical page content (default true; the eval harness turns it off). */
  useCache?: boolean;
}

export interface AnalyzeResult {
  pagesAnalyzed: number;
  cached: number;
  failed: number;
  findingsCreated: number;
  costUsd: number;
}

/**
 * Runs the scan's enabled LLM rules over each eligible page: one call per page (or a cache hit),
 * validated output, one retry with feedback on invalid output, findings recorded as detectedBy
 * "llm". A failing page is recorded with its error; the scan carries on.
 */
export async function runLlmAnalysis(
  db: Db,
  scanId: string,
  opts: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const rules = scanRuleVersions(db, scanId).filter((r) => r.checkType === 'llm');
  const result: AnalyzeResult = {
    pagesAnalyzed: 0,
    cached: 0,
    failed: 0,
    findingsCreated: 0,
    costUsd: 0,
  };
  if (!rules.length) return result;

  const prompts = await loadPrompts();
  const rows = db
    .select()
    .from(pages)
    .where(eq(pages.scanId, scanId))
    .orderBy(asc(pages.crawlIndex))
    .all();
  const eligible = rows
    .filter((p) => !p.error && (p.httpStatus ?? 200) < 400 && p.text?.trim())
    .map((page) => ({ page, rules: rules.filter((r) => !isExcluded(page.url, excludePathsOf(r))) }))
    .filter((x) => x.rules.length);

  let next = 0;
  const worker = async () => {
    while (next < eligible.length) {
      opts.signal?.throwIfAborted();
      const { page, rules: pageRules } = eligible[next++]!;
      const outcome = await analyzePage(db, scanId, page, pageRules, prompts, opts);
      result.pagesAnalyzed++;
      if (outcome.cached) result.cached++;
      if (outcome.failed) result.failed++;
      result.findingsCreated += outcome.findingsCreated;
      result.costUsd += outcome.costUsd;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency ?? 2, eligible.length) }, worker),
  );
  result.costUsd = Math.round(result.costUsd * 1e6) / 1e6;
  return result;
}

const excludePathsOf = (r: RuleVersionRow) =>
  Array.isArray(r.params.excludePaths) ? (r.params.excludePaths as string[]) : [];

async function analyzePage(
  db: Db,
  scanId: string,
  page: PageRow,
  rules: RuleVersionRow[],
  prompts: Awaited<ReturnType<typeof loadPrompts>>,
  opts: AnalyzeOptions,
): Promise<{ cached: boolean; failed: boolean; findingsCreated: number; costUsd: number }> {
  const { provider, log } = opts;
  const pageText = page.text ?? '';
  const image = await screenshotForModel(opts.dataDir, page.desktopScreenshotPath);
  const ruleIds = rules.map((r) => r.ruleId);
  const ruleSeverity = Object.fromEntries(rules.map((r) => [r.ruleId, r.severity])) as Record<
    string,
    Severity
  >;
  const rulesBlock = renderRules(
    rules.map((r) => ({
      ruleId: r.ruleId,
      version: r.version,
      title: r.title,
      severity: r.severity,
      sourceCitation: r.sourceCitation,
      description: r.description,
      promptTemplate: r.promptTemplate,
    })),
  );
  const cacheKey = sha256(
    JSON.stringify({
      provider: provider.name,
      model: provider.model,
      settings: provider.settings,
      prompt: prompts.version,
      rules: rules.map((r) => `${r.ruleId}@${r.version}:${r.contentHash}`),
      url: page.url,
      title: page.title,
      text: pageText,
      image: image ? sha256(image.base64) : null,
    }),
  );
  const base = {
    id: randomUUID(),
    scanId,
    pageId: page.id,
    cacheKey,
    provider: provider.name,
    model: provider.model,
    promptVersion: prompts.version,
    createdAt: new Date().toISOString(),
  };

  // Cache: the same page content analysed with the same model, prompt and rules.
  const hit =
    opts.useCache === false
      ? undefined
      : db
          .select()
          .from(llmAnalyses)
          .where(and(eq(llmAnalyses.cacheKey, cacheKey), eq(llmAnalyses.status, 'ok')))
          .orderBy(desc(llmAnalyses.createdAt))
          .get();
  if (hit) {
    const validation = validateOutput(hit.output, { ruleIds, ruleSeverity, pageText });
    db.insert(llmAnalyses)
      .values({
        ...base,
        servedModel: hit.servedModel,
        status: 'ok',
        cached: true,
        attempts: 0,
        pageTip: hit.pageTip,
        output: hit.output,
        problems: hit.problems,
      })
      .run();
    const created = saveFindings(db, scanId, page, validation.findings);
    return { cached: true, failed: false, findingsCreated: created, costUsd: 0 };
  }

  const request: LlmRequest = {
    task: 'page-analysis',
    system: prompts.system,
    rulesBlock,
    userText: renderUser(prompts.userTemplate, {
      url: page.url,
      title: page.title,
      text: pageText,
    }),
    image,
    ruleIds,
    outputSchema: outputSchema(ruleIds),
  };

  const usage: LlmUsage = { ...ZERO_USAGE };
  const started = Date.now();
  let attempts = 0;
  let servedModel: string | null = null;
  let validation: ReturnType<typeof validateOutput> | null = null;
  let error: string | null = null;
  const problems: string[] = [];
  let costUsd = 0;

  try {
    for (attempts = 1; attempts <= 2; attempts++) {
      const feedback = attempts === 2 && validation ? validation.problems.join('\n') : undefined;
      const response = await provider.complete(
        feedback
          ? {
              ...request,
              userText: renderUser(
                prompts.userTemplate,
                { url: page.url, title: page.title, text: pageText },
                feedback,
              ),
            }
          : request,
        opts.signal,
      );
      servedModel = response.model;
      addUsage(usage, response.usage);
      costUsd += estimateCostUsd(response.model, response.usage) ?? 0;
      if (response.servedByFallback)
        log.info(
          { scanId, pageId: page.id, model: response.model },
          'LLM refusal fallback served the page',
        );

      if (response.stopReason === 'refusal') {
        validation = null;
        error = 'The model declined to analyse this page (refusal).';
        break;
      }
      validation =
        response.output === null
          ? {
              findings: [],
              pageTip: null,
              problems: [
                `No parseable JSON in the response (stop reason: ${response.stopReason}).`,
              ],
              unusable: true,
            }
          : validateOutput(response.output, { ruleIds, ruleSeverity, pageText });
      problems.push(...validation.problems.map((p) => `attempt ${attempts}: ${p}`));
      if (!validation.problems.length) break;
    }
    if (!error && (!validation || validation.unusable || !validation.pageTip)) {
      error = 'Invalid model output after one retry.';
    }
  } catch (err) {
    error = describeError(err);
    log.warn({ scanId, pageId: page.id, err }, 'LLM analysis failed');
  }

  const ok = !error && validation !== null;
  db.insert(llmAnalyses)
    .values({
      ...base,
      servedModel,
      status: ok ? 'ok' : 'error',
      cached: false,
      attempts: Math.min(attempts, 2),
      pageTip: ok ? validation!.pageTip : null,
      output: ok ? { findings: validation!.findings, pageTip: validation!.pageTip } : null,
      problems,
      ...usage,
      costUsd: Math.round(costUsd * 1e6) / 1e6,
      latencyMs: Date.now() - started,
      error,
    })
    .run();
  // After the retry, findings that still fail validation are dropped (and listed in `problems`).
  const created = ok ? saveFindings(db, scanId, page, validation!.findings) : 0;
  return { cached: false, failed: !ok, findingsCreated: created, costUsd };
}

function saveFindings(db: Db, scanId: string, page: PageRow, found: ValidFinding[]): number {
  const blocks: CheckBlock[] = page.facts?.blocks ?? [];
  const inputs: NewFinding[] = found.map((f) => ({
    pageId: page.id,
    ruleId: f.ruleId,
    detectedBy: 'llm',
    severity: f.severity,
    message: f.explanation,
    evidenceText: f.evidenceQuote,
    evidenceLocation: locationOf(locateQuote(blocks, f.evidenceQuote)),
    suggestedFix: f.suggestedRewrite,
    confidence: f.confidence,
  }));
  return recordFindings(db, scanId, inputs, LLM_ACTOR).created.length;
}

/** The text block holding the quote (or, for quotes spanning blocks, its first words). */
function locateQuote(blocks: CheckBlock[], quote: string): CheckBlock | undefined {
  const q = normalizeForMatch(quote);
  return (
    blocks.find((b) => normalizeForMatch(b.text).includes(q)) ??
    findBlockContaining(blocks, q.split(' ').slice(0, 6).join(' '))
  );
}

/** Desktop screenshot scaled to at most MAX_IMAGE_EDGE on its long edge, as JPEG. */
async function screenshotForModel(
  dataDir: string,
  rel: string | null,
): Promise<LlmRequest['image']> {
  if (!rel) return null;
  const root = resolve(dataDir);
  const file = resolve(root, rel);
  if (!file.startsWith(root + sep)) return null;
  const png = await readFile(file).catch(() => null);
  if (!png) return null;
  const jpeg = await sharp(png)
    .resize({
      width: MAX_IMAGE_EDGE,
      height: MAX_IMAGE_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toBuffer();
  return { mediaType: 'image/jpeg', base64: jpeg.toString('base64') };
}

function addUsage(total: LlmUsage, u: LlmUsage): void {
  total.inputTokens += u.inputTokens;
  total.outputTokens += u.outputTokens;
  total.cacheReadTokens += u.cacheReadTokens;
  total.cacheWriteTokens += u.cacheWriteTokens;
}

/** Typed SDK errors first (most specific to least), then anything else. */
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError)
    return 'Rate limited by the LLM API (after retries).';
  if (err instanceof Anthropic.AuthenticationError)
    return 'LLM API authentication failed (check ANTHROPIC_API_KEY).';
  if (err instanceof Anthropic.BadRequestError)
    return `LLM API rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the LLM API.';
  if (err instanceof Anthropic.APIError) return `LLM API error ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
