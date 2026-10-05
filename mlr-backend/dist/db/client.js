import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
/** mlr-backend/drizzle, resolved the same way from src/ (tsx) and dist/ (node). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));
export function createDb(url) {
    if (url !== ':memory:')
        mkdirSync(dirname(url), { recursive: true });
    const sqlite = new Database(url);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    return drizzle(sqlite, { schema });
}
export function runMigrations(db) {
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
//# sourceMappingURL=client.js.map