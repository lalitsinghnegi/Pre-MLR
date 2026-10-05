import { randomBytes } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import { connect as netConnect, type AddressInfo, type Socket } from 'node:net';
import type { NetworkGuard } from './guard.js';

/** Set on proxy responses that refused a private target, so the crawler can say why. */
export const BLOCKED_HEADER = 'x-pre-mlr-blocked';

export interface GuardProxy {
  /** e.g. "http://127.0.0.1:53211", for Playwright's `proxy.server`. */
  server: string;
  username: string;
  password: string;
  /** host:port targets refused so far (newest last). */
  blocked: string[];
  close(): Promise<void>;
}

/** "host:port" (IPv6 in brackets) → parts. */
function splitHostPort(target: string, defaultPort: number): { host: string; port: number } {
  const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(target) ?? /^([^:]+)(?::(\d+))?$/.exec(target);
  if (!m) throw new Error(`Bad proxy target "${target}"`);
  return { host: m[1]!, port: m[2] ? Number(m[2]) : defaultPort };
}

/** Connects to the first address that accepts, trying each in turn. */
function connectAny(addresses: string[], port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const attempt = (i: number) => {
      const socket = netConnect({ host: addresses[i]!, port });
      socket.once('connect', () => resolve(socket));
      socket.once('error', (err) => (i + 1 < addresses.length ? attempt(i + 1) : reject(err)));
    };
    attempt(0);
  });
}

/**
 * A local forward proxy for the crawler's browser. Every connection the browser makes (pages,
 * subresources, redirects, WebSockets) goes through it; each target is checked by the guard and the
 * connection pinned to the checked address, so DNS can't change in between. Because the browser
 * does its own TLS through the tunnel, sites see a normal browser (bot protection lets it in).
 * Bound to 127.0.0.1 and protected by a random password, so only our browser can use it.
 */
export async function startGuardProxy(guard: NetworkGuard): Promise<GuardProxy> {
  const username = 'crawler';
  const password = randomBytes(18).toString('base64url');
  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const blocked: string[] = [];
  // Tunnelled sockets outlive their HTTP requests; track them so close() can end them.
  const tunnels = new Set<Socket>();
  const track = (s: Socket) => {
    tunnels.add(s);
    s.once('close', () => tunnels.delete(s));
  };
  const authorized = (req: IncomingMessage) => req.headers['proxy-authorization'] === expected;

  const server = createServer(async (req, res) => {
    // Plain-http requests arrive with an absolute URL.
    if (!authorized(req)) {
      res.writeHead(407, { 'proxy-authenticate': 'Basic realm="crawler"' }).end();
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? '');
      if (url.protocol !== 'http:') throw new Error('not http');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const port = url.port ? Number(url.port) : 80;
    const addresses = await guard.addressesFor(url.hostname, port);
    if (!Array.isArray(addresses)) {
      blocked.push(`${url.hostname}:${port}`);
      res
        .writeHead(403, { [BLOCKED_HEADER]: '1', 'content-type': 'text/plain' })
        .end(addresses.message);
      return;
    }
    const headers = { ...req.headers };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    try {
      const socket = await connectAny(addresses, port);
      const upstream = httpRequest(
        {
          createConnection: () => socket,
          method: req.method,
          path: `${url.pathname}${url.search}`,
          headers,
        },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      upstream.on('error', () => (res.headersSent ? res.destroy() : res.writeHead(502).end()));
      req.pipe(upstream);
    } catch {
      res.writeHead(502).end();
    }
  });

  // HTTPS (and wss) arrive as CONNECT host:port tunnels.
  server.on('connect', async (req: IncomingMessage, client: Socket, head: Buffer) => {
    client.on('error', () => {});
    track(client);
    if (!authorized(req)) {
      client.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="crawler"\r\n\r\n',
      );
      return;
    }
    let target: { host: string; port: number };
    try {
      target = splitHostPort(req.url ?? '', 443);
    } catch {
      client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const addresses = await guard.addressesFor(target.host, target.port);
    if (!Array.isArray(addresses)) {
      blocked.push(`${target.host}:${target.port}`);
      client.end(`HTTP/1.1 403 Forbidden\r\n${BLOCKED_HEADER}: 1\r\n\r\n`);
      return;
    }
    try {
      const upstream = await connectAny(addresses, target.port);
      track(upstream);
      upstream.on('error', () => client.destroy());
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    } catch {
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    }
  });
  // Plain ws:// upgrades are refused (the crawler blocks WebSockets anyway).
  server.on('upgrade', (_req, socket: Socket) => socket.destroy());

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server: `http://127.0.0.1:${port}`,
    username,
    password,
    blocked,
    close: () =>
      new Promise((resolve) => {
        for (const s of tunnels) s.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
