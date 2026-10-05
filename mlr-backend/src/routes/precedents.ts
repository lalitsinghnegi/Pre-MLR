import type { FastifyPluginAsync } from 'fastify';
import {
  CandidateRulesQuerySchema,
  CreateRuleCandidateSchema,
  TrendsQuerySchema,
} from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
import { ValidationError } from '../errors.js';
import { requireRole } from '../auth/plugin.js';
import { createRuleCandidate, listRuleCandidates } from '../precedent/candidates.js';
import { candidateRules, precedentTrends } from '../precedent/trends.js';

/** Historic MLR comment trends, candidate new rules, and promoting comments to rule candidates. */
export const precedentRoutes =
  (db: Db): FastifyPluginAsync =>
  async (app) => {
    app.get('/api/rule-candidates', async () => listRuleCandidates(db));

    app.post('/api/rule-candidates', async (req, reply) => {
      const admin = requireRole(req, 'rule_admin');
      const body = CreateRuleCandidateSchema.safeParse(req.body ?? {});
      if (!body.success)
        throw ValidationError.fromIssues('Invalid rule candidate', body.error.issues);
      const created = createRuleCandidate(db, body.data, admin.name);
      return reply.code(201).send(created);
    });

    app.get('/api/precedents/trends', async (req) => {
      const q = TrendsQuerySchema.safeParse(req.query ?? {});
      if (!q.success) throw ValidationError.fromIssues('Invalid trends query', q.error.issues);
      return precedentTrends(db, q.data);
    });

    app.get('/api/precedents/candidates', async (req) => {
      const q = CandidateRulesQuerySchema.safeParse(req.query ?? {});
      if (!q.success) throw ValidationError.fromIssues('Invalid candidates query', q.error.issues);
      return candidateRules(db, q.data);
    });
  };
