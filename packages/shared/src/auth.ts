import { z } from 'zod';

/** Authors review findings and run scans; rule admins can also change rules. */
export const ROLES = ['author', 'rule_admin'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const LoginRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** The signed-in user. */
export const MeSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: RoleSchema,
});
export type Me = z.infer<typeof MeSchema>;

/** GET /api/me: answers while signed out too (user null), so the app can show the sign-in page. */
export const SessionSchema = z.object({ user: MeSchema.nullable() });
export type Session = z.infer<typeof SessionSchema>;
