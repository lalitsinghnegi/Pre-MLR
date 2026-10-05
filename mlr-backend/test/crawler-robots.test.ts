import { describe, expect, it, vi } from 'vitest';
import { readCapped, RobotsCache } from '../src/crawler/robots.js';

const robotsResponse = (body: string, status = 200) =>
  vi.fn().mockResolvedValue(new Response(body, { status }));

describe('RobotsCache', () => {
  it('applies Disallow rules for the crawler user agent', async () => {
    const robots = new RobotsCache(
      'PreMLRChecker',
      robotsResponse('User-agent: *\nDisallow: /private/'),
    );
    expect(await robots.isAllowed('https://example.com/private/x')).toBe(false);
    expect(await robots.isAllowed('https://example.com/public')).toBe(true);
  });

  it('honours rules aimed at our user agent specifically', async () => {
    const robots = new RobotsCache(
      'PreMLRChecker',
      robotsResponse('User-agent: PreMLRChecker\nDisallow: /\n\nUser-agent: *\nAllow: /'),
    );
    expect(await robots.isAllowed('https://example.com/any')).toBe(false);
  });

  it('allows everything when robots.txt is missing or unreachable', async () => {
    expect(
      await new RobotsCache('PreMLRChecker', robotsResponse('', 404)).isAllowed('https://a.com/x'),
    ).toBe(true);
    const failing = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await new RobotsCache('PreMLRChecker', failing).isAllowed('https://a.com/x')).toBe(true);
  });

  it('fetches robots.txt once per origin', async () => {
    const fetchImpl = robotsResponse('User-agent: *\nAllow: /');
    const robots = new RobotsCache('PreMLRChecker', fetchImpl);
    await robots.isAllowed('https://example.com/a');
    await robots.isAllowed('https://example.com/b');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/robots.txt', expect.anything());
  });
});

describe('readCapped', () => {
  it('reads at most the cap and stops downloading', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new TextEncoder().encode('Disallow: /x\n'.repeat(100)));
      },
    });
    const text = await readCapped(new Response(body), 1000);
    expect(text).toHaveLength(1000);
    expect(pulled).toBeLessThan(5);
    expect(await readCapped(new Response('short'), 1000)).toBe('short');
  });
});
