export interface SiteMapPage {
    id: string;
    crawlIndex: number;
    url: string;
    parentPageId: string | null;
    title: string | null;
    httpStatus: number | null;
    error: string | null;
}
export interface SiteMapNode {
    page: SiteMapPage;
    /** 1-based number shown on the map; matches crawl order (and PDF page order). */
    number: number;
    label: string;
    /** Null when the label already is the path (page has no title). */
    path: string | null;
    broken: boolean;
    children: SiteMapNode[];
}
/**
 * Builds the parent→child tree from crawl data. The first crawled page is the root; pages whose
 * parent is missing are attached to the root. Children are ordered by crawl order.
 */
export declare function buildSiteTree(pages: SiteMapPage[]): SiteMapNode | null;
/**
 * Removes a site-name prefix or suffix shared by every title (e.g. "About | Examplin" → "About"),
 * split on a common separator. Titles that would become empty keep their original text.
 */
export declare function shortTitles(titles: (string | null)[]): (string | null)[];
export declare function displayPath(url: string): string;
export declare function truncate(s: string, max: number): string;
export declare function maxFanOut(node: SiteMapNode): number;
