import { describe, expect, it } from 'vitest';
import { toDot } from '../src/sitemap/dot.js';
import { buildSiteTree, shortTitles, type SiteMapNode } from '../src/sitemap/tree.js';
import { sampleSite, sp } from './helpers/sitemap-pages.js';

const shape = (n: SiteMapNode): unknown => ({ [n.page.id]: n.children.map(shape) });

describe('buildSiteTree', () => {
  it('returns null for no pages', () => {
    expect(buildSiteTree([])).toBeNull();
  });

  it('builds the parent→child hierarchy rooted at the first crawled page, children in crawl order', () => {
    const shuffled = sampleSite().reverse();
    expect(shape(buildSiteTree(shuffled)!)).toEqual({
      home: [{ about: [] }, { products: [{ widget: [] }, { gadget: [] }, { broken: [] }] }],
    });
  });

  it('numbers nodes in crawl order and strips the shared site-name suffix', () => {
    const root = buildSiteTree(sampleSite())!;
    expect(root).toMatchObject({ number: 1, label: 'Home', path: '/' });
    expect(root.children[1]!.children[0]).toMatchObject({
      number: 4,
      label: 'Widget',
      path: '/products/widget',
    });
  });

  it('labels untitled pages by path only, and flags broken pages', () => {
    const broken = buildSiteTree(sampleSite())!.children[1]!.children[2]!;
    expect(broken).toMatchObject({ label: '/products/old', path: null, broken: true });
  });

  it('attaches pages with an unknown parent to the root', () => {
    const root = buildSiteTree([
      sp({ id: 'home', crawlIndex: 0 }),
      sp({ id: 'orphan', crawlIndex: 1, parentPageId: 'gone' }),
      sp({ id: 'parentless', crawlIndex: 2 }),
    ])!;
    expect(root.children.map((c) => c.page.id)).toEqual(['orphan', 'parentless']);
  });

  it('truncates long titles', () => {
    const root = buildSiteTree([sp({ id: 'a', crawlIndex: 0, title: 'x'.repeat(80) })])!;
    expect(root.label).toHaveLength(40);
    expect(root.label.endsWith('…')).toBe(true);
  });
});

describe('shortTitles', () => {
  it.each([
    [
      ['Home | Examplin', 'About | Examplin'],
      ['Home', 'About'],
    ],
    [
      ['Examplin – Home', 'Examplin – About'],
      ['Home', 'About'],
    ],
    [
      ['A - B | Brand | Corp', 'C | Brand | Corp'],
      ['A - B', 'C'],
    ],
    [
      ['Home', 'About'],
      ['Home', 'About'],
    ],
    [['Only one | Site'], ['Only one | Site']],
    [
      ['Site', 'About | Site'],
      ['Site', 'About | Site'],
    ], // " | Site" isn't on every title
    [
      ['Pre | X', null, 'Post | X'],
      ['Pre', null, 'Post'],
    ],
  ])('%j → %j', (input, expected) => {
    expect(shortTitles(input)).toEqual(expected);
  });
});

describe('toDot', () => {
  it('emits one node per page and one edge per parent link', () => {
    const dot = toDot(buildSiteTree(sampleSite())!);
    expect(dot.match(/^\s+p\d+ \[/gm)).toHaveLength(6);
    expect(dot.match(/->/g)).toHaveLength(5);
    expect(dot).toContain('p0 -> p2;');
    expect(dot).toContain('p2 -> p3;');
    expect(dot).toContain('rankdir=TB');
  });

  it('styles the home page and broken pages', () => {
    const dot = toDot(buildSiteTree(sampleSite())!);
    expect(dot).toMatch(/p0 \[[^\n]*penwidth=2/);
    const broken = dot.split('\n').find((l) => l.trim().startsWith('p5 ['))!;
    expect(broken).toContain('dashed');
    expect(broken).toContain('HTTP 404');
  });

  it('escapes titles and URLs', () => {
    const dot = toDot(
      buildSiteTree([
        sp({
          id: 'x',
          crawlIndex: 0,
          title: '<b>"Tricky" & co</b>',
          url: 'https://example.com/a"b',
        }),
      ])!,
      { caption: 'Map <1>' },
    );
    expect(dot).toContain('&lt;b&gt;&quot;Tricky&quot; &amp; co&lt;/b&gt;');
    expect(dot).toContain('label=<Map &lt;1&gt;>');
    expect(dot).toContain('URL="https://example.com/a\\"b"');
    expect(dot).toContain('tooltip="<b>\\"Tricky\\" & co</b>"');
  });
});
