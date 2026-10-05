import { extname } from 'node:path';
import ExcelJS from 'exceljs';

export type RawCell = string | number | Date | null;
export interface RawTable {
  headers: string[];
  /** Data rows (header row excluded), each with its 1-based row number in the file. */
  rows: { rowNumber: number; cells: RawCell[] }[];
}

/**
 * Reads the first row as headers and the rest as data, from .xlsx (a named or the first sheet) or
 * .csv. CSV values stay raw strings: exceljs' own CSV date parsing uses local time and can shift
 * dates by a day.
 */
export async function readTable(file: string, sheet?: string): Promise<RawTable> {
  const workbook = new ExcelJS.Workbook();
  const ext = extname(file).toLowerCase();
  let ws: ExcelJS.Worksheet | undefined;
  if (ext === '.csv') {
    ws = await workbook.csv.readFile(file, { map: (v: unknown) => v });
  } else if (ext === '.xlsx') {
    await workbook.xlsx.readFile(file);
    ws = sheet ? workbook.getWorksheet(sheet) : workbook.worksheets[0];
    if (!ws) {
      const names = workbook.worksheets.map((w) => w.name).join(', ');
      throw new Error(`Worksheet "${sheet}" not found (sheets: ${names || 'none'})`);
    }
  } else {
    throw new Error(`Unsupported file type "${ext}"; use .xlsx or .csv`);
  }

  const headers = (ws.getRow(1).values as unknown[])
    .slice(1)
    .map((v) => cellText(v as ExcelJS.CellValue));
  const rows: RawTable['rows'] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells = headers.map((_, i) => normalizeCell(row.getCell(i + 1).value));
    if (cells.every((c) => c === null)) return; // skip fully blank rows
    rows.push({ rowNumber, cells });
  });
  return { headers, rows };
}

function normalizeCell(v: ExcelJS.CellValue): RawCell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === 'number') return v;
  const text = cellText(v);
  return text === '' ? null : text;
}

/** Plain text for any cell value (rich text, hyperlinks and formula results included). */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('richText' in v)
      return v.richText
        .map((r) => r.text)
        .join('')
        .trim();
    if ('text' in v && typeof v.text === 'string') return v.text.trim();
    if ('result' in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
  }
  return String(v).trim();
}
