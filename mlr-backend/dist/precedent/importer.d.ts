import type { Db } from '../db/client.js';
import type { ColumnMapping } from './mapping.js';
export interface ImportOptions {
    file: string;
    mapping: ColumnMapping;
    /** Site to record when the file has no site column (e.g. "examplin.test"). */
    site: string | null;
    pseudonymKey: string;
    actor: string;
    /** Validate and report without writing anything. */
    dryRun?: boolean;
    /** Fail the whole import if any row is invalid. */
    strict?: boolean;
}
export interface ImportReport {
    importId: string | null;
    file: string;
    rowsTotal: number;
    rowsImported: number;
    rowsSkipped: number;
    rowsDuplicate: number;
    rowErrors: {
        row: number;
        errors: string[];
    }[];
    dryRun: boolean;
}
export declare const MIN_PSEUDONYM_KEY_LENGTH = 16;
/**
 * Imports historic MLR comments from .xlsx/.csv using a column mapping. Invalid rows are skipped and
 * reported (or, with strict, abort the import); rows already imported (same fingerprint, including
 * duplicates within the file) are skipped. Everything is written in one transaction.
 */
export declare function importPrecedents(db: Db, opts: ImportOptions): Promise<ImportReport>;
