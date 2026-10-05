import { z } from 'zod';
/** Authors review findings and run scans; rule admins can also change rules. */
export const ROLES = ['author', 'rule_admin'];
export const RoleSchema = z.enum(ROLES);
export const LoginRequestSchema = z.object({
    name: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(200),
});
/** The signed-in user. */
export const MeSchema = z.object({
    id: z.string(),
    name: z.string(),
    role: RoleSchema,
});
/** GET /api/me: answers while signed out too (user null), so the app can show the sign-in page. */
export const SessionSchema = z.object({ user: MeSchema.nullable() });
//# sourceMappingURL=auth.js.map