const FONT = 'Helvetica';
const COLORS = {
    border: '#8c959f',
    rootFill: '#ddf4ff',
    rootBorder: '#0969da',
    fill: '#ffffff',
    muted: '#57606a',
    errorFill: '#fff5f5',
    errorBorder: '#cf222e',
    edge: '#8c959f',
};
/** Graphviz DOT for the site tree: top-to-bottom, home at the top, one box per page. */
export function toDot(root, opts = {}) {
    const lines = [
        'digraph sitemap {',
        '  graph [rankdir=TB, nodesep=0.25, ranksep=0.5, pad=0.3, bgcolor="white"' +
            (opts.caption
                ? `, label=<${html(opts.caption)}>, labelloc=t, labeljust=l, fontname="${FONT}", fontsize=16`
                : '') +
            '];',
        `  node [shape=box, style="rounded,filled", fontname="${FONT}", fontsize=12, margin="0.15,0.08", color="${COLORS.border}", fillcolor="${COLORS.fill}"];`,
        `  edge [color="${COLORS.edge}", arrowsize=0.6];`,
    ];
    const visit = (node, isRoot) => {
        lines.push(`  ${nodeId(node)} [${nodeAttrs(node, isRoot)}];`);
        for (const child of node.children) {
            lines.push(`  ${nodeId(node)} -> ${nodeId(child)};`);
            visit(child, false);
        }
    };
    visit(root, true);
    lines.push('}');
    return lines.join('\n');
}
const nodeId = (n) => `p${n.page.crawlIndex}`;
function nodeAttrs(node, isRoot) {
    const rows = [`<B>${html(`${node.number}. ${node.label}`)}</B>`];
    if (node.path)
        rows.push(`<FONT POINT-SIZE="10" COLOR="${COLORS.muted}">${html(node.path)}</FONT>`);
    if (node.broken) {
        const status = node.page.httpStatus && node.page.httpStatus >= 400
            ? `HTTP ${node.page.httpStatus}`
            : 'Failed to load';
        rows.push(`<FONT POINT-SIZE="10" COLOR="${COLORS.errorBorder}">${status}</FONT>`);
    }
    const attrs = {
        id: `"page-${node.page.crawlIndex}"`,
        label: `<${rows.join('<BR/>')}>`,
        tooltip: quote(node.page.title ?? node.page.url),
        URL: quote(node.page.url),
        target: '"_blank"',
    };
    if (isRoot) {
        Object.assign(attrs, {
            fillcolor: `"${COLORS.rootFill}"`,
            color: `"${COLORS.rootBorder}"`,
            penwidth: '2',
        });
    }
    if (node.broken) {
        Object.assign(attrs, {
            style: '"rounded,filled,dashed"',
            fillcolor: `"${COLORS.errorFill}"`,
            color: `"${COLORS.errorBorder}"`,
        });
    }
    return Object.entries(attrs)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
}
/** Escapes text for a Graphviz HTML-like label. */
function html(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/[\r\n]+/g, ' ');
}
/** Double-quoted DOT string. */
function quote(s) {
    return `"${s
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/[\r\n]+/g, ' ')}"`;
}
//# sourceMappingURL=dot.js.map