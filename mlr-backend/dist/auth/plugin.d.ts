import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Role } from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
import type { UserRow } from '../db/schema.js';
export declare const SESSION_COOKIE = "pre_mlr_session";
/** Registers cookie parsing and a hook that resolves the session on every /api request. */
export declare function registerAuth(app: FastifyInstance, db: Db): Promise<void>;
/** The signed-in user (routes behind the auth hook always have one). */
export declare function currentUser(req: FastifyRequest): UserRow;
export declare function requireRole(req: FastifyRequest, role: Role): UserRow;
declare module 'fastify' {
    interface FastifyRequest {
        user: UserRow | null;
    }
}
