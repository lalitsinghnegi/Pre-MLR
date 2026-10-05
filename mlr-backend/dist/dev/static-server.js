import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.pdf': 'application/pdf',
};
/**
 * Serves a fixture directory like a typical web server: "/x" maps to x.html, a directory without
 * a trailing slash redirects to "/x/", and "/x/" serves x/index.html. Unknown paths return a 404 page.
 */
export async function serveStatic(root, listenPort = 0) {
    const server = createServer(async (req, res) => {
        const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
        const file = await resolveFile(root, path);
        if (file === 'redirect') {
            res.writeHead(301, { location: `${path}/` }).end();
            return;
        }
        if (!file) {
            res.writeHead(404, { 'content-type': TYPES['.html'] }).end('<h1>Not found</h1>');
            return;
        }
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
        res.end(await readFile(file));
    });
    await new Promise((done) => server.listen(listenPort, '127.0.0.1', done));
    const { port } = server.address();
    return {
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
    };
}
async function resolveFile(root, path) {
    const base = join(root, path);
    if (!base.startsWith(root))
        return null;
    if (await isDir(base)) {
        if (!path.endsWith('/'))
            return 'redirect';
        return (await isFile(join(base, 'index.html'))) ? join(base, 'index.html') : null;
    }
    if (await isFile(base))
        return base;
    if (await isFile(`${base}.html`))
        return `${base}.html`;
    return null;
}
const isDir = (p) => stat(p).then((s) => s.isDirectory(), () => false);
const isFile = (p) => stat(p).then((s) => s.isFile(), () => false);
//# sourceMappingURL=static-server.js.map