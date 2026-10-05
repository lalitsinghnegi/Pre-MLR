/** File extensions that are never HTML pages; links to them are recorded but not crawled. */
const NON_HTML_EXTENSIONS =
  /\.(pdf|jpe?g|png|gif|svg|webp|avif|ico|bmp|tiff?|zip|gz|rar|7z|docx?|xlsx?|pptx?|csv|txt|xml|json|rss|atom|css|js|mjs|map|woff2?|ttf|otf|eot|mp3|mp4|m4a|wav|ogg|webm|mov|avi)$/i;

/**
 * Canonical form used for de-duplication: http(s) only, no fragment or credentials,
 * lower-case host and no default port (both handled by URL), no trailing slash except the root.
 * Returns null for unparseable or non-http(s) URLs.
 */
export function normalizeUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.username = '';
  url.password = '';
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  }
  return url.toString();
}

/** Host plus port, ignoring a leading "www." so example.com and www.example.com count as one site. */
export function siteKey(url: string): string {
  return new URL(url).host.replace(/^www\./, '');
}

export function isSameSite(url: string, startUrl: string): boolean {
  return siteKey(url) === siteKey(startUrl);
}

export function looksLikeHtml(url: string): boolean {
  return !NON_HTML_EXTENSIONS.test(new URL(url).pathname);
}
