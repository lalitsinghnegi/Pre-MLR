/**
 * Canonical form used for de-duplication: http(s) only, no fragment or credentials,
 * lower-case host and no default port (both handled by URL), no trailing slash except the root.
 * Returns null for unparseable or non-http(s) URLs.
 */
export declare function normalizeUrl(raw: string, base?: string): string | null;
/** Host plus port, ignoring a leading "www." so example.com and www.example.com count as one site. */
export declare function siteKey(url: string): string;
export declare function isSameSite(url: string, startUrl: string): boolean;
export declare function looksLikeHtml(url: string): boolean;
