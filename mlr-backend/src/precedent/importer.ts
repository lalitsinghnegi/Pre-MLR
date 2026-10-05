import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { inArray } from 'drizzle-orm';
import { appendAudit } from '../audit/log.js';
import type { Db } from '../db/client.js';
import { precedentImports, precedents } from '../db/schema.js';
import { ValidationError } from '../errors.js';
import type { ColumnMapping } from './mapping.js';
import { normalizeRow, resolveColumns, type NormalizedPrecedent } from './normalize.js';
import { readTable } from './read.js';

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
  rowErrors: { row: number; errors: string[] }[];
  dryRun: boolean;
}

export const MIN_PSEUDONYM_KEY_LENGTH = 16;

/**
 * Imports historic MLR comments from .xlsx/.csv using a column mapping. Invalid rows are skipped and
 * reported (or, with strict, abort the import); rows already imported (same fingerprint, including
 * duplicates within the file) are skipped. Everything is written in one transaction.
 */
export async function importPrecedents(db: Db, opts: ImportOptions): Promise<ImportReport> {
  if (opts.pseudonymKey.length < MIN_PSEUDONYM_KEY_LENGTH) {
    throw new ValidationError(
      `PRECEDENT_PSEUDONYM_KEY must be set to a secret of at least ${MIN_PSEUDONYM_KEY_LENGTH} characters; reviewer names are never stored in clear.`,
    );
  }
  const table = await readTable(opts.file, opts.mapping.sheet);
  const cols = resolveColumns(table.headers, opts.mapping);

  const valid: { row: number; value: NormalizedPrecedent }[] = [];
  const rowErrors: ImportReport['rowErrors'] = [];
  for (const { rowNumber, cells } of table.rows) {
    const res = normalizeRow(cells, cols, opts.mapping, {
      pseudonymKey: opts.pseudonymKey,
      site: opts.site,
    });
    if (res.ok) valid.push({ row: rowNumber, value: res.value });
    else rowErrors.push({ row: rowNumber, errors: res.errors });
  }
  if (opts.strict && rowErrors.length) {
    const sample = rowErrors
      .slice(0, 5)
      .map((e) => `row ${e.row}: ${e.errors.join('; ')}`)
      .join('\n');
    throw new ValidationError(
      `${rowErrors.length} invalid row(s); nothing imported (strict):\n${sample}`,
      rowErrors,
    );
  }

  // Duplicates: already in the database, or repeated earlier in this file.
  const existing = new Set<string>();
  const prints = valid.map((v) => v.value.fingerprint);
  for (let i = 0; i < prints.length; i += 500) {
    const chunk = prints.slice(i, i + 500);
    for (const r of db
      .select({ f: precedents.fingerprint })
      .from(precedents)
      .where(inArray(precedents.fingerprint, chunk))
      .all()) {
      existing.add(r.f);
    }
  }
  const fresh: NormalizedPrecedent[] = [];
  for (const { value } of valid) {
    if (existing.has(value.fingerprint)) continue;
    existing.add(value.fingerprint);
    fresh.push(value);
  }

  const report: ImportReport = {
    importId: null,
    file: basename(opts.file),
    rowsTotal: table.rows.length,
    rowsImported: fresh.length,
    rowsSkipped: rowErrors.length,
    rowsDuplicate: valid.length - fresh.length,
    rowErrors,
    dryRun: !!opts.dryRun,
  };
  if (opts.dryRun) return report;

  const importId = randomUUID();
  const now = new Date().toISOString();
  const fileSha256 = createHash('sha256')
    .update(await readFile(opts.file))
    .digest('hex');
  db.transaction((tx) => {
    tx.insert(precedentImports)
      .values({
        id: importId,
        fileName: report.file,
        fileSha256,
        mapping: opts.mapping.name,
        site: opts.site,
        rowsTotal: report.rowsTotal,
        rowsImported: report.rowsImported,
        rowsSkipped: report.rowsSkipped,
        rowsDuplicate: report.rowsDuplicate,
        rowErrors,
        importedBy: opts.actor,
        createdAt: now,
      })
      .run();
    for (let i = 0; i < fresh.length; i += 200) {
      tx.insert(precedents)
        .values(
          fresh
            .slice(i, i + 200)
            .map((p) => ({ ...p, id: randomUUID(), importId, createdAt: now })),
        )
        .run();
    }
    appendAudit(tx, {
      entityType: 'precedent_import',
      entityId: importId,
      action: 'imported',
      changes: {
        rows: [
          null,
          {
            imported: report.rowsImported,
            skipped: report.rowsSkipped,
            duplicate: report.rowsDuplicate,
          },
        ],
      },
      actor: opts.actor,
      at: now,
    });
  });
  return { ...report, importId };
}
