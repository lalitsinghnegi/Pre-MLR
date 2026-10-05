import type { Me, Role } from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
import { type UserRow } from '../db/schema.js';
export declare const nameKeyOf: (name: string) => string;
export declare const meOf: (u: Pick<UserRow, "id" | "name" | "role">) => Me;
/** Creates a user (command line only). Names are unique ignoring case. */
export declare function addUser(db: Db, input: {
    name: string;
    role: Role;
    password: string;
}, actor: string): Promise<Me>;
/** Changes a user's role, password or disabled state (command line only); disabling ends their sessions. */
export declare function updateUser(db: Db, name: string, change: {
    role?: Role;
    password?: string;
    disabled?: boolean;
}, actor: string): Promise<Me>;
export declare function listUsers(db: Db): {
    name: string;
    role: "author" | "rule_admin";
    disabledAt: string | null;
    lastLoginAt: string | null;
}[];
/** Failed sign-ins per name, to slow down password guessing (per process; fine for a prototype). */
export declare class LoginThrottle {
    private readonly max;
    private readonly windowMs;
    private readonly failures;
    constructor(max?: number, windowMs?: number);
    check(name: string, at?: number): void;
    fail(name: string, at?: number): void;
    succeed(name: string): void;
}
/** Checks a name and password; returns the user, or null (same timing for unknown names). */
export declare function authenticate(db: Db, name: string, password: string): Promise<UserRow | null>;
/** Starts a session; returns the cookie token (only its hash is stored). */
export declare function createSession(db: Db, userId: string, ttlHours: number): {
    token: string;
    expiresAt: Date;
};
/** The user behind a session token, if the session is current and the user enabled. */
export declare function userForToken(db: Db, token: string | undefined): UserRow | null;
export declare function endSession(db: Db, token: string | undefined): void;
