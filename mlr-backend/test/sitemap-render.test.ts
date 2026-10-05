import { describe, expect, it } from 'vitest';
import { renderSiteMapSvg, svgToPng } from '../src/sitemap/render.js';
import { sampleSite, sp } from './helpers/sitemap-pages.js';

/** Top y of each node's first text line, keyed by crawl index (SVG y grows downward). */
function nodeYs(svg: string): Map<number, number> {
  const ys = new Map<number, number>();
  for (const m of svg.matchAll(
    /<g id="page(?:-|&#45;)(\d+)" class="node">[\s\S]*?<text[^>]* y="([\d.-]+)"/g,
  )) {
    ys.set(Number(m[1]), Number(m[2]));
  }
  return ys;
}

const pngWidth = (png: Buffer) => png.readUInt32BE(16);

describe('renderSiteMapSvg', () => {
  it('returns null when there are no pages', async () => {
    expect(await renderSiteMapSvg([])).toBeNull();
  });

  it('renders every page with readable labels, home at the top', async () => {
    const svg = (await renderSiteMapSvg(sampleSite(), { caption: 'example.com · 6 pages' }))!;
    expect(svg).toMatch(/^<\?xml[\s\S]*<svg/);
    for (const label of [
      '1. Home',
      '2. About',
      '3. Products',
      '4. Widget',
      '5. Gadget',
      '6. /products/old',
    ]) {
      expect(svg).toContain(`>${label}</text>`);
    }
    expect(svg).toContain('example.com · 6 pages');
    expect(svg).toContain('HTTP 404');

    const y = nodeYs(svg);
    expect(y.size).toBe(6);
    const home = y.get(0)!;
    expect([...y.entries()].filter(([i]) => i !== 0).every(([, v]) => v > home)).toBe(true);
    expect(y.get(3)!).toBeGreaterThan(y.get(2)!); // widget below products
    expect(y.get(1)).toBe(y.get(2)); // siblings share a row
  });

  it('staggers very wide levels over several rows', async () => {
    const pages = [sp({ id: 'r', crawlIndex: 0 })];
    for (let i = 1; i <= 24; i++) pages.push(sp({ id: `c${i}`, crawlIndex: i, parentPageId: 'r' }));
    const y = nodeYs((await renderSiteMapSvg(pages))!);
    const childRows = new Set([...y.entries()].filter(([i]) => i !== 0).map(([, v]) => v));
    expect(childRows.size).toBeGreaterThan(1);
    expect(Math.min(...childRows)).toBeGreaterThan(y.get(0)!);
  });
});

describe('svgToPng', () => {
  it('produces a 2x PNG by default', async () => {
    const svg = (await renderSiteMapSvg(sampleSite()))!;
    const svgWidthPt = Number(svg.match(/<svg width="([\d.]+)pt"/)![1]);
    const png = svgToPng(svg);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    // Graphviz sizes in pt; resvg renders 1pt = 4/3 px.
    expect(pngWidth(png)).toBeCloseTo(svgWidthPt * (4 / 3) * 2, -1);
  });

  it('scales huge maps down to a maximum width', async () => {
    const pages = [sp({ id: 'r', crawlIndex: 0 })];
    for (let i = 1; i <= 120; i++)
      pages.push(sp({ id: `w${i}`, crawlIndex: i, parentPageId: 'r', title: `Page ${i}` }));
    const png = svgToPng((await renderSiteMapSvg(pages))!);
    expect(pngWidth(png)).toBeLessThanOrEqual(8000);
  });
});
