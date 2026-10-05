// Imports historic MLR comments: npm run precedent:import -w mlr-backend -- --file <x.xlsx|x.csv> [--site host]
//   [--mapping default|path.yaml] [--dry-run] [--strict] [--actor name]
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { importPrecedents } from '../src/precedent/importer.js';
import { loadMapping } from '../src/precedent/mapping.js';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    site: { type: 'string' },
    mapping: { type: 'string', default: 'default' },
    'dry-run': { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
    actor: { type: 'string', default: process.env.USER ?? 'cli' },
  },
});

try {
  if (!values.file) throw new Error('--file is required');
  const config = loadConfig();
  const db = createDb(config.DATABASE_URL);
  runMigrations(db);
  const report = await importPrecedents(db, {
    file: resolve(values.file),
    mapping: await loadMapping(values.mapping),
    site: values.site ?? null,
    pseudonymKey: config.PRECEDENT_PSEUDONYM_KEY,
    actor: values.actor,
    dryRun: values['dry-run'],
    strict: values.strict,
  });
  db.$client.close();
  console.log(
    `${report.dryRun ? '[dry run] ' : ''}${report.file}: ${report.rowsTotal} rows, ${report.rowsImported} ${report.dryRun ? 'would be ' : ''}imported, ${report.rowsDuplicate} duplicate, ${report.rowsSkipped} skipped`,
  );
  for (const e of report.rowErrors) console.log(`  row ${e.row}: ${e.errors.join('; ')}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
