import { z } from 'zod';
export const HealthResponseSchema = z.object({
    status: z.enum(['ok', 'degraded']),
    version: z.string(),
    db: z.enum(['ok', 'error']),
});
//# sourceMappingURL=health.js.map