import type { PageFacts, ProductProfile, TextBlock } from '@pre-mlr/shared';
import type { CheckContext, CheckPage, LinkStatus } from '../../src/checks/types.js';
import { normalizeUrl } from '../../src/crawler/url.js';

let y = 0;
/** A text block with readable defaults (16px, black on white); boxes stack vertically. */
export function block(text: string, overrides: Partial<TextBlock> = {}): TextBlock {
  y += 40;
  return {
    text,
    tag: overrides.headingLevel ? `h${overrides.headingLevel}` : 'p',
    headingLevel: null,
    region: null,
    box: { x: 100, y, width: 800, height: 24 },
    fontSize: 16,
    fontWeight: 400,
    color: [0, 0, 0, 1],
    background: [255, 255, 255, 1],
    hasSup: false,
    ...overrides,
  };
}

export function facts(blocks: TextBlock[], images: PageFacts['images'] = []): PageFacts {
  return { blocks, images, truncated: false };
}

export function page(id: string, overrides: Partial<CheckPage> = {}): CheckPage {
  const f = overrides.facts;
  return {
    id,
    url: `https://examplin.test/${id === 'home' ? '' : id}`,
    title: id,
    text: f ? f.blocks.map((b) => b.text).join('\n') : '',
    links: [],
    facts: null,
    httpStatus: 200,
    error: null,
    ...overrides,
  };
}

export function ctx(
  pages: CheckPage[],
  opts: { product?: ProductProfile; links?: Record<string, LinkStatus> } = {},
): CheckContext {
  const links = new Map(Object.entries(opts.links ?? {}).map(([u, s]) => [normalizeUrl(u)!, s]));
  return { pages, product: opts.product ?? null, link: (u) => links.get(normalizeUrl(u) ?? '') };
}

export const ISI = 'Important Safety Information';
