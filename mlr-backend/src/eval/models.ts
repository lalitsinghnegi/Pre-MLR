import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import { AnthropicProvider } from '../llm/anthropic.js';
import { MockProvider } from '../llm/mock.js';
import type { LLMProvider } from '../llm/types.js';

export const DEFAULT_MODELS_FILE = fileURLToPath(
  new URL('../../eval/models.yaml', import.meta.url),
);

const ModelConfigSchema = z.discriminatedUnion('provider', [
  z.object({ id: z.string().regex(/^[\w.-]+$/), provider: z.literal('mock') }).strict(),
  z
    .object({
      id: z.string().regex(/^[\w.-]+$/),
      provider: z.literal('anthropic'),
      model: z.string().min(1),
      effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullable().default(null),
      fallback: z.boolean().default(false),
      maxTokens: z.number().int().min(1024).default(16000),
    })
    .strict(),
]);
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

const ModelsFileSchema = z
  .object({ default: z.array(z.string()).min(1), models: z.array(ModelConfigSchema).min(1) })
  .strict()
  .superRefine((f, ctx) => {
    const ids = f.models.map((m) => m.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length)
      ctx.addIssue({ code: 'custom', message: `duplicate model ids: ${dupes.join(', ')}` });
    const unknown = f.default.filter((id) => !ids.includes(id));
    if (unknown.length)
      ctx.addIssue({ code: 'custom', message: `default lists unknown ids: ${unknown.join(', ')}` });
  });
export type ModelsFile = z.infer<typeof ModelsFileSchema>;

export async function loadModels(path = DEFAULT_MODELS_FILE): Promise<ModelsFile> {
  return ModelsFileSchema.parse(parse(await readFile(path, 'utf8')));
}

/** The configs named by --models (comma-separated ids), or the file's default list. */
export function selectModels(file: ModelsFile, ids?: string[]): ModelConfig[] {
  const wanted = ids?.length ? ids : file.default;
  const unknown = wanted.filter((id) => !file.models.some((m) => m.id === id));
  if (unknown.length) {
    throw new Error(
      `Unknown model id(s): ${unknown.join(', ')}. Known: ${file.models.map((m) => m.id).join(', ')}`,
    );
  }
  return wanted.map((id) => file.models.find((m) => m.id === id)!);
}

export function providerFor(config: ModelConfig): LLMProvider {
  if (config.provider === 'mock') return new MockProvider();
  return new AnthropicProvider({
    model: config.model,
    effort: config.effort,
    maxTokens: config.maxTokens,
    fallback: config.fallback,
  });
}
