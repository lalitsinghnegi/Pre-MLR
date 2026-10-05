import { generateReportPdf, loadScan, reportFilename } from '../report/pdf.js';
export const reportRoutes = (db, config) => async (app) => {
    app.get('/api/scans/:id/report.pdf', async (req, reply) => {
        const scan = loadScan(db, req.params.id);
        if (!scan)
            return reply.code(404).send({ error: 'Scan not found' });
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
//# sourceMappingURL=report.js.map