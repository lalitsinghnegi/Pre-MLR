export type RawCell = string | number | Date | null;
export interface RawTable {
    headers: string[];
    /** Data rows (header row excluded), each with its 1-based row number in the file. */
    rows: {
        rowNumber: number;
        cells: RawCell[];
    }[];
}
/**
 * Reads the first row as headers and the rest as data, from .xlsx (a named or the first sheet) or
 * .csv. CSV values stay raw strings: exceljs' own CSV date parsing uses local time and can shift
 * dates by a day.
 */
export declare function readTable(file: string, sheet?: string): Promise<RawTable>;
