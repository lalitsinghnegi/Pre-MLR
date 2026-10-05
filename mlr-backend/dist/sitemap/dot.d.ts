import type { SiteMapNode } from './tree.js';
export interface DotOptions {
    /** Shown above the map, e.g. the site host and page count. */
    caption?: string;
}
/** Graphviz DOT for the site tree: top-to-bottom, home at the top, one box per page. */
export declare function toDot(root: SiteMapNode, opts?: DotOptions): string;
