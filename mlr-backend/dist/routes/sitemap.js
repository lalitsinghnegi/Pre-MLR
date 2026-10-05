import { eq } from 'drizzle-orm';
import { pages, scans } from '../db/schema.js';
import { renderSiteMapSvg, svgToPng } from '../sitemap/render.js';
// SVGs embed crawled titles and URLs; stop any script in them from running if opened directly.
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";
export const sitemapRoutes = (db) => async (app) => {
    async function loadSvg(scanId, reply) {
        const scan = db.select().from(scans).where(eq(scans.id, scanId)).get();
        if (!scan) {
            await reply.code(404).send({ error: 'Scan not found' });
            return null;
        }
        const rows = db
            .select({
            id: pages.id,
            crawlIndex: pages.crawlIndex,
            url: pages.url,
            parentPageId: pages.parentPageId,
            title: pages.title,
            httpStatus: pages.httpStatus,
            error: pages.error,
        })
            .from(pages)
            .where(eq(pages.scanId, scanId))
            .all();
        const host = new URL(scan.startUrl).host;
        const count = `${rows.length} page${rows.length === 1 ? '' : 's'}`;
        const partial = scan.status === 'completed' ? '' : ` (scan ${scan.status})`;
        const svg = await renderSiteMapSvg(rows, {
            caption: `Site map · ${host} · ${count}${partial}`,
        });
        if (!svg) {
            await reply.code(404).send({ error: 'Scan has no pages yet' });
            return null;
        }
        return svg;
    }
    app.get('/api/scans/:id/sitemap.svg', async (req, reply) => {
        const svg = await loadSvg(req.params.id, reply);
        if (svg === null)
            return reply;
        return reply
            .type('image/svg+xml; charset=utf-8')
            .header('content-security-policy', SVG_CSP)
            .header('content-disposition', `inline; filename="sitemap-${req.params.id}.svg"`)
            .send(svg);
    });
    app.get('/api/scans/:id/sitemap.png', async (req, reply) => {
        const svg = await loadSvg(req.params.id, reply);
        if (svg === null)
            return reply;
        return reply
            .type('image/png')
            .header('content-disposition', `inline; filename="sitemap-${req.params.id}.png"`)
            .send(svgToPng(svg));
    });
};
//# sourceMappingURL=sitemap.js.map