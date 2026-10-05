import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/**
 * Claude via the official SDK. Structured output (output_config.format) constrains the response to
 * the request's schema; the SDK retries 429/5xx with backoff (maxRetries on the client).
 */
export class AnthropicProvider {
    opts;
    name = 'anthropic';
    model;
    settings;
    client;
    constructor(opts) {
        this.opts = opts;
        this.model = opts.model;
        this.settings = { effort: opts.effort, maxTokens: opts.maxTokens };
        this.client = opts.client ?? new Anthropic({ maxRetries: 4 });
    }
    async complete(req, signal) {
        const content = [];
        if (req.image) {
            content.push({
                type: 'image',
                source: { type: 'base64', media_type: req.image.mediaType, data: req.image.base64 },
            });
        }
        content.push({ type: 'text', text: req.userText });
        const response = await this.client.beta.messages.parse({
            model: this.opts.model,
            max_tokens: this.opts.maxTokens,
            // Static instructions, then the scan's rule list; both cached across the scan's pages.
            system: [
                { type: 'text', text: req.system },
                { type: 'text', text: req.rulesBlock, cache_control: { type: 'ephemeral' } },
            ],
            messages: [{ role: 'user', content }],
            output_config: {
                ...(this.opts.effort ? { effort: this.opts.effort } : {}),
                format: betaZodOutputFormat(req.outputSchema),
            },
            ...(this.opts.fallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
        }, { signal });
        const rawText = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        const usage = response.usage;
        return {
            output: response.parsed_output ?? null,
            rawText,
            model: response.model,
            stopReason: response.stop_reason,
            servedByFallback: (usage.iterations ?? []).some((i) => i.type === 'fallback_message'),
            usage: {
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                cacheReadTokens: usage.cache_read_input_tokens ?? 0,
                cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
            },
        };
    }
}
//# sourceMappingURL=anthropic.js.map