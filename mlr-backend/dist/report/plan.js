const PAGE_SIZES = {
    Letter: { width: 1056, height: 816 }, // 11 × 8.5 in, landscape
    A4: { width: 1123, height: 794 }, // 297 × 210 mm, landscape
};
export function layoutFor(pageSize) {
    const page = PAGE_SIZES[pageSize];
    const margin = { top: 36, right: 40, bottom: 52, left: 40 };
    // A couple of px of slack so rounding never pushes a page's content onto an extra PDF page.
    const content = {
        width: page.width - margin.left - margin.right,
        height: page.height - margin.top - margin.bottom - 4,
    };
    const headingHeight = 64;
    const panelWidth = 260;
    const gap = 16;
    return {
        page,
        margin,
        content,
        headingHeight,
        panelWidth,
        gap,
        shot: { width: content.width - panelWidth - gap, height: content.height - headingHeight - gap },
    };
}
const COLUMNS = { desktop: 1, mobile: 2 };
/** A screenshot up to this much taller than one slice is shrunk onto one page instead of split. */
const SINGLE_PAGE_TOLERANCE = 1.25;
export function planReport(pageSize, pages, siteWide = []) {
    const layout = layoutFor(pageSize);
    const out = [
        { kind: 'title', pdfPage: 1 },
        { kind: 'sitemap', pdfPage: 2 },
        { kind: 'summary', pdfPage: 3 },
    ];
    const sorted = [...pages].sort((a, b) => a.number - b.number);
    const shots = [];
    const addView = (view) => {
        const captured = sorted.filter((p) => p[view]);
        const from = out.length + 1;
        captured.forEach((page, i) => {
            const image = page[view];
            const { scale, pdfPages } = sliceImage(image, COLUMNS[view], layout);
            const panels = distributePanels(page, pdfPages.length, layout);
            pdfPages.forEach((columns, part) => {
                const shot = {
                    kind: 'screenshot',
                    pdfPage: out.length + 1,
                    view,
                    page,
                    image,
                    index: i + 1,
                    total: captured.length,
                    part: part + 1,
                    parts: pdfPages.length,
                    columns,
                    scale,
                    panel: panels[part],
                };
                out.push(shot);
                shots.push(shot);
            });
        });
        return captured.length ? { from, to: out.length } : null;
    };
    const desktop = addView('desktop');
    const mobile = addView('mobile');
    // Appendix: every included finding in full, site-wide first, then by page.
    const groups = [
        ...(siteWide.length ? [{ key: 'site', label: 'Site-wide', findings: siteWide }] : []),
        ...sorted
            .filter((p) => p.findings.length)
            .map((p) => ({ key: p.id, label: pageLabel(p), findings: p.findings })),
    ];
    const appendixPages = paginateAppendix(groups, layout);
    const appendixFrom = out.length + 1;
    const startPageOf = new Map();
    appendixPages.forEach((items, i) => {
        const pdfPage = out.length + 1;
        for (const item of items) {
            if (item.kind === 'group' && !item.continued)
                startPageOf.set(item.key, pdfPage);
        }
        out.push({
            kind: 'appendix',
            pdfPage,
            items: items.map(stripKey),
            part: i + 1,
            parts: appendixPages.length,
        });
    });
    for (const shot of shots) {
        if (shot.panel.moreCount)
            shot.panel.moreRef = startPageOf.get(shot.page.id) ?? null;
    }
    return {
        pageSize,
        layout,
        pages: out,
        sections: {
            title: 1,
            sitemap: 2,
            summary: 3,
            desktop,
            mobile,
            appendix: appendixPages.length ? { from: appendixFrom, to: out.length } : null,
        },
        notCaptured: sorted.filter((p) => !p.desktop && !p.mobile),
    };
}
export function pageLabel(p) {
    const path = new URL(p.url).pathname;
    return `#${p.number} ${path}${p.title ? ` · ${p.title}` : ''}`;
}
// ---------------------------------------------------------------------------------------------
// Text-height estimates. The HTML clips text with the same limits (see clip), uses these font
// sizes and line heights, and the per-line character counts are deliberately low so estimates err
// on the tall side: content may leave space at the bottom of a page but never runs off it.
export const PANEL = {
    lineHeight: 13,
    charsPerLine: 38,
    titleCharsPerLine: 32,
    header: 22,
    padding: 24,
    findingGap: 10,
    overflowNote: 34,
    empty: 20,
    clip: { tip: 420, evidence: 140, fix: 170, comment: 110, precedent: 110 },
    /** Most past comments shown per page. */
    precedents: 2,
};
export const APPENDIX = {
    lineHeight: 14,
    charsPerLine: 140,
    heading: 44,
    group: 28,
    findingGap: 12,
    clip: 1200,
};
/** Truncates to `max` characters with an ellipsis (the HTML uses the same function). */
export function clip(text, max) {
    const t = (text ?? '').replace(/\s+/g, ' ').trim();
    return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
/** Lines needed for text with greedy word wrap at `perLine` characters (long words break). */
export function wrapLines(text, perLine) {
    if (!text)
        return 0;
    let lines = 1;
    let used = 0;
    for (const word of text.split(' ')) {
        let w = word.length;
        if (used > 0 && used + 1 + w > perLine) {
            lines++;
            used = 0;
        }
        while (w > perLine) {
            lines++;
            w -= perLine;
        }
        used += (used > 0 ? 1 : 0) + w;
    }
    return lines;
}
const fixOf = (f) => f.editedFix ?? f.suggestedFix;
export function panelFindingHeight(f) {
    const lh = PANEL.lineHeight;
    const cpl = PANEL.charsPerLine;
    let h = lh + wrapLines(f.ruleTitle, PANEL.titleCharsPerLine) * lh; // badge line + title
    h += lh; // decision
    if (f.evidence)
        h += wrapLines(`“${clip(f.evidence, PANEL.clip.evidence)}”`, cpl) * lh;
    if (fixOf(f))
        h += wrapLines(`Fix: ${clip(fixOf(f), PANEL.clip.fix)}`, cpl) * lh;
    if (f.comment)
        h += wrapLines(`Comment: ${clip(f.comment, PANEL.clip.comment)}`, cpl) * lh;
    return h + PANEL.findingGap;
}
export function panelTipHeight(tip) {
    return (PANEL.lineHeight * (1 + wrapLines(clip(tip, PANEL.clip.tip), PANEL.charsPerLine)) +
        PANEL.findingGap);
}
/** One past-feedback line, as printed (the HTML uses this function too). */
export function precedentLine(p) {
    const meta = [
        p.reviewerFunction && p.reviewerFunction.charAt(0).toUpperCase() + p.reviewerFunction.slice(1),
        p.brand,
        p.commentedAt.slice(0, 7),
        p.outcome,
    ].filter(Boolean);
    return `“${clip(p.text, PANEL.clip.precedent)}” (${meta.join(', ')})`;
}
export function panelPrecedentsHeight(list) {
    if (!list.length)
        return 0;
    const lh = PANEL.lineHeight;
    return (lh + // heading
        list.reduce((h, p) => h + wrapLines(precedentLine(p), PANEL.charsPerLine) * lh, 0) +
        PANEL.findingGap);
}
/** Splits a page's tip and findings across its screenshot parts; leftovers go to the appendix. */
export function distributePanels(page, parts, layout) {
    const capacity = layout.shot.height - PANEL.padding - PANEL.header;
    const queue = [...page.findings];
    const panels = [];
    let shown = 0;
    for (let part = 0; part < parts; part++) {
        const showTip = part === 0 && !!page.tip;
        const shownPrecedents = part === 0 ? (page.precedents ?? []).slice(0, PANEL.precedents) : [];
        let free = capacity - (showTip ? panelTipHeight(page.tip) : 0) - panelPrecedentsHeight(shownPrecedents);
        const last = part === parts - 1;
        const taken = [];
        while (queue.length) {
            const h = panelFindingHeight(queue[0]);
            // On the last part, keep room for the overflow note if anything would be left over.
            const reserve = last && queue.length > 1 ? PANEL.overflowNote : 0;
            if (h + reserve > free)
                break;
            free -= h;
            taken.push(queue.shift());
        }
        if (last && queue.length && free < PANEL.overflowNote && taken.length) {
            queue.unshift(taken.pop()); // make room for the note
        }
        panels.push({
            showTip,
            showPrecedents: shownPrecedents.length > 0,
            findings: taken,
            continued: shown > 0,
            moreCount: last ? queue.length : 0,
            moreRef: null,
        });
        shown += taken.length;
    }
    return panels;
}
export function appendixFindingHeight(f) {
    const lh = APPENDIX.lineHeight;
    const cpl = APPENDIX.charsPerLine;
    const field = (label, text) => text ? wrapLines(`${label}: ${clip(text, APPENDIX.clip)}`, cpl) * lh : 0;
    return (lh * 2 + // label/severity/rule line + decision line
        field('Finding', f.message) +
        field('Evidence', f.evidence) +
        field('Suggested fix', f.suggestedFix) +
        field("Author's fix", f.editedFix) +
        field('Comment', f.comment) +
        field('Source', f.citation) +
        APPENDIX.findingGap);
}
const stripKey = (i) => i.kind === 'group' ? { kind: 'group', label: i.label, continued: i.continued } : i;
function paginateAppendix(groups, layout) {
    const capacity = layout.content.height - APPENDIX.heading;
    const pagesOut = [];
    let current = [];
    let free = capacity;
    const newPage = () => {
        if (current.length)
            pagesOut.push(current);
        current = [];
        free = capacity;
    };
    for (const g of groups) {
        let started = false;
        for (const f of g.findings) {
            const h = appendixFindingHeight(f);
            const needsHeader = !started || current.length === 0;
            if ((needsHeader ? APPENDIX.group : 0) + h > free && current.length)
                newPage();
            if (!started || current.length === 0) {
                current.push({ kind: 'group', key: g.key, label: g.label, continued: started });
                free -= APPENDIX.group;
                started = true;
            }
            current.push({ kind: 'finding', finding: f });
            free -= h;
        }
    }
    newPage();
    return pagesOut;
}
/**
 * Splits an image into PDF pages of `columns` slices each. The image is scaled so a column fills
 * its share of the screenshot area's width (never enlarged); slice height fills the area's height.
 */
export function sliceImage(image, columns, layout) {
    const colWidth = (layout.shot.width - layout.gap * (columns - 1)) / columns;
    let scale = Math.min(1, colWidth / image.width);
    const sliceHeight = Math.floor(layout.shot.height / scale);
    if (image.height <= sliceHeight * SINGLE_PAGE_TOLERANCE) {
        // Fits on one page (possibly shrunk a little to avoid a near-empty continuation page).
        scale = Math.min(scale, layout.shot.height / image.height);
        return { scale, pdfPages: [[{ top: 0, height: image.height }]] };
    }
    const slices = [];
    for (let top = 0; top < image.height; top += sliceHeight) {
        slices.push({ top, height: Math.min(sliceHeight, image.height - top) });
    }
    const pdfPages = [];
    for (let i = 0; i < slices.length; i += columns)
        pdfPages.push(slices.slice(i, i + columns));
    return { scale, pdfPages };
}
//# sourceMappingURL=plan.js.map