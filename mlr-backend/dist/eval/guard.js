import { estimateCostUsd } from '../llm/pricing.js';
/** Rough per-page token use for the estimate (text + scaled screenshot + rules; output incl. reasoning). */
const EST_INPUT_TOKENS_PER_PAGE = 6000;
const EST_OUTPUT_TOKENS_PER_PAGE = 2500;
export function estimateSpend(models, pages, runs) {
    const paid = models.filter((m) => m.provider === 'anthropic');
    let total = 0;
    for (const m of paid) {
        const perPage = estimateCostUsd(m.provider === 'anthropic' ? m.model : '', {
            inputTokens: EST_INPUT_TOKENS_PER_PAGE,
            outputTokens: EST_OUTPUT_TOKENS_PER_PAGE,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
        });
        total = perPage === null || total === null ? null : total + perPage * pages * runs;
    }
    return {
        paidModels: paid.map((m) => m.id),
        estimateUsd: total === null ? null : Math.round(total * 100) / 100,
    };
}
/**
 * Refuses to start paid runs without explicit confirmation, or when the estimate already exceeds
 * the budget. Returns an error message, or null when it is fine to proceed.
 */
export function checkSpend(est, opts) {
    if (!est.paidModels.length)
        return null;
    const cost = est.estimateUsd === null ? 'an unknown amount' : `about $${est.estimateUsd.toFixed(2)}`;
    if (!opts.yes) {
        return `Models ${est.paidModels.join(', ')} call the Anthropic API (paid; sends ${opts.sends ?? "the fictional site's pages"}) and would cost ${cost}. Re-run with --yes to proceed.`;
    }
    if (est.estimateUsd !== null && est.estimateUsd > opts.maxCostUsd) {
        return `Estimated cost $${est.estimateUsd.toFixed(2)} exceeds --max-cost-usd ${opts.maxCostUsd}. Raise the limit or run fewer models/runs.`;
    }
    return null;
}
//# sourceMappingURL=guard.js.map