const TITLE_SEPARATORS = [' | ', ' - ', ' – ', ' — ', ' :: ', ' · '];
const MAX_TITLE = 40;
const MAX_PATH = 48;
/**
 * Builds the parent→child tree from crawl data. The first crawled page is the root; pages whose
 * parent is missing are attached to the root. Children are ordered by crawl order.
 */
export function buildSiteTree(pages) {
    const sorted = [...pages].sort((a, b) => a.crawlIndex - b.crawlIndex);
    if (sorted.length === 0)
        return null;
    const labels = shortTitles(sorted.map((p) => p.title));
    const nodes = new Map();
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
    const root = nodes.get(sorted[0].id);
    for (const page of sorted.slice(1)) {
        const parent = (page.parentPageId && nodes.get(page.parentPageId)) || root;
        parent.children.push(nodes.get(page.id));
    }
    return root;
}
/**
 * Removes a site-name prefix or suffix shared by every title (e.g. "About | Examplin" → "About"),
 * split on a common separator. Titles that would become empty keep their original text.
 */
export function shortTitles(titles) {
    const present = titles.filter((t) => !!t?.trim()).map((t) => t.trim());
    if (present.length < 2)
        return titles.map((t) => t?.trim() || null);
    const suffix = longestShared(present, (t) => separatorSplits(t).map((i) => t.slice(i)), 'end');
    const prefix = longestShared(present, (t) => separatorSplits(t).map((i) => t.slice(0, i + separatorAt(t, i).length)), 'start');
    return titles.map((raw) => {
        let t = raw?.trim();
        if (!t)
            return null;
        if (suffix && t.endsWith(suffix) && t.length > suffix.length)
            t = t.slice(0, -suffix.length);
        if (prefix && t.startsWith(prefix) && t.length > prefix.length)
            t = t.slice(prefix.length);
        return t.trim();
    });
}
function longestShared(titles, candidates, side) {
    const matches = (t, c) => (side === 'end' ? t.endsWith(c) : t.startsWith(c));
    const options = candidates(titles[0]).sort((a, b) => b.length - a.length);
    return options.find((c) => titles.every((t) => matches(t, c))) ?? null;
}
/** Indices where a title separator starts. */
function separatorSplits(t) {
    const out = [];
    for (const sep of TITLE_SEPARATORS) {
        for (let i = t.indexOf(sep); i !== -1; i = t.indexOf(sep, i + 1))
            out.push(i);
    }
    return out;
}
function separatorAt(t, i) {
    return TITLE_SEPARATORS.find((sep) => t.startsWith(sep, i));
}
export function displayPath(url) {
    const u = new URL(url);
    return decodeURI(u.pathname) + u.search;
}
export function truncate(s, max) {
    return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}
export function maxFanOut(node) {
    return Math.max(node.children.length, ...node.children.map(maxFanOut));
}
//# sourceMappingURL=tree.js.map