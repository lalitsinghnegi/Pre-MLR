import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { BulkFindingUpdateSchema, FindingUpdateSchema } from '@pre-mlr/shared';
import { currentUser } from '../auth/plugin.js';
import { auditFor } from '../audit/log.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { findings, pages, scans } from '../db/schema.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { updateFinding } from '../findings/service.js';
import {
  findingView,
  findingViewsByIds,
  findingViewsForScan,
  scanSummaries,
} from '../review/views.js';

export const findingRoutes =
  (db: Db, config: Config): FastifyPluginAsync =>
  async (app) => {
    app.get('/api/scans', async () => scanSummaries(db));

    app.get<{ Params: { id: string } }>('/api/scans/:id/findings', async (req) => {
      if (!db.select({ id: scans.id }).from(scans).where(eq(scans.id, req.params.id)).get()) {
        throw new NotFoundError('Scan not found');
      }
      return findingViewsForScan(db, req.params.id);
    });

    app.patch<{ Params: { id: string } }>('/api/findings/:id', async (req, reply) => {
      const parsed = FindingUpdateSchema.safeParse(req.body ?? {});
      if (!parsed.success)
        throw ValidationError.fromIssues('Invalid finding update', parsed.error.issues);
      try {
        updateFinding(db, req.params.id, parsed.data, currentUser(req).name);
      } catch (err) {
        if (err instanceof ConflictError) {
          // Send the current state so the client can refresh instead of overwriting.
          return reply
            .code(409)
            .send({ error: err.message, current: findingView(db, req.params.id) });
        }
        throw err;
      }
      return findingView(db, req.params.id);
    });

    /** All-or-nothing: if any item is missing or stale, nothing changes. */
    app.post('/api/findings/bulk', async (req, reply) => {
      const parsed = BulkFindingUpdateSchema.safeParse(req.body ?? {});
      if (!parsed.success)
        throw ValidationError.fromIssues('Invalid bulk update', parsed.error.issues);
      const { items, status, comment } = parsed.data;
      const ids = items.map((i) => i.id);
      if (new Set(ids).size !== ids.length) throw new ValidationError('Duplicate finding ids');

      const current = new Map(
        db
          .select({ id: findings.id, revision: findings.revision })
          .from(findings)
          .where(inArray(findings.id, ids))
          .all()
          .map((r) => [r.id, r.revision]),
      );
      const missing = ids.filter((id) => !current.has(id));
      if (missing.length) throw new NotFoundError(`Findings not found: ${missing.join(', ')}`);
      const stale = items.filter((i) => current.get(i.id) !== i.expectedRevision).map((i) => i.id);
      if (stale.length) {
        return reply.code(409).send({
          error: `${stale.length} finding(s) were changed by someone else; nothing was updated`,
          stale,
          current: findingViewsByIds(db, stale),
        });
      }

      const actor = currentUser(req).name;
      db.transaction((tx) => {
        for (const item of items) {
          updateFinding(
            tx as unknown as Db,
            item.id,
            { status, comment, expectedRevision: item.expectedRevision },
            actor,
          );
        }
      });
      return findingViewsByIds(db, ids);
    });

    app.get<{ Params: { id: string } }>('/api/findings/:id/audit', async (req) => {
      if (
        !db.select({ id: findings.id }).from(findings).where(eq(findings.id, req.params.id)).get()
      ) {
        throw new NotFoundError('Finding not found');
      }
      return auditFor(db, 'finding', req.params.id);
    });

    const ScreenshotParams = z.object({
      id: z.string(),
      pageId: z.string(),
      view: z.enum(['desktop', 'mobile']),
    });
    app.get('/api/scans/:id/pages/:pageId/screenshot/:view', async (req, reply) => {
      const params = ScreenshotParams.safeParse(req.params);
      if (!params.success) throw new NotFoundError('Screenshot not found');
      const { id, pageId, view } = params.data;
      const page = db
        .select({ desktop: pages.desktopScreenshotPath, mobile: pages.mobileScreenshotPath })
        .from(pages)
        .where(and(eq(pages.id, pageId), eq(pages.scanId, id)))
        .get();
      const rel = page?.[view];
      if (!rel) throw new NotFoundError('Screenshot not found');
      const root = resolve(config.DATA_DIR);
      const file = resolve(root, rel);
      if (!file.startsWith(root + sep)) throw new NotFoundError('Screenshot not found');
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) throw new NotFoundError('Screenshot not found');
      return reply
        .type('image/png')
        .header('cache-control', 'private, max-age=86400, immutable')
        .header('content-length', info.size)
        .send(createReadStream(file));
    });
  };
