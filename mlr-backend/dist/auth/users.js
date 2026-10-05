import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { appendAudit } from '../audit/log.js';
import { sessions, users } from '../db/schema.js';
import { ConflictError, NotFoundError, TooManyRequestsError, ValidationError } from '../errors.js';
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from './password.js';
export const nameKeyOf = (name) => name.trim().normalize('NFKC').toLowerCase();
const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const now = () => new Date().toISOString();
export const meOf = (u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
});
/** Creates a user (command line only). Names are unique ignoring case. */
export async function addUser(db, input, actor) {
    const name = input.name.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 100 || /\p{Cc}/u.test(name)) {
        throw new ValidationError('Names must be 1 to 100 printable characters.');
    }
    const problem = passwordProblem(input.password);
    if (problem)
        throw new ValidationError(problem);
    const nameKey = nameKeyOf(name);
    if (db.select({ id: users.id }).from(users).where(eq(users.nameKey, nameKey)).get()) {
        throw new ConflictError(`A user called "${name}" already exists.`);
    }
    const row = {
        id: randomUUID(),
        name,
        nameKey,
        role: input.role,
        passwordHash: await hashPassword(input.password),
        createdAt: now(),
    };
    db.transaction((tx) => {
        tx.insert(users).values(row).run();
        appendAudit(tx, {
            entityType: 'user',
            entityId: row.id,
            action: 'user_created',
            changes: { name: [null, name], role: [null, row.role] },
            actor,
            at: row.createdAt,
        });
    });
    return meOf(row);
}
function findUser(db, name) {
    const u = db
        .select()
        .from(users)
        .where(eq(users.nameKey, nameKeyOf(name)))
        .get();
    if (!u)
        throw new NotFoundError(`No user called "${name}".`);
    return u;
}
/** Changes a user's role, password or disabled state (command line only); disabling ends their sessions. */
export async function updateUser(db, name, change, actor) {
    const u = findUser(db, name);
    if (change.password !== undefined) {
        const problem = passwordProblem(change.password);
        if (problem)
            throw new ValidationError(problem);
    }
    const set = {};
    const changes = {};
    if (change.role && change.role !== u.role) {
        set.role = change.role;
        changes.role = [u.role, change.role];
    }
    if (change.password !== undefined) {
        set.passwordHash = await hashPassword(change.password);
        changes.password = ['(set)', '(changed)'];
    }
    if (change.disabled !== undefined && change.disabled !== !!u.disabledAt) {
        set.disabledAt = change.disabled ? now() : null;
        changes.disabled = [!!u.disabledAt, change.disabled];
    }
    if (!Object.keys(set).length)
        return meOf(u);
    db.transaction((tx) => {
        tx.update(users).set(set).where(eq(users.id, u.id)).run();
        // A new password, role or disabling takes effect everywhere: sign out existing sessions.
        tx.delete(sessions).where(eq(sessions.userId, u.id)).run();
        appendAudit(tx, {
            entityType: 'user',
            entityId: u.id,
            action: 'user_updated',
            changes,
            actor,
            at: now(),
        });
    });
    return meOf({ ...u, ...set });
}
export function listUsers(db) {
    return db
        .select({
        name: users.name,
        role: users.role,
        disabledAt: users.disabledAt,
        lastLoginAt: users.lastLoginAt,
    })
        .from(users)
        .orderBy(users.nameKey)
        .all();
}
/** Failed sign-ins per name, to slow down password guessing (per process; fine for a prototype). */
export class LoginThrottle {
    max;
    windowMs;
    failures = new Map();
    constructor(max = 5, windowMs = 15 * 60_000) {
        this.max = max;
        this.windowMs = windowMs;
    }
    check(name, at = Date.now()) {
        const recent = (this.failures.get(nameKeyOf(name)) ?? []).filter((t) => at - t < this.windowMs);
        this.failures.set(nameKeyOf(name), recent);
        if (recent.length >= this.max) {
            throw new TooManyRequestsError('Too many failed sign-ins. Try again in 15 minutes.');
        }
    }
    fail(name, at = Date.now()) {
        const key = nameKeyOf(name);
        this.failures.set(key, [...(this.failures.get(key) ?? []), at]);
    }
    succeed(name) {
        this.failures.delete(nameKeyOf(name));
    }
}
/** Checks a name and password; returns the user, or null (same timing for unknown names). */
export async function authenticate(db, name, password) {
    const u = db
        .select()
        .from(users)
        .where(eq(users.nameKey, nameKeyOf(name)))
        .get();
    const ok = await verifyPassword(password, u?.passwordHash ?? DUMMY_HASH);
    return u && ok && !u.disabledAt ? u : null;
}
/** Starts a session; returns the cookie token (only its hash is stored). */
export function createSession(db, userId, ttlHours) {
    const token = randomBytes(32).toString('base64url');
    const created = new Date();
    const expiresAt = new Date(created.getTime() + ttlHours * 3_600_000);
    db.transaction((tx) => {
        tx.delete(sessions).where(lt(sessions.expiresAt, created.toISOString())).run();
        tx.insert(sessions)
            .values({
            tokenHash: hashToken(token),
            userId,
            createdAt: created.toISOString(),
            expiresAt: expiresAt.toISOString(),
        })
            .run();
        tx.update(users).set({ lastLoginAt: created.toISOString() }).where(eq(users.id, userId)).run();
    });
    return { token, expiresAt };
}
/** The user behind a session token, if the session is current and the user enabled. */
export function userForToken(db, token) {
    if (!token)
        return null;
    const row = db
        .select({ u: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now())))
        .get();
    return row && !row.u.disabledAt ? row.u : null;
}
export function endSession(db, token) {
    if (token)
        db.delete(sessions)
            .where(eq(sessions.tokenHash, hashToken(token)))
            .run();
}
//# sourceMappingURL=users.js.map