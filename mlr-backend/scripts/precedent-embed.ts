// Embeds every imported precedent comment ahead of time (and downloads the local model on first
// use), so the first scan doesn't wait for it:
//   npm run precedent:embed -w mlr-backend [-- --embeddings local|hash]
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { precedents } from '../src/db/schema.js';
import { createEmbedder } from '../src/precedent/embed.js';
import { ensureEmbeddings } from '../src/precedent/retrieve.js';

const { values } = parseArgs({ options: { embeddings: { type: 'string' } } });

try {
  const config = loadConfig({
    ...process.env,
    ...(values.embeddings ? { EMBEDDINGS: values.embeddings } : {}),
  });
  const embedder = createEmbedder(config);
  if (!embedder) throw new Error('EMBEDDINGS=none: precedent matching is turned off.');
  const db = createDb(config.DATABASE_URL);
  runMigrations(db);
  const all = db.select({ id: precedents.id, text: precedents.commentText }).from(precedents).all();
  const started = Date.now();
  const embedded = await ensureEmbeddings(db, embedder, all);
  db.$client.close();
  console.log(
    `${embedder.id}: ${all.length} comments, ${embedded} newly embedded in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
