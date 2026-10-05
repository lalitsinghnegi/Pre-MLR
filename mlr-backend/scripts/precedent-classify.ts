// Classifies imported precedent comments against the rule pack's categories:
//   npm run precedent:classify -w mlr-backend -- [--provider mock|anthropic] [--model id] [--force]
//     [--batch-size 20] [--labels answer-key.json] [--yes] [--max-cost-usd 2]
// Uses LLM_PROVIDER / LLM_MODEL from .env unless overridden. Paid providers need --yes.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { checkSpend } from '../src/eval/guard.js';
import { createProvider } from '../src/llm/factory.js';
import {
  CLASSIFY_PROMPT_VERSION,
  classifierRules,
  classifyPrecedents,
  estimateClassificationCost,
  pendingPrecedents,
  rulePackHash,
} from '../src/precedent/classify.js';
import { scoreClassifications } from '../src/precedent/score.js';
import { loadPrompts } from '../src/llm/prompt.js';
import { syncRulePack } from '../src/rules/pack.js';

const { values } = parseArgs({
  options: {
    provider: { type: 'string' },
    model: { type: 'string' },
    force: { type: 'boolean', default: false },
    'batch-size': { type: 'string', default: '20' },
    labels: { type: 'string' },
    yes: { type: 'boolean', default: false },
    'max-cost-usd': { type: 'string', default: '2' },
    actor: { type: 'string', default: process.env.USER ?? 'cli' },
  },
});

try {
  const config = loadConfig({
    ...process.env,
    ...(values.provider ? { LLM_PROVIDER: values.provider } : {}),
    ...(values.model ? { LLM_MODEL: values.model } : {}),
  });
  const provider = createProvider(config);
  if (!provider) {
    throw new Error('No LLM provider: pass --provider mock|anthropic or set LLM_PROVIDER in .env.');
  }
  const batchSize = Number(values['batch-size']);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error('--batch-size must be an integer from 1 to 100');
  }
  const db = createDb(config.DATABASE_URL);
  runMigrations(db);
  if (config.RULE_PACK_DIR) await syncRulePack(db, config.RULE_PACK_DIR);

  const prompts = await loadPrompts(CLASSIFY_PROMPT_VERSION, 'precedent-classification');
  const { pending } = pendingPrecedents(
    db,
    {
      provider: provider.name,
      model: provider.model,
      promptVersion: prompts.version,
      rulePackHash: rulePackHash(classifierRules(db)),
    },
    values.force,
  );
  if (provider.name === 'anthropic' && pending.length) {
    const refusal = checkSpend(
      {
        paidModels: [provider.model],
        estimateUsd: estimateClassificationCost(provider.model, pending.length, batchSize),
      },
      {
        yes: values.yes,
        maxCostUsd: Number(values['max-cost-usd']),
        sends: `${pending.length} historic comment(s); use fictional or approved data only`,
      },
    );
    if (refusal) throw new Error(refusal);
  }

  const result = await classifyPrecedents(db, {
    provider,
    actor: values.actor,
    force: values.force,
    batchSize,
    concurrency: config.LLM_CONCURRENCY,
  });
  console.log(
    `${provider.name}:${provider.model} (prompt ${result.promptVersion}, rule pack ${result.rulePackHash}): ` +
      `${result.total} comments, ${result.upToDate} already current, ${result.classified} classified ` +
      `(${result.noMatchingRule} with no matching rule), ${result.failed} failed, ` +
      `${result.requests} request(s), $${result.costUsd.toFixed(4)}`,
  );

  if (values.labels) {
    const labels = JSON.parse(await readFile(resolve(values.labels), 'utf8')) as Record<
      string,
      string
    >;
    const s = scoreClassifications(db, labels);
    console.log(
      `Against ${values.labels}: accuracy ${(s.accuracy * 100).toFixed(1)}% (${s.correct}/${s.scored}), ` +
        `no-match precision ${(s.noMatchPrecision * 100).toFixed(1)}%, recall ${(s.noMatchRecall * 100).toFixed(1)}%, ${s.failed} failed`,
    );
    for (const m of s.mistakes.slice(0, 20)) {
      console.log(`  ${m.sourceCommentId}: expected ${m.expected}, got ${m.got} – ${m.text}`);
    }
  }
  db.$client.close();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
