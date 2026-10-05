import Database from 'better-sqlite3';
import { type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
export type Db = BetterSQLite3Database<typeof schema> & {
    $client: Database.Database;
};
/** mlr-backend/drizzle, resolved the same way from src/ (tsx) and dist/ (node). */
export declare const MIGRATIONS_FOLDER: string;
export declare function createDb(url: string): Db;
export declare function runMigrations(db: Db): void;
