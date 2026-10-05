import cookie from '@fastify/cookie';
import { ForbiddenError, UnauthorizedError } from '../errors.js';
import { userForToken } from './users.js';
export const SESSION_COOKIE = 'pre_mlr_session';
/** API paths anyone can call. Everything else under /api needs a signed-in user. */
const PUBLIC = new Set(['/api/health', '/api/auth/login']);
/** Answer either way: the user if signed in, otherwise no user (and no 401). */
const OPTIONAL = new Set(['/api/me']);
/** Registers cookie parsing and a hook that resolves the session on every /api request. */
export async function registerAuth(app, db) {
    await app.register(cookie);
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (req) => {
        const path = req.url.split('?')[0];
        if (!path.startsWith('/api/') || PUBLIC.has(path))
            return;
        const user = userForToken(db, req.cookies[SESSION_COOKIE]);
        if (!user && !OPTIONAL.has(path))
            throw new UnauthorizedError();
        req.user = user;
    });
}
/** The signed-in user (routes behind the auth hook always have one). */
export function currentUser(req) {
    if (!req.user)
        throw new UnauthorizedError();
    return req.user;
}
export function requireRole(req, role) {
    const user = currentUser(req);
    if (role === 'rule_admin' && user.role !== 'rule_admin') {
        throw new ForbiddenError('Only rule admins can do this.');
    }
    return user;
}
//# sourceMappingURL=plugin.js.map