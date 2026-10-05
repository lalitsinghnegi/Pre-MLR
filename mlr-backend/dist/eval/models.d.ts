import { z } from 'zod';
import type { LLMProvider } from '../llm/types.js';
export declare const DEFAULT_MODELS_FILE: string;
declare const ModelConfigSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    id: z.ZodString;
    provider: z.ZodLiteral<"mock">;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    provider: z.ZodLiteral<"anthropic">;
    model: z.ZodString;
    effort: z.ZodDefault<z.ZodNullable<z.ZodEnum<{
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        max: "max";
    }>>>;
    fallback: z.ZodDefault<z.ZodBoolean>;
    maxTokens: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>], "provider">;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
declare const ModelsFileSchema: z.ZodObject<{
    default: z.ZodArray<z.ZodString>;
    models: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        id: z.ZodString;
        provider: z.ZodLiteral<"mock">;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        provider: z.ZodLiteral<"anthropic">;
        model: z.ZodString;
        effort: z.ZodDefault<z.ZodNullable<z.ZodEnum<{
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            max: "max";
        }>>>;
        fallback: z.ZodDefault<z.ZodBoolean>;
        maxTokens: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>], "provider">>;
}, z.core.$strict>;
export type ModelsFile = z.infer<typeof ModelsFileSchema>;
export declare function loadModels(path?: string): Promise<ModelsFile>;
/** The configs named by --models (comma-separated ids), or the file's default list. */
export declare function selectModels(file: ModelsFile, ids?: string[]): ModelConfig[];
export declare function providerFor(config: ModelConfig): LLMProvider;
export {};
