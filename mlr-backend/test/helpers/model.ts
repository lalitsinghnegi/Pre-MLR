import type { RuleVersionInput } from '@pre-mlr/shared';
import { createDb, runMigrations, type Db } from '../../src/db/client.js';
import { pages, scans } from '../../src/db/schema.js';

export function migratedDb(): Db {
  const db = createDb(':memory:');
  runMigrations(db);
  return db;
}

export function ruleInput(overrides: Partial<RuleVersionInput> = {}): RuleVersionInput {
  return {
    ruleId: 'isi-presence',
    version: 1,
    title: 'Important Safety Information is present',
    description: 'Every product page shows the ISI.',
    category: 'safety_information',
    severity: 'critical',
    checkType: 'deterministic',
    sourceCitation: '21 CFR 202.1(e)',
    sourceUrl: 'https://www.ecfr.gov/current/title-21/section-202.1',
    params: { headings: ['Important Safety Information'] },
    origin: 'test',
    ...overrides,
  };
}

/** Inserts a queued scan with two pages; returns their ids. */
export function seedScan(db: Db, scanId = 'scan-1') {
  const now = new Date().toISOString();
  db.insert(scans)
    .values({
      id: scanId,
      startUrl: 'https://examplin.test/',
      maxPages: 5,
      maxDepth: 1,
      status: 'running',
      createdAt: now,
    })
    .run();
  const pageIds = [`${scanId}-home`, `${scanId}-about`];
  db.insert(pages)
    .values(
      pageIds.map((id, i) => ({
        id,
        scanId,
        crawlIndex: i,
        url: `https://examplin.test/${i ? 'about' : ''}`,
        depth: i,
        parentPageId: i ? pageIds[0] : null,
        crawledAt: now,
      })),
    )
    .run();
  return { scanId, homeId: pageIds[0]!, aboutId: pageIds[1]! };
}
