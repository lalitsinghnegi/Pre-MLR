import type { FastifyPluginAsync } from 'fastify';
import { LoginRequestSchema } from '@pre-mlr/shared';
import { SESSION_COOKIE } from '../auth/plugin.js';
import { authenticate, createSession, endSession, LoginThrottle, meOf } from '../auth/users.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { UnauthorizedError, ValidationError } from '../errors.js';

export const authRoutes =
  (db: Db, config: Config): FastifyPluginAsync =>
  async (app) => {
    const throttle = new LoginThrottle();
    const cookieOptions = {
      path: '/',
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: config.COOKIE_SECURE,
    };

    app.post('/api/auth/login', async (req, reply) => {
      const body = LoginRequestSchema.safeParse(req.body ?? {});
      if (!body.success) throw ValidationError.fromIssues('Invalid sign-in', body.error.issues);
      const { name, password } = body.data;
      throttle.check(name);
      const user = await authenticate(db, name, password);
      if (!user) {
        throttle.fail(name);
        req.log.info({ name }, 'failed sign-in');
        throw new UnauthorizedError('Wrong name or password.');
      }
      throttle.succeed(name);
      const { token, expiresAt } = createSession(db, user.id, config.SESSION_TTL_HOURS);
      return reply
        .setCookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt })
        .send(meOf(user));
    });

    app.post('/api/auth/logout', async (req, reply) => {
      endSession(db, req.cookies[SESSION_COOKIE]);
      return reply.clearCookie(SESSION_COOKIE, cookieOptions).code(204).send();
    });

    app.get('/api/me', async (req) => ({ user: req.user ? meOf(req.user) : null }));
  };
