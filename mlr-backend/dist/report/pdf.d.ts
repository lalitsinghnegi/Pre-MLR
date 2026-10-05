import type { Db } from '../db/client.js';
import { type ScanRow } from '../db/schema.js';
import { type PageSize } from './plan.js';
export interface GenerateReportOptions {
    db: Db;
    dataDir: string;
    pageSize: PageSize;
    scan: ScanRow;
    now?: Date;
}
export declare function generateReportPdf(opts: GenerateReportOptions): Promise<Buffer>;
export declare function reportFilename(scan: ScanRow, now?: Date): string;
export declare function loadScan(db: Db, id: string): ScanRow | undefined;
