import { createRequire } from 'node:module';
const pkg = createRequire(import.meta.url)('../package.json');
export const version = pkg.version;
//# sourceMappingURL=version.js.map