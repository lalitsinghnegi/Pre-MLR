import type { Rgba, TextBlock } from '@pre-mlr/shared';
import type { CheckPage } from './types.js';
/** A text block, or a line of plain page text for pages crawled without facts (no styles/box). */
export type CheckBlock = Pick<TextBlock, 'text' | 'headingLevel' | 'region' | 'hasSup'> & Partial<Pick<TextBlock, 'box' | 'fontSize' | 'fontWeight' | 'color' | 'background'>>;
export declare function blocksOf(page: CheckPage): CheckBlock[];
/** Pages that loaded fine and whose path isn't excluded. */
export declare function pagesInScope(pages: CheckPage[], excludePaths: string[]): CheckPage[];
/**
 * Exclusion patterns match the URL path, ignoring case, a trailing ".html"/".htm" and trailing
 * slash: "/privacy" matches /privacy, /privacy.html and /privacy/anything; "/legal*" is a prefix.
 */
export declare function isExcluded(url: string, patterns: string[]): boolean;
/** A short block containing one of the headings (case-insensitive). */
export declare function isHeadingMatch(block: CheckBlock, headings: string[]): boolean;
/**
 * The blocks of the section headed by one of `headings`: from the heading to the next heading of
 * the same or higher level, or to where the landmark region changes (e.g. into the site footer).
 * Returns null if no heading matches.
 */
export declare function findSection(blocks: CheckBlock[], headings: string[]): CheckBlock[] | null;
/** Blocks outside the given sections and regions. */
export declare function blocksOutside(blocks: CheckBlock[], sectionHeadings: string[], regions: string[]): CheckBlock[];
export declare function sentences(text: string): string[];
/** Case-insensitive match of a phrase not glued to letters/digits; spaces match any whitespace. */
export declare function phraseRegex(phrase: string): RegExp;
export declare function truncate(s: string, max?: number): string;
/** WCAG 2.x contrast ratio; a translucent foreground is blended over the background. */
export declare function contrastRatio(fg: Rgba, bg: Rgba): number;
/** Desktop-screenshot location for a block, when the page has facts. */
export declare function locationOf(block: CheckBlock | undefined): {
    x: number;
    y: number;
    width: number;
    height: number;
    view: "desktop";
} | null;
/** First block containing the text (case-insensitive), for locating link evidence. */
export declare function findBlockContaining(blocks: CheckBlock[], needle: string): CheckBlock | undefined;
/** http(s) links on a page, normalized and de-duplicated by URL. */
export declare function httpLinks(page: CheckPage): {
    url: string;
    text: string;
}[];
