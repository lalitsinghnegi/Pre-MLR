// Model evaluation harness: npm run eval -w mlr-backend -- [--models a,b] [--runs N] [--yes] [--max-cost-usd 5]
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import pino from 'pino';
import { checkSpend, estimateSpend } from '../src/eval/guard.js';
import { runEval } from '../src/eval/harness.js';
import { DEFAULT_MODELS_FILE, loadModels, selectModels } from '../src/eval/models.js';
import { consoleTable, markdownReport } from '../src/eval/report.js';

const ROOT = join(import.meta.dirname, '../..');
const { values } = parseArgs({
  options: {
    models: { type: 'string' },
    runs: { type: 'string', default: '1' },
    yes: { type: 'boolean', default: false },
    'max-cost-usd': { type: 'string', default: '5' },
    'models-file': { type: 'string', default: DEFAULT_MODELS_FILE },
    site: { type: 'string', default: join(ROOT, 'test-sites/examplin') },
    'out-dir': { type: 'string', default: join(ROOT, 'eval-results') },
    concurrency: { type: 'string', default: '2' },
  },
});

// Configuration errors (bad flags, unknown model ids, invalid models.yaml) print a message, not a stack.
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const runs = Number(values.runs);
const maxCostUsd = Number(values['max-cost-usd']);
if (!Number.isInteger(runs) || runs < 1) fail('--runs must be a positive integer');
if (!(maxCostUsd >= 0)) fail('--max-cost-usd must be a number');
let models;
try {
  models = selectModels(
    await loadModels(values['models-file']),
    values.models?.split(',').map((s) => s.trim()),
  );
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

// Pages analysed per run on Examplin: 8 crawled minus /privacy (excluded). Used only for the estimate.
const estimate = estimateSpend(models, 7, runs);
const refusal = checkSpend(estimate, { yes: values.yes, maxCostUsd });
if (refusal) fail(refusal);
if (estimate.paidModels.length)
  console.log(
    `Paid models: ${estimate.paidModels.join(', ')} (estimate ~$${estimate.estimateUsd ?? '?'}; budget $${maxCostUsd}).`,
  );

const result = await runEval({
  siteDir: values.site,
  expectedFile: join(values.site, 'expected-findings.yaml'),
  models,
  runs,
  maxCostUsd,
  concurrency: Number(values.concurrency),
  log: pino({ level: 'warn' }),
  onProgress: (m) => console.log(m),
});

const stamp = result.startedAt.replace(/[:.]/g, '-').slice(0, 19);
await mkdir(values['out-dir'], { recursive: true });
const md = join(values['out-dir'], `eval-${stamp}.md`);
await writeFile(md, markdownReport(result));
await writeFile(join(values['out-dir'], `eval-${stamp}.json`), JSON.stringify(result, null, 2));
console.log(`\n${consoleTable(result)}\n`);
if (result.stoppedEarly) console.log(result.stoppedEarly);
console.log(`Total spend $${result.totalCostUsd.toFixed(4)}. Report: ${md}`);
