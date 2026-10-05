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

const TITLE_SEPARATORS = [' | ', ' - ', ' – ', ' — ', ' :: ', ' · '];
const MAX_TITLE = 40;
const MAX_PATH = 48;

/**
 * Builds the parent→child tree from crawl data. The first crawled page is the root; pages whose
 * parent is missing are attached to the root. Children are ordered by crawl order.
 */
export function buildSiteTree(pages: SiteMapPage[]): SiteMapNode | null {
  const sorted = [...pages].sort((a, b) => a.crawlIndex - b.crawlIndex);
  if (sorted.length === 0) return null;

  const labels = shortTitles(sorted.map((p) => p.title));
  const nodes = new Map<string, SiteMapNode>();
  sorted.forEach((page, i) => {
    const path = displayPath(page.url);
    const title = labels[i];
    nodes.set(page.id, {
      page,
      number: i + 1,
      label: truncate(title || path, title ? MAX_TITLE : MAX_PATH),
      path: title ? truncate(path, MAX_PATH) : null,
      broken: page.error !== null || (page.httpStatus ?? 0) >= 400,
      children: [],
    });
  });

  const root = nodes.get(sorted[0]!.id)!;
  for (const page of sorted.slice(1)) {
    const parent = (page.parentPageId && nodes.get(page.parentPageId)) || root;
    parent.children.push(nodes.get(page.id)!);
  }
  return root;
}

/**
 * Removes a site-name prefix or suffix shared by every title (e.g. "About | Examplin" → "About"),
 * split on a common separator. Titles that would become empty keep their original text.
 */
export function shortTitles(titles: (string | null)[]): (string | null)[] {
  const present = titles.filter((t): t is string => !!t?.trim()).map((t) => t.trim());
  if (present.length < 2) return titles.map((t) => t?.trim() || null);

  const suffix = longestShared(present, (t) => separatorSplits(t).map((i) => t.slice(i)), 'end');
  const prefix = longestShared(
    present,
    (t) => separatorSplits(t).map((i) => t.slice(0, i + separatorAt(t, i)!.length)),
    'start',
  );

  return titles.map((raw) => {
    let t = raw?.trim();
    if (!t) return null;
    if (suffix && t.endsWith(suffix) && t.length > suffix.length) t = t.slice(0, -suffix.length);
    if (prefix && t.startsWith(prefix) && t.length > prefix.length) t = t.slice(prefix.length);
    return t.trim();
  });
}

function longestShared(
  titles: string[],
  candidates: (t: string) => string[],
  side: 'start' | 'end',
): string | null {
  const matches = (t: string, c: string) => (side === 'end' ? t.endsWith(c) : t.startsWith(c));
  const options = candidates(titles[0]!).sort((a, b) => b.length - a.length);
  return options.find((c) => titles.every((t) => matches(t, c))) ?? null;
}

/** Indices where a title separator starts. */
function separatorSplits(t: string): number[] {
  const out: number[] = [];
  for (const sep of TITLE_SEPARATORS) {
    for (let i = t.indexOf(sep); i !== -1; i = t.indexOf(sep, i + 1)) out.push(i);
  }
  return out;
}

function separatorAt(t: string, i: number): string | undefined {
  return TITLE_SEPARATORS.find((sep) => t.startsWith(sep, i));
}

export function displayPath(url: string): string {
  const u = new URL(url);
  return decodeURI(u.pathname) + u.search;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

export function maxFanOut(node: SiteMapNode): number {
  return Math.max(node.children.length, ...node.children.map(maxFanOut));
}
