/**
 * Runs in the page (desktop view) and returns PageFacts. Kept as a plain JS string so no TS/esbuild
 * transform can inject helpers that don't exist in the browser (see EXTRACT_SCRIPT in crawler.ts).
 *
 * Text is grouped into "blocks" by nearest block-level ancestor. For each block we keep the
 * smallest font size and that text's colour and effective background (first non-transparent
 * ancestor background; background images and gradients are ignored). Boxes are document
 * coordinates, i.e. full-page screenshot pixels at deviceScaleFactor 1.
 */
export declare const FACTS_SCRIPT: string;
