import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MeSchema, SessionSchema } from '@pre-mlr/shared';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { addUser, LoginThrottle, updateUser } from '../src/auth/users.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { auditLog, sessions, users } from '../src/db/schema.js';
import { TEST_PASSWORD } from './helpers/auth.js';
import { migratedDb } from './helpers/model.js';

describe('password hashing', () => {
  it('verifies the right password only, with a fresh salt each time', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery staple', a)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', a)).toBe(false);
    expect(await verifyPassword('anything', 'md5$abc')).toBe(false);
  });
});

describe('LoginThrottle', () => {
  it('blocks a name after five failures within the window, per name, until it expires', () => {
    const t = new LoginThrottle(5, 1000);
    for (let i = 0; i < 5; i++) t.fail('Pat', 0);
    expect(() => t.check('pat', 500)).toThrow(/Too many failed sign-ins/);
    expect(() => t.check('Robin', 500)).not.toThrow();
    expect(() => t.check('Pat', 1500)).not.toThrow();
  });
});

describe('sign-in API', () => {
  let app: FastifyInstance;
  let db: Db;

  beforeEach(async () => {
    db = migratedDb();
    app = await buildApp({ config: loadConfig({ LOG_LEVEL: 'silent' }), db, llm: null });
    await addUser(db, { name: 'Pat Author', role: 'author', password: TEST_PASSWORD }, 'test');
  });
  afterEach(() => app.close());

  const login = (name: string, password = TEST_PASSWORD) =>
    app.inject({ method: 'POST', url: '/api/auth/login', payload: { name, password } });
  const cookieOf = (res: Awaited<ReturnType<typeof login>>) =>
    res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const me = (cookie?: string) => app.inject({ url: '/api/me', headers: cookie ? { cookie } : {} });
  /** The signed-in user for a cookie, or null; and whether a protected route lets it through. */
  const userOf = async (cookie?: string) => SessionSchema.parse((await me(cookie)).json()).user;
  const scansStatus = async (cookie: string) =>
    (await app.inject({ url: '/api/scans', headers: { cookie } })).statusCode;

  it('signs in (name is case-insensitive) with a secure-by-default session cookie', async () => {
    const res = await login('  pat AUTHOR ');
    expect(res.statusCode).toBe(200);
    expect(MeSchema.parse(res.json())).toMatchObject({ name: 'Pat Author', role: 'author' });
    expect(res.body).not.toMatch(/scrypt|password/i);
    const [cookie] = res.cookies;
    expect(cookie).toMatchObject({
      name: 'pre_mlr_session',
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
    });
    expect(cookie!.value.length).toBeGreaterThanOrEqual(40);
    // Only a hash of the token is stored.
    const stored = db.select().from(sessions).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toBe(cookie!.value);
    expect(await userOf(cookieOf(res))).toMatchObject({ name: 'Pat Author' });
    expect(await scansStatus(cookieOf(res))).toBe(200);
    expect(db.select().from(users).get()!.lastLoginAt).not.toBeNull();
  });

  it('marks the cookie Secure when configured', async () => {
    const db2 = migratedDb();
    const secure = await buildApp({
      config: loadConfig({ LOG_LEVEL: 'silent', COOKIE_SECURE: 'true' }),
      db: db2,
      llm: null,
    });
    await addUser(db2, { name: 'Pat Author', role: 'author', password: TEST_PASSWORD }, 'test');
    const res = await secure.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'Pat Author', password: TEST_PASSWORD },
    });
    expect(res.cookies[0]!.secure).toBe(true);
    await secure.close();
  });

  it('gives the same answer for a wrong password and an unknown name', async () => {
    const wrong = await login('Pat Author', 'not the password');
    const unknown = await login('Nobody Here');
    for (const res of [wrong, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('Wrong name or password.');
      expect(res.cookies).toEqual([]);
    }
    expect(
      (await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} })).statusCode,
    ).toBe(400);
  });

  it('locks a name out after repeated failures', async () => {
    for (let i = 0; i < 5; i++) expect((await login('Pat Author', 'guess')).statusCode).toBe(401);
    const locked = await login('Pat Author');
    expect(locked.statusCode).toBe(429);
  });

  it('requires a session for the API, except health and sign-in', async () => {
    for (const url of [
      '/api/scans',
      '/api/rules',
      '/api/precedents/trends',
      '/api/scans/x/report.pdf',
      '/api/scans/x/pages/y/screenshot/desktop',
    ]) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(401);
      expect(res.json().error).toBe('Sign in to continue.');
    }
    const post = await app.inject({ method: 'POST', url: '/api/scans', payload: {} });
    expect(post.statusCode).toBe(401);
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    // "Who am I" answers while signed out, so the app can show the sign-in page without an error.
    const anon = await me();
    expect(anon.statusCode).toBe(200);
    expect(anon.json()).toEqual({ user: null });
    expect(await userOf('pre_mlr_session=forged-token')).toBeNull();
    expect(await scansStatus('pre_mlr_session=forged-token')).toBe(401);
  });

  it('signs out, and expired sessions stop working', async () => {
    const cookie = cookieOf(await login('Pat Author'));
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(204);
    expect(out.cookies[0]).toMatchObject({ name: 'pre_mlr_session', value: '' });
    expect(await userOf(cookie)).toBeNull();
    expect(await scansStatus(cookie)).toBe(401);

    const second = cookieOf(await login('Pat Author'));
    db.update(sessions).set({ expiresAt: '2000-01-01T00:00:00.000Z' }).run();
    expect(await userOf(second)).toBeNull();
    expect(await scansStatus(second)).toBe(401);
  });

  it('disabling a user or changing their password ends their sessions', async () => {
    const cookie = cookieOf(await login('Pat Author'));
    await updateUser(db, 'pat author', { password: 'a brand new password' }, 'cli:test');
    expect(await userOf(cookie)).toBeNull();
    expect(await scansStatus(cookie)).toBe(401);
    expect((await login('Pat Author', 'a brand new password')).statusCode).toBe(200);

    await updateUser(db, 'Pat Author', { disabled: true }, 'cli:test');
    expect((await login('Pat Author', 'a brand new password')).statusCode).toBe(401);
    const audits = db
      .select()
      .from(auditLog)
      .all()
      .filter((a) => a.entityType === 'user');
    expect(audits.map((a) => a.action)).toEqual(['user_created', 'user_updated', 'user_updated']);
    expect(JSON.stringify(audits)).not.toContain('a brand new password');
  });

  it('rejects weak passwords and duplicate names', async () => {
    await expect(
      addUser(db, { name: 'Short', role: 'author', password: 'short' }, 't'),
    ).rejects.toThrow(/at least 12/);
    await expect(
      addUser(db, { name: 'PAT AUTHOR', role: 'author', password: TEST_PASSWORD }, 't'),
    ).rejects.toThrow(/already exists/);
  });
});
