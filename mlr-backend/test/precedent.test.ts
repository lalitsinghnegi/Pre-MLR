import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, precedentImports, precedents } from '../src/db/schema.js';
import { ValidationError } from '../src/errors.js';
import { importPrecedents, type ImportOptions } from '../src/precedent/importer.js';
import { loadMapping, type ColumnMapping } from '../src/precedent/mapping.js';
import { parseDate, pseudonymize, redact, resolveColumns } from '../src/precedent/normalize.js';
import { readTable } from '../src/precedent/read.js';
import { migratedDb } from './helpers/model.js';

const DATA = join(import.meta.dirname, '../../test-sites/precedent');
const XLSX = join(DATA, 'synthetic-mlr-comments.xlsx');
const CSV = join(DATA, 'synthetic-mlr-comments.csv');
const KEY = 'test-key-0123456789abcdef';
/** Every reviewer name in the synthetic data; none may reach the database. */
const NAMES = [
  'Dana Whitfield',
  'Priya Ramaswamy',
  'Tomas Lindqvist',
  'Jordan Reyes',
  'Hannah Okafor',
  'Marcus Bellamy',
  'Elena Petrova',
  'Samuel Achterberg',
  'Mei-Lin Zhou',
  'Chris Donnelly',
  'Aisha Karim',
  'Olivia Brandt',
];

let mapping: ColumnMapping;
beforeAll(async () => {
  mapping = await loadMapping('default');
});

const opts = (o: Partial<ImportOptions> = {}): ImportOptions => ({
  file: XLSX,
  mapping,
  site: 'examplin.test',
  pseudonymKey: KEY,
  actor: 'tester',
  ...o,
});

describe('parseDate', () => {
  const f: ColumnMapping['dateFormats'] = ['YYYY-MM-DD', 'MM/DD/YYYY'];
  it.each([
    ['2025-03-04', '2025-03-04'],
    ['2025-3-4', '2025-03-04'],
    ['03/04/2025', '2025-03-04'],
    ['2025-02-31', null],
    ['13/45/2025', null],
    ['yesterday', null],
  ])('%s → %s', (input, expected) => expect(parseDate(input, f)).toBe(expected));

  it('reads Date cells and Excel serial numbers', () => {
    expect(parseDate(new Date(Date.UTC(2025, 0, 5)), f)).toBe('2025-01-05');
    expect(parseDate(45662, f)).toBe('2025-01-05');
    expect(parseDate(null, f)).toBeNull();
  });

  it('respects day-first formats when configured', () => {
    expect(parseDate('03/04/2025', ['DD/MM/YYYY'])).toBe('2025-04-03');
    expect(parseDate('03.04.2025', ['DD.MM.YYYY'])).toBe('2025-04-03');
  });
});

describe('redact', () => {
  it('replaces emails and phone numbers', () => {
    expect(redact('Ask jordan.reyes@fictionalpharma.example or call +1 555-010-0199 today.')).toBe(
      'Ask [email] or call [phone] today.',
    );
    expect(redact('Office (020) 7946 0958.')).toBe('Office [phone].');
  });
  it('leaves dates, percentages and short numbers alone', () => {
    const text = 'Seen 2025-03-04 and 04.03.2025; 62% of 300 patients; v2; 1-800-FDA-1088.';
    expect(redact(text)).toBe(text);
  });
});

describe('pseudonymize', () => {
  it('is stable, ignores case and spacing, and depends on the key', () => {
    const a = pseudonymize('Dana Whitfield', KEY);
    expect(a).toMatch(/^Reviewer-[0-9A-F]{8}$/);
    expect(pseudonymize('  dana   WHITFIELD ', KEY)).toBe(a);
    expect(pseudonymize('Dana Whitfield', 'another-key-0123456789')).not.toBe(a);
    expect(pseudonymize('Priya Ramaswamy', KEY)).not.toBe(a);
    expect(a.toLowerCase()).not.toContain('dana');
  });
});

describe('resolveColumns', () => {
  it('names missing columns and lists the headers the file has', () => {
    expect(() =>
      resolveColumns(['Proof Name', 'Remark', 'Brand'], {
        ...mapping,
        columns: { commentText: 'Comment', date: 'Date', brand: 'Brand' },
      }),
    ).toThrow(
      /Columns not found: "Comment" \(commentText\), "Date" \(date\)\. The file has: "Proof Name", "Remark", "Brand"/,
    );
  });
  it('matches headers ignoring case and surrounding spaces', () => {
    expect(
      resolveColumns([' comment ', 'DATE', 'brand'], {
        ...mapping,
        columns: { commentText: 'Comment', date: 'Date', brand: 'Brand' },
      }),
    ).toEqual({ commentText: 0, date: 1, brand: 2 });
  });
});

describe('synthetic dataset', () => {
  it('has 150 rows of fictional brands, ~20% off-rule topics and the planted messy rows', async () => {
    const t = await readTable(XLSX, 'Comments');
    expect(t.rows).toHaveLength(150);
    const brand = t.headers.indexOf('Brand');
    expect(new Set(t.rows.map((r) => r.cells[brand]).filter(Boolean))).toEqual(
      new Set(['Examplin', 'Fictorex', 'Placebrin', 'Demovia']),
    );
    const labels: Record<string, string> = JSON.parse(
      await readFile(join(DATA, 'synthetic-mlr-comments.labels.json'), 'utf8'),
    );
    const values = Object.values(labels);
    expect(values.filter((l) => l === 'invalid')).toHaveLength(4);
    expect(values.filter((l) => l === 'duplicate')).toHaveLength(1);
    const offRule = values.filter((l) => l.startsWith('off_rule:')).length / 145;
    expect(offRule).toBeGreaterThan(0.15);
    expect(offRule).toBeLessThan(0.3);
  });

  it('is deterministic', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pre-mlr-gen-'));
    await promisify(execFile)('npx', ['tsx', 'scripts/generate-precedents.ts', '--out', dir], {
      cwd: join(import.meta.dirname, '..'),
    });
    for (const f of ['synthetic-mlr-comments.csv', 'synthetic-mlr-comments.labels.json']) {
      expect(await readFile(join(dir, f), 'utf8'), f).toBe(await readFile(join(DATA, f), 'utf8'));
    }
    await rm(dir, { recursive: true, force: true });
  }, 60_000);
});

describe('importPrecedents', () => {
  let tmp: string;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pre-mlr-prec-'));
  });
  afterAll(() => rm(tmp, { recursive: true, force: true }));

  it('imports valid rows, reports bad ones by row number and skips the duplicate', async () => {
    const db = migratedDb();
    const report = await importPrecedents(db, opts());
    expect(report).toMatchObject({
      rowsTotal: 150,
      rowsImported: 145,
      rowsDuplicate: 1,
      rowsSkipped: 4,
      dryRun: false,
    });
    expect(report.rowErrors).toEqual([
      { row: 21, errors: ['comment is empty'] },
      { row: 46, errors: [expect.stringMatching(/date "2025-02-31" is not a valid date/)] },
      { row: 81, errors: [expect.stringMatching(/status "Pending\?" is not in the mapping/)] },
      { row: 111, errors: ['brand is empty'] },
    ]);
    const first = db
      .select()
      .from(precedents)
      .where(eq(precedents.sourceCommentId, 'C-0001'))
      .get();
    expect(first).toMatchObject({
      site: 'examplin.test',
      brand: 'Placebrin',
      reviewerFunction: 'commercial',
      status: 'resolved',
      commentedAt: '2024-12-22',
      pageRef: '4',
      importId: report.importId,
      reviewerPseudonym: pseudonymize('Chris Donnelly', KEY),
    });
    expect(db.select().from(precedentImports).get()).toMatchObject({
      rowsImported: 145,
      mapping: 'default',
      importedBy: 'tester',
      fileName: 'synthetic-mlr-comments.xlsx',
    });
    expect(
      db.select().from(auditLog).where(eq(auditLog.entityType, 'precedent_import')).all(),
    ).toHaveLength(1);
  });

  it('never stores reviewer names, and redacts contact details', async () => {
    const db = migratedDb();
    await importPrecedents(db, opts());
    const everything =
      JSON.stringify(db.select().from(precedents).all()) +
      JSON.stringify(db.select().from(precedentImports).all());
    for (const name of NAMES) {
      for (const part of name.split(' ')) expect(everything, part).not.toContain(part);
    }
    expect(everything).not.toContain('@fictionalpharma.example');
    expect(everything).not.toContain('555-010-0199');
    expect(
      db
        .select()
        .from(precedents)
        .all()
        .filter((p) => p.commentText.includes('[email] or [phone]')),
    ).toHaveLength(3);
  });

  it('gives identical results from the .xlsx and the .csv', async () => {
    const a = migratedDb();
    const b = migratedDb();
    const ra = await importPrecedents(a, opts({ file: XLSX }));
    const rb = await importPrecedents(b, opts({ file: CSV }));
    expect({ ...rb, importId: null, file: null }).toEqual({ ...ra, importId: null, file: null });
    const strip = (
      rows: { fingerprint: string; reviewerPseudonym: string | null; commentedAt: string }[],
    ) => rows.map((r) => `${r.fingerprint}|${r.reviewerPseudonym}|${r.commentedAt}`).sort();
    expect(strip(b.select().from(precedents).all())).toEqual(
      strip(a.select().from(precedents).all()),
    );
  });

  it('re-importing adds nothing; dry runs and strict failures write nothing', async () => {
    const db = migratedDb();
    expect(await importPrecedents(db, opts({ dryRun: true }))).toMatchObject({
      rowsImported: 145,
      importId: null,
      dryRun: true,
    });
    expect(db.select().from(precedents).all()).toHaveLength(0);
    await expect(importPrecedents(db, opts({ strict: true }))).rejects.toThrow(
      /4 invalid row\(s\); nothing imported/,
    );
    expect(db.select().from(precedentImports).all()).toHaveLength(0);
    await importPrecedents(db, opts());
    expect(await importPrecedents(db, opts({ file: CSV }))).toMatchObject({
      rowsImported: 0,
      rowsDuplicate: 146,
    });
    expect(db.select().from(precedents).all()).toHaveLength(145);
  });

  it('refuses to run without a pseudonym key', async () => {
    await expect(importPrecedents(migratedDb(), opts({ pseudonymKey: '' }))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('supports other export layouts through a mapping file (site column, day-first dates, unknown function → other)', async () => {
    const csv = [
      'Remark,When,Product,Who,Role,State,Website',
      '"Add ISI to the page.",31/01/2025,Demovia,Kim Example,Pharmacovigilance,Done,demovia.test',
      '"Typo in heading.",01/02/2025,Demovia,Kim Example,Medical,Done,demovia.test',
    ].join('\n');
    await writeFile(join(tmp, 'other.csv'), csv);
    await writeFile(
      join(tmp, 'other.yaml'),
      [
        'name: other-tool',
        'columns: { commentText: Remark, date: When, brand: Product, reviewer: Who, reviewerFunction: Role, status: State, site: Website }',
        'dateFormats: [DD/MM/YYYY]',
        'values: { status: { Done: resolved }, reviewerFunction: { Medical: medical } }',
      ].join('\n'),
    );
    const db = migratedDb();
    const report = await importPrecedents(
      db,
      opts({
        file: join(tmp, 'other.csv'),
        mapping: await loadMapping(join(tmp, 'other.yaml')),
        site: null,
      }),
    );
    expect(report).toMatchObject({ rowsImported: 2, rowsSkipped: 0 });
    expect(
      db
        .select()
        .from(precedents)
        .all()
        .map((p) => [p.commentedAt, p.reviewerFunction, p.status, p.site]),
    ).toEqual([
      ['2025-01-31', 'other', 'resolved', 'demovia.test'],
      ['2025-02-01', 'medical', 'resolved', 'demovia.test'],
    ]);
  });

  it('explains a missing column', async () => {
    await writeFile(join(tmp, 'bad.csv'), 'Note,Date,Brand\nx,2025-01-01,Examplin\n');
    await expect(
      importPrecedents(migratedDb(), opts({ file: join(tmp, 'bad.csv') })),
    ).rejects.toThrow(/"Comment" \(commentText\)[\s\S]*The file has: "Note", "Date", "Brand"/);
  });
});
