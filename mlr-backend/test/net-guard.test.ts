import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BLOCKED_MESSAGE, isPrivateAddress, NetworkGuard } from '../src/net/guard.js';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b::10.0.0.1',
    'not-an-ip',
  ])('%s is private', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    '%s is public',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('NetworkGuard.checkUrl', () => {
  const dns: Record<string, string[]> = {
    'public.test': ['93.184.216.34'],
    'sneaky.test': ['93.184.216.34', '10.0.0.5'],
    'metadata.test': ['169.254.169.254'],
    'site.test': ['127.0.0.1'],
  };
  const guard = new NetworkGuard({
    allow: ['site.test:4100', '[::1]:9000'],
    resolve: async (h) => {
      if (!dns[h]) throw new Error('ENOTFOUND');
      return dns[h]!;
    },
  });

  it('allows public hosts and allowlisted host:ports only', async () => {
    expect(await guard.checkUrl('https://public.test/a')).toEqual({ ok: true });
    expect(await guard.checkUrl('http://site.test:4100/')).toEqual({ ok: true });
    expect(await guard.checkUrl('http://[::1]:9000/')).toEqual({ ok: true });
    for (const url of [
      'http://site.test:8000/', // same host, other port
      'http://metadata.test/latest/meta-data/',
      'http://sneaky.test/', // one private address is enough
      'http://127.0.0.1/',
      'http://[::1]:8000/',
      'http://169.254.169.254/',
      'http://0x7f000001/', // URL parsing normalizes this to 127.0.0.1
    ]) {
      expect(await guard.checkUrl(url), url).toEqual({
        ok: false,
        reason: 'private',
        message: BLOCKED_MESSAGE,
      });
    }
  });

  it('refuses other schemes and reports unresolvable hosts', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://public.test/', 'javascript:alert(1)']) {
      expect((await guard.checkUrl(url)).ok, url).toBe(false);
    }
    expect(await guard.checkUrl('http://nowhere.test/')).toMatchObject({
      ok: false,
      reason: 'unresolved',
    });
    expect(() => new NetworkGuard({ allow: ['bad entry:x'] })).toThrow(/Invalid allowlist entry/);
  });
});

describe('NetworkGuard.fetch', () => {
  let target: Server;
  let redirector: Server;
  let targetPort: number;
  let redirectorPort: number;

  beforeAll(async () => {
    target = createServer((_req, res) => res.end('secret'));
    redirector = createServer((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${targetPort}/` }).end();
    });
    await Promise.all(
      [target, redirector].map((s) => new Promise<void>((r) => s.listen(0, '127.0.0.1', r))),
    );
    targetPort = (target.address() as AddressInfo).port;
    redirectorPort = (redirector.address() as AddressInfo).port;
  });
  afterAll(() => {
    target.close();
    redirector.close();
  });

  const causeOf = (err: unknown) => (err as { cause?: Error }).cause?.message;

  it('refuses private addresses at connection time', async () => {
    const guard = new NetworkGuard();
    const err = await guard.fetch(`http://127.0.0.1:${targetPort}/`).catch((e: unknown) => e);
    expect(causeOf(err)).toBe(BLOCKED_MESSAGE);
    await guard.close();
  });

  it('checks every redirect hop, not just the first URL', async () => {
    const guard = new NetworkGuard({ allow: [`127.0.0.1:${redirectorPort}`] });
    const err = await guard.fetch(`http://127.0.0.1:${redirectorPort}/`).catch((e: unknown) => e);
    expect(causeOf(err)).toBe(BLOCKED_MESSAGE);
    await guard.close();
  });

  it('tries each checked address in turn (localhost may resolve to ::1 first)', async () => {
    const guard = new NetworkGuard({
      allow: [`dual.test:${targetPort}`],
      resolve: async () => ['::1', '127.0.0.1'], // the server listens on IPv4 only
    });
    const res = await guard.fetch(`http://dual.test:${targetPort}/`);
    expect(await res.text()).toBe('secret');
    await guard.close();
  });

  it('connects to the address it checked (no second DNS lookup)', async () => {
    // "pinned.test" exists only in this resolver; reaching the server proves the connection used it.
    const guard = new NetworkGuard({
      allow: [`pinned.test:${targetPort}`],
      resolve: async () => ['127.0.0.1'],
    });
    const res = await guard.fetch(`http://pinned.test:${targetPort}/`);
    expect(await res.text()).toBe('secret');
    await guard.close();
  });
});
