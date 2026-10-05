/** Page details captured by the crawler in the desktop view (coordinates are desktop screenshot px). */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** RGBA, 0–255 channels and 0–1 alpha. */
export type Rgba = [number, number, number, number];

export interface TextBlock {
  text: string;
  tag: string;
  /** 1–6 for h1–h6 / role="heading", else null. */
  headingLevel: number | null;
  /** Landmark the block sits in (<header>, <nav>, <footer> or their ARIA roles), else null. */
  region: 'header' | 'nav' | 'footer' | null;
  box: Box;
  /** Smallest font size (px) among the block's text. */
  fontSize: number;
  fontWeight: number;
  /** Colours of the smallest text in the block. Background ignores images and gradients. */
  color: Rgba;
  background: Rgba;
  /** Block contains a <sup> (e.g. a reference marker). */
  hasSup: boolean;
}

export interface ImageFact {
  src: string;
  /** null when the alt attribute is missing (alt="" is decorative). */
  alt: string | null;
  role: string | null;
  ariaHidden: boolean;
  box: Box;
}

export interface PageFacts {
  blocks: TextBlock[];
  images: ImageFact[];
  /** True if the page had more blocks than the crawler records. */
  truncated: boolean;
}
