import { z } from 'zod';
/** Authors review findings and run scans; rule admins can also change rules. */
export declare const ROLES: readonly ["author", "rule_admin"];
export declare const RoleSchema: z.ZodEnum<{
    author: "author";
    rule_admin: "rule_admin";
}>;
export type Role = z.infer<typeof RoleSchema>;
export declare const LoginRequestSchema: z.ZodObject<{
    name: z.ZodString;
    password: z.ZodString;
}, z.core.$strip>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
/** The signed-in user. */
export declare const MeSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    role: z.ZodEnum<{
        author: "author";
        rule_admin: "rule_admin";
    }>;
}, z.core.$strip>;
export type Me = z.infer<typeof MeSchema>;
/** GET /api/me: answers while signed out too (user null), so the app can show the sign-in page. */
export declare const SessionSchema: z.ZodObject<{
    user: z.ZodNullable<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        role: z.ZodEnum<{
            author: "author";
            rule_admin: "rule_admin";
        }>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Session = z.infer<typeof SessionSchema>;
