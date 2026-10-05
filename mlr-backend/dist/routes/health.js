import { sql } from 'drizzle-orm';
import { version } from '../version.js';
export const healthRoutes = (db) => async (app) => {
    app.get('/api/health', async (req) => {
        let dbStatus = 'ok';
        try {
            db.get(sql `select 1`);
        }
        catch (err) {
            req.log.error({ err }, 'health check: database unavailable');
            dbStatus = 'error';
        }
        return { status: dbStatus === 'ok' ? 'ok' : 'degraded', version, db: dbStatus };
    });
};
//# sourceMappingURL=health.js.map