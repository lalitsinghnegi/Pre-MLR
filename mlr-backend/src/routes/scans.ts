import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { CreateScanRequestSchema, type PageSummary, type Scan } from '@pre-mlr/shared';
import { currentUser } from '../auth/plugin.js';
import type { Db } from '../db/client.js';
import { pages, scans, type PageRow, type ScanRow } from '../db/schema.js';
import type { Config } from '../config.js';
import { ValidationError } from '../errors.js';
import type { NetworkGuard } from '../net/guard.js';
import { appendAudit } from '../audit/log.js';
import { createScan } from '../scans/create.js';
import { deleteScan, rerunRequest } from '../scans/manage.js';
import type { ScanRunner } from '../scans/runner.js';

const toScan = (row: ScanRow): Scan => ({
  id: row.id,
  startUrl: row.startUrl,
  maxPages: row.maxPages,
  maxDepth: row.maxDepth,
  status: row.status,
  phase: row.phase,
  error: row.error,
  pagesCrawled: row.pagesCrawled,
  createdBy: row.createdBy,
  product: row.product,
  createdAt: row.createdAt,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
});

const toPageSummary = (row: PageRow): PageSummary => ({
  id: row.id,
  scanId: row.scanId,
  crawlIndex: row.crawlIndex,
  url: row.url,
  depth: row.depth,
  parentPageId: row.parentPageId,
  title: row.title,
  httpStatus: row.httpStatus,
  error: row.error,
  textLength: row.text?.length ?? 0,
  links: row.links,
  screenshots: { desktop: !!row.desktopScreenshotPath, mobile: !!row.mobileScreenshotPath },
});

export const scanRoutes =
  (db: Db, runner: ScanRunner, config: Config, guard: NetworkGuard): FastifyPluginAsync =>
  async (app) => {
    /** Checks the target and the queue limits, then queues the scan. */
    const start = async (request: z.output<typeof CreateScanRequestSchema>, actor: string) => {
      // Refuse internal targets up front (the crawler checks every request again).
      const target = await guard.checkUrl(request.startUrl);
      if (!target.ok && target.reason !== 'unresolved') {
        throw new ValidationError(
          target.reason === 'private'
            ? `${target.message}: scans can't reach internal hosts. A local test site must be listed in SCAN_PRIVATE_ALLOWLIST.`
            : target.message,
        );
      }
      return createScan(db, runner, request, actor, {
        maxQueued: config.MAX_QUEUED_SCANS,
        maxPerUser: config.MAX_ACTIVE_SCANS_PER_USER,
      });
    };

    app.post('/api/scans', async (req, reply) => {
      const parsed = CreateScanRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid request', details: z.flattenError(parsed.error) });
      }
      const row = await start(parsed.data, currentUser(req).name);
      return reply.code(202).send(toScan(row));
    });

    /** A new scan with the same settings and rule choices (the old scan and its review stay). */
    app.post<{ Params: { id: string } }>('/api/scans/:id/rerun', async (req, reply) => {
      const user = currentUser(req);
      const request = CreateScanRequestSchema.parse(rerunRequest(db, req.params.id));
      const row = await start(request, user.name);
      appendAudit(db, {
        entityType: 'scan',
        entityId: row.id,
        scanId: row.id,
        action: 'scan_rerun',
        changes: { rerunOf: [null, req.params.id] },
        actor: user.name,
        at: row.createdAt,
      });
      return reply.code(202).send(toScan(row));
    });

    app.delete<{ Params: { id: string } }>('/api/scans/:id', async (req, reply) => {
      await deleteScan(db, config.DATA_DIR, req.params.id, currentUser(req));
      return reply.code(204).send();
    });

    app.get<{ Params: { id: string } }>('/api/scans/:id', async (req, reply) => {
      const row = db.select().from(scans).where(eq(scans.id, req.params.id)).get();
      if (!row) return reply.code(404).send({ error: 'Scan not found' });
      return toScan(row);
    });

    app.get<{ Params: { id: string } }>('/api/scans/:id/pages', async (req, reply) => {
      const scan = db.select({ id: scans.id }).from(scans).where(eq(scans.id, req.params.id)).get();
      if (!scan) return reply.code(404).send({ error: 'Scan not found' });
      const rows = db
        .select()
        .from(pages)
        .where(eq(pages.scanId, scan.id))
        .orderBy(asc(pages.crawlIndex))
        .all();
      return rows.map(toPageSummary);
    });
  };
