import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 12;
const derive = (password, salt, opts) => new Promise((resolve, reject) => scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))));
/** "scrypt$N$r$p$salt$hash" (base64), so parameters can be raised later without breaking old hashes. */
export async function hashPassword(password) {
    const salt = randomBytes(16);
    const key = await derive(password, salt, PARAMS);
    return [
        'scrypt',
        PARAMS.N,
        PARAMS.r,
        PARAMS.p,
        salt.toString('base64'),
        key.toString('base64'),
    ].join('$');
}
export async function verifyPassword(password, stored) {
    const [alg, n, r, p, salt, hash] = stored.split('$');
    if (alg !== 'scrypt' || !salt || !hash)
        return false;
    const expected = Buffer.from(hash, 'base64');
    const key = await derive(password, Buffer.from(salt, 'base64'), {
        N: Number(n),
        r: Number(r),
        p: Number(p),
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
}
/** A valid hash of a random password: verified against when the user doesn't exist, so timing doesn't reveal names. */
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));
export function passwordProblem(password) {
    if (password.length < MIN_PASSWORD_LENGTH)
        return `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (password.length > 200)
        return 'Passwords can be at most 200 characters.';
    return null;
}
//# sourceMappingURL=password.js.map