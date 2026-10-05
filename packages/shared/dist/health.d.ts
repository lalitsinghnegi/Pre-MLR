import { z } from 'zod';
export declare const HealthResponseSchema: z.ZodObject<{
    status: z.ZodEnum<{
        ok: "ok";
        degraded: "degraded";
    }>;
    version: z.ZodString;
    db: z.ZodEnum<{
        error: "error";
        ok: "ok";
    }>;
}, z.core.$strip>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
