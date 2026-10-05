import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDeterministicChecks } from '../src/checks/run.js';
import { LocalEmbedder, type Extractor } from '../src/precedent/embed.js';
import { readTable } from '../src/precedent/read.js';
import { createRuleVersion, snapshotScanRules } from '../src/rules/repository.js';
import { migratedDb, ruleInput, seedScan } from './helpers/model.js';

describe('a broken rule does not stop the scan', () => {
  it('skips rules with an unknown check or invalid params, and reports them', async () => {
    const db = migratedDb();
    createRuleVersion(
      db,
      ruleInput({ ruleId: 'mystery', params: { check: 'no-such-check' } }),
      'test',
    );
    createRuleVersion(
      db,
      ruleInput({ ruleId: 'bad-params', params: { check: 'phrase-list', phrases: 'nope' } }),
      'test',
    );
    createRuleVersion(
      db,
      ruleInput({
        ruleId: 'fine',
        params: { check: 'phrase-list', label: 'Words', phrases: ['miracle'] },
      }),
      'test',
    );
    const { scanId } = seedScan(db);
    snapshotScanRules(db, scanId);
    const result = await runDeterministicChecks(db, scanId, {
      log: pino({ level: 'silent' }),
      fetchImpl: async () => new Response(''),
    });
    expect(result.ruleErrors.map((e) => e.ruleId).sort()).toEqual(['bad-params', 'mystery']);
    expect(result.ruleErrors.find((e) => e.ruleId === 'mystery')!.error).toBe(
      'unknown check "no-such-check"',
    );
    expect(result.ruleErrors.find((e) => e.ruleId === 'bad-params')!.error).toMatch(
      /^invalid params/,
    );
  });
});

describe('precedent file reading', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pre-mlr-read-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('refuses unsupported file types and missing sheets', async () => {
    await writeFile(join(dir, 'x.txt'), 'hello');
    await expect(readTable(join(dir, 'x.txt'))).rejects.toThrow(/Unsupported file type ".txt"/);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Comments').addRow(['Comment']);
    await wb.xlsx.writeFile(join(dir, 'one.xlsx'));
    await expect(readTable(join(dir, 'one.xlsx'), 'Other')).rejects.toThrow(
      /Worksheet "Other" not found \(sheets: Comments\)/,
    );
  });

  it('reads rich text, hyperlinks, formulas and blank rows as plain values', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Comments');
    ws.addRow(['Comment', 'Link', 'Total', 'Flag']);
    ws.addRow([
      { richText: [{ text: 'Bold ' }, { text: 'claim' }] },
      { text: 'PI link', hyperlink: 'https://example.com' },
      { formula: '1+1', result: 2 },
      true,
    ]);
    ws.addRow([null, null, null, null]);
    ws.addRow(['  padded  ', null, null, null]);
    await wb.xlsx.writeFile(join(dir, 'cells.xlsx'));
    const table = await readTable(join(dir, 'cells.xlsx'));
    expect(table.headers).toEqual(['Comment', 'Link', 'Total', 'Flag']);
    expect(table.rows).toEqual([
      { rowNumber: 2, cells: ['Bold claim', 'PI link', '2', 'true'] },
      { rowNumber: 4, cells: ['padded', null, null, null] },
    ]);
  });
});

describe('LocalEmbedder (with a fake model, nothing downloaded)', () => {
  const fakeModel = () => {
    const calls: string[][] = [];
    const extractor: Extractor = async (texts) => {
      calls.push(texts);
      return { tolist: () => texts.map((t) => [t.length, 1]) };
    };
    return { calls, extractor };
  };

  it('embeds in batches and loads the model once, lazily', async () => {
    const { calls, extractor } = fakeModel();
    let loads = 0;
    const e = new LocalEmbedder('m', '/tmp/models', 2, async () => {
      loads++;
      return extractor;
    });
    expect(e.id).toBe('local:m#q8');
    expect(await e.embed([])).toEqual([]);
    expect(loads).toBe(0);
    expect(await e.embed(['a', 'bb', 'ccc', 'dddd', 'e'])).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
      [1, 1],
    ]);
    expect(calls).toEqual([['a', 'bb'], ['ccc', 'dddd'], ['e']]);
    await e.embed(['x']);
    expect(loads).toBe(1);
  });

  it('retries loading after a failed download', async () => {
    const { extractor } = fakeModel();
    let attempt = 0;
    const e = new LocalEmbedder('m', '/tmp/models', 8, async () => {
      if (++attempt === 1) throw new Error('network down');
      return extractor;
    });
    await expect(e.embed(['a'])).rejects.toThrow('network down');
    expect(await e.embed(['a'])).toEqual([[1, 1]]);
  });
});
