import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { generateReportPdf, loadScan, reportFilename } from '../report/pdf.js';

export const reportRoutes =
  (db: Db, config: Config): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Params: { id: string } }>('/api/scans/:id/report.pdf', async (req, reply) => {
      const scan = loadScan(db, req.params.id);
      if (!scan) return reply.code(404).send({ error: 'Scan not found' });
      if (scan.status !== 'completed') {
        return reply
          .code(409)
          .send({ error: `Scan is ${scan.status}; the report is available once it completes` });
      }
      const now = new Date();
      const pdf = await generateReportPdf({
        db,
        dataDir: config.DATA_DIR,
        pageSize: config.PDF_PAGE_SIZE,
        scan,
        now,
      });
      return reply
        .type('application/pdf')
        .header('content-disposition', `attachment; filename="${reportFilename(scan, now)}"`)
        .send(pdf);
    });
  };
