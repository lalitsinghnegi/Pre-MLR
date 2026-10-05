import { randomUUID } from 'node:crypto';
import type { Db } from '../../src/db/client.js';
import { precedentClassifications, precedentImports, precedents } from '../../src/db/schema.js';
import type { Embedder } from '../../src/precedent/embed.js';

export interface SeedPrecedent {
  id?: string;
  text: string;
  /** Rule category, or null for "no matching rule". */
  category: string | null;
  brand?: string;
  site?: string | null;
  commentedAt?: string;
  reviewerFunction?: string | null;
  status?: string | null;
}

/** Inserts classified precedents directly (no file import); returns their ids. */
export function seedPrecedents(db: Db, items: SeedPrecedent[]): string[] {
  const now = new Date().toISOString();
  const importId = randomUUID();
  db.insert(precedentImports)
    .values({
      id: importId,
      fileName: 'seed.csv',
      fileSha256: 'x',
      mapping: 'default',
      site: null,
      rowsTotal: items.length,
      rowsImported: items.length,
      rowsSkipped: 0,
      rowsDuplicate: 0,
      rowErrors: [],
      importedBy: 'tester',
      createdAt: now,
    })
    .run();
  const ids = items.map((p) => p.id ?? randomUUID());
  items.forEach((p, i) => {
    db.insert(precedents)
      .values({
        id: ids[i]!,
        importId,
        site: p.site === undefined ? 'examplin.test' : p.site,
        brand: p.brand ?? 'Examplin',
        commentText: p.text,
        reviewerPseudonym: 'Reviewer-0000ABCD',
        reviewerFunction: p.reviewerFunction === undefined ? 'medical' : p.reviewerFunction,
        status: p.status === undefined ? 'resolved' : p.status,
        commentedAt: p.commentedAt ?? '2026-06-01',
        fingerprint: randomUUID(),
        createdAt: now,
      })
      .run();
    db.insert(precedentClassifications)
      .values({
        precedentId: ids[i]!,
        status: 'ok',
        category: p.category,
        ruleId: null,
        confidence: 0.9,
        noMatchingRule: p.category === null,
        topic: 'seed',
        provider: 'mock',
        model: 'mock-1',
        promptVersion: 'v1#seed',
        rulePackHash: 'seed',
        classifiedBy: 'tester',
        classifiedAt: now,
      })
      .run();
  });
  return ids;
}

/** Embeds by lookup: texts matching a key get its vector, anything else the default. */
export class TableEmbedder implements Embedder {
  readonly id = 'table-v1';
  readonly minSimilarity = 0.5;
  readonly calls: string[][] = [];
  constructor(
    private readonly table: [RegExp, number[]][],
    private readonly fallback = [1, 0, 0],
  ) {}
  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push(texts);
    return texts.map((t) => this.table.find(([re]) => re.test(t))?.[1] ?? this.fallback);
  }
}
