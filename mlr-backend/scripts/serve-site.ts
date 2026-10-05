// Serves a static test site for demos: tsx scripts/serve-site.ts <dir> [port]
import { resolve } from 'node:path';
import { serveStatic } from '../src/dev/static-server.js';

const [dir, port = '4100'] = process.argv.slice(2);
if (!dir) {
  console.error('usage: tsx scripts/serve-site.ts <dir> [port]');
  process.exit(1);
}
const site = await serveStatic(resolve(dir), Number(port));
console.log(`Serving ${resolve(dir)} at ${site.url}/ (Ctrl+C to stop)`);
