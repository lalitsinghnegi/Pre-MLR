import { type SiteMapPage } from './tree.js';
export interface SiteMapOptions {
    caption?: string;
}
/** Renders the site map as SVG, or null if there are no pages. */
export declare function renderSiteMapSvg(pages: SiteMapPage[], opts?: SiteMapOptions): Promise<string | null>;
/** Rasterises an SVG to PNG at `scale`× (reduced if the result would exceed MAX_PNG_WIDTH). */
export declare function svgToPng(svg: string, scale?: number): Buffer;
