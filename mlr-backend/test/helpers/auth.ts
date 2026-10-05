import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type { Role } from '@pre-mlr/shared';
import { addUser } from '../../src/auth/users.js';
import type { Db } from '../../src/db/client.js';

export const TEST_PASSWORD = 'correct horse battery staple';

/** app.inject with the session cookie of a signed-in user. */
export type Api = (opts: string | InjectOptions) => Promise<LightMyRequestResponse>;

/** Creates a user, signs in through the real endpoint, and returns an inject that sends the cookie. */
export async function signIn(
  app: FastifyInstance,
  db: Db,
  role: Role = 'author',
  name = role === 'rule_admin' ? 'Robin Admin' : 'Pat Reviewer',
): Promise<Api> {
  await addUser(db, { name, role, password: TEST_PASSWORD }, 'test');
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { name, password: TEST_PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.body}`);
  const cookie = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return (opts) => {
    const o = typeof opts === 'string' ? { url: opts } : opts;
    return app.inject({ ...o, headers: { ...o.headers, cookie } });
  };
}
