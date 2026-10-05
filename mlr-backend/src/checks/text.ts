import type { Box, Rgba, TextBlock } from '@pre-mlr/shared';
import { normalizeUrl } from '../crawler/url.js';
import type { CheckPage } from './types.js';

/** A text block, or a line of plain page text for pages crawled without facts (no styles/box). */
export type CheckBlock = Pick<TextBlock, 'text' | 'headingLevel' | 'region' | 'hasSup'> &
  Partial<Pick<TextBlock, 'box' | 'fontSize' | 'fontWeight' | 'color' | 'background'>>;

export function blocksOf(page: CheckPage): CheckBlock[] {
  if (page.facts) return page.facts.blocks;
  return (page.text ?? '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text) => ({ text, headingLevel: null, region: null, hasSup: false }));
}

/** Pages that loaded fine and whose path isn't excluded. */
export function pagesInScope(pages: CheckPage[], excludePaths: string[]): CheckPage[] {
  return pages.filter(
    (p) => !p.error && (p.httpStatus ?? 200) < 400 && !isExcluded(p.url, excludePaths),
  );
}

/**
 * Exclusion patterns match the URL path, ignoring case, a trailing ".html"/".htm" and trailing
 * slash: "/privacy" matches /privacy, /privacy.html and /privacy/anything; "/legal*" is a prefix.
 */
export function isExcluded(url: string, patterns: string[]): boolean {
  const path =
    new URL(url).pathname
      .toLowerCase()
      .replace(/\.html?$/, '')
      .replace(/\/+$/, '') || '/';
  return patterns.some((raw) => {
    const p = raw.toLowerCase().replace(/\/+$/, '') || '/';
    if (p.endsWith('*')) return path.startsWith(p.slice(0, -1));
    return path === p || path.startsWith(`${p}/`);
  });
}

/** A short block containing one of the headings (case-insensitive). */
export function isHeadingMatch(block: CheckBlock, headings: string[]): boolean {
  if (block.text.length > 100) return false;
  const text = block.text.toLowerCase();
  return headings.some((h) => text.includes(h.toLowerCase()));
}

/**
 * The blocks of the section headed by one of `headings`: from the heading to the next heading of
 * the same or higher level, or to where the landmark region changes (e.g. into the site footer).
 * Returns null if no heading matches.
 */
export function findSection(blocks: CheckBlock[], headings: string[]): CheckBlock[] | null {
  const start = blocks.findIndex((b) => isHeadingMatch(b, headings));
  if (start === -1) return null;
  const head = blocks[start]!;
  let end = start + 1;
  for (; end < blocks.length; end++) {
    const b = blocks[end]!;
    if (b.region !== head.region) break;
    if (
      head.headingLevel !== null &&
      b.headingLevel !== null &&
      b.headingLevel <= head.headingLevel
    )
      break;
  }
  return blocks.slice(start, end);
}

/** Blocks outside the given sections and regions. */
export function blocksOutside(
  blocks: CheckBlock[],
  sectionHeadings: string[],
  regions: string[],
): CheckBlock[] {
  const section = sectionHeadings.length
    ? new Set(findSection(blocks, sectionHeadings) ?? [])
    : new Set();
  return blocks.filter((b) => !section.has(b) && !(b.region && regions.includes(b.region)));
}

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Case-insensitive match of a phrase not glued to letters/digits; spaces match any whitespace. */
export function phraseRegex(phrase: string): RegExp {
  const body = phrase
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu');
}

export function truncate(s: string, max = 300): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** WCAG 2.x contrast ratio; a translucent foreground is blended over the background. */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const a = fg[3];
  const blended = [0, 1, 2].map((i) => fg[i]! * a + bg[i]! * (1 - a));
  const l1 = luminance(blended);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Desktop-screenshot location for a block, when the page has facts. */
export function locationOf(block: CheckBlock | undefined) {
  const box: Box | undefined = block?.box;
  return box && box.width > 0 && box.height > 0 ? { view: 'desktop' as const, ...box } : null;
}

/** First block containing the text (case-insensitive), for locating link evidence. */
export function findBlockContaining(blocks: CheckBlock[], needle: string): CheckBlock | undefined {
  const n = needle.trim().toLowerCase();
  return n.length >= 2 ? blocks.find((b) => b.text.toLowerCase().includes(n)) : undefined;
}

/** http(s) links on a page, normalized and de-duplicated by URL. */
export function httpLinks(page: CheckPage): { url: string; text: string }[] {
  const seen = new Map<string, string>();
  for (const l of page.links) {
    const url = normalizeUrl(l.href);
    if (url && !seen.has(url)) seen.set(url, l.text);
  }
  return [...seen].map(([url, text]) => ({ url, text }));
}
