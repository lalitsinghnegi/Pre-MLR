import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';

/** Shown wherever a request is refused because it targets an internal address. */
export const BLOCKED_MESSAGE = 'Blocked: private network address';

/** Address ranges a scan must never reach: loopback, private, link-local/metadata, reserved. */
const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. broadcast
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128],
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

/** True for addresses inside any blocked range, including IPv4 embedded in IPv6 forms. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return PRIVATE.check(ip, 'ipv4');
  if (family !== 6) return true; // not an IP at all: refuse
  const lower = ip.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible and NAT64 (64:ff9b::a.b.c.d) addresses.
  const embedded = /^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
  if (embedded) return PRIVATE.check(embedded, 'ipv4');
  const hexMapped = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hexMapped) {
    const n = (parseInt(hexMapped[1]!, 16) << 16) | parseInt(hexMapped[2]!, 16);
    return PRIVATE.check([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'), 'ipv4');
  }
  return PRIVATE.check(ip, 'ipv6');
}

export type UrlCheck =
  { ok: true } | { ok: false; reason: 'scheme' | 'private' | 'unresolved'; message: string };

const defaultPort = (protocol: string) => (protocol === 'https:' ? 443 : 80);

/**
 * Decides which hosts scans may reach. Public addresses are allowed; private ones only when the
 * exact host[:port] is on the allowlist (e.g. a local test site). Hostnames are resolved and every
 * resolved address must be public.
 */
export class NetworkGuard {
  private readonly allow: { host: string; port: number | null }[];
  private readonly resolve: (host: string) => Promise<string[]>;

  constructor(
    opts: {
      /** "host" or "host:port" entries that may be private (e.g. "localhost:4100"). */
      allow?: string[];
      /** DNS lookup, replaceable in tests. */
      resolve?: (host: string) => Promise<string[]>;
    } = {},
  ) {
    this.allow = (opts.allow ?? []).map(parseAllowEntry);
    this.resolve =
      opts.resolve ??
      (async (host) =>
        (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address));
  }

  isAllowlisted(hostname: string, port: number): boolean {
    const host = stripBrackets(hostname).toLowerCase();
    return this.allow.some((a) => a.host === host && (a.port === null || a.port === port));
  }

  /** The public addresses of a host, or why it must not be contacted. */
  async addressesFor(
    hostname: string,
    port: number,
  ): Promise<string[] | (UrlCheck & { ok: false })> {
    const host = stripBrackets(hostname);
    if (this.isAllowlisted(host, port)) return isIP(host) ? [host] : await this.resolve(host);
    let addresses: string[];
    try {
      addresses = isIP(host) ? [host] : await this.resolve(host);
    } catch {
      return { ok: false, reason: 'unresolved', message: `Could not resolve ${host}` };
    }
    if (!addresses.length || addresses.some(isPrivateAddress)) {
      return { ok: false, reason: 'private', message: BLOCKED_MESSAGE };
    }
    return addresses;
  }

  /** Whether a URL may be requested: http(s) only, and a public (or allowlisted) host. */
  async checkUrl(raw: string): Promise<UrlCheck> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { ok: false, reason: 'scheme', message: 'Invalid URL' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        ok: false,
        reason: 'scheme',
        message: `Blocked: ${url.protocol} URLs are not allowed`,
      };
    }
    const port = url.port ? Number(url.port) : defaultPort(url.protocol);
    const result = await this.addressesFor(url.hostname, port);
    return Array.isArray(result) ? { ok: true } : result;
  }

  /**
   * fetch whose connections are checked when they open (so every redirect hop is covered) and
   * pinned to the checked address (so DNS can't change between the check and the connection).
   */
  readonly fetch: typeof fetch = (input, init) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher: this.dispatcher,
    }) as unknown as Promise<Response>;

  private readonly dispatcher = new Agent({
    connect: (opts, callback) => {
      const port = opts.port ? Number(opts.port) : defaultPort(opts.protocol);
      this.addressesFor(opts.hostname, port).then(
        (result) => {
          if (!Array.isArray(result)) return callback(new Error(result.message), null);
          const hostname = stripBrackets(opts.hostname);
          const servername = opts.servername || (isIP(hostname) ? undefined : hostname);
          // Try each checked address in turn (e.g. localhost is ::1 and 127.0.0.1), never others.
          const attempt = (i: number) =>
            connect(
              // Keep TLS verification and SNI on the real name, not the pinned address.
              { ...opts, hostname: result[i]!, servername },
              (err, socket) => {
                if (err && i + 1 < result.length) return attempt(i + 1);
                return err ? callback(err, null) : callback(null, socket!);
              },
            );
          attempt(0);
        },
        (err: unknown) => callback(err instanceof Error ? err : new Error(String(err)), null),
      );
    },
  });

  close(): Promise<void> {
    return this.dispatcher.close();
  }
}

const connect = buildConnector({});

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function parseAllowEntry(entry: string): { host: string; port: number | null } {
  const e = entry.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(e);
  if (bracketed) return { host: bracketed[1]!, port: bracketed[2] ? Number(bracketed[2]) : null };
  const m = /^([^:]+)(?::(\d+))?$/.exec(e);
  if (!m) throw new Error(`Invalid allowlist entry "${entry}" (use host or host:port)`);
  return { host: m[1]!, port: m[2] ? Number(m[2]) : null };
}
