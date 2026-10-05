/**
 * Decides the PDF's page sequence: title, site map, summary, every desktop screenshot, every mobile
 * one, then the findings appendix. Tall screenshots are split into slices so they stay readable;
 * mobile slices sit side by side in two columns. Each screenshot page's side panel gets a share of
 * that page's findings, sized by a conservative text-height estimate (so page numbers are known
 * before rendering); whatever doesn't fit is referred to the appendix.
 * Pure function: all sizes are CSS px (96/in), image sizes are source px.
 */
import type { Box, FindingStatus, RuleCategory, Severity } from '@pre-mlr/shared';
export type PageSize = 'Letter' | 'A4';
export type View = 'desktop' | 'mobile';
/** A non-rejected finding as shown in the report. */
export interface ReportFinding {
    id: string;
    /** "3.2" = second finding on page #3; "S.1" for site-wide findings. */
    label: string;
    ruleId: string;
    ruleTitle: string;
    citation: string;
    category: RuleCategory;
    severity: Severity;
    status: Exclude<FindingStatus, 'rejected'>;
    detectedBy: 'rules_engine' | 'llm';
    confidence: number | null;
    message: string;
    evidence: string | null;
    suggestedFix: string | null;
    editedFix: string | null;
    comment: string | null;
    updatedBy: string;
    updatedAt: string;
    /** Evidence box on the desktop screenshot, in screenshot px. */
    location: Box | null;
}
export interface ReportPageInput {
    id: string;
    /** 1-based, crawl order; matches the site-map numbering. */
    number: number;
    url: string;
    title: string | null;
    httpStatus: number | null;
    error: string | null;
    desktop: ImageInfo | null;
    mobile: ImageInfo | null;
    /** Non-rejected findings for this page, already ordered and labelled. */
    findings: ReportFinding[];
    /** LLM page tip, if any. */
    tip: string | null;
    /** Similar past MLR comments for this page's findings (advisory), at most PANEL.precedents. */
    precedents?: ReportPrecedent[];
}
/** A historic comment shown under the page tip. */
export interface ReportPrecedent {
    text: string;
    brand: string;
    reviewerFunction: string | null;
    commentedAt: string;
    outcome: string | null;
}
/** What one screenshot page's side panel shows. */
export interface PanelContent {
    showTip: boolean;
    /** Show the page's past-feedback block (first part only). */
    showPrecedents: boolean;
    findings: ReportFinding[];
    /** Earlier parts already showed findings for this page. */
    continued: boolean;
    /** Findings for this page that didn't fit in any panel; listed in full in the appendix. */
    moreCount: number;
    /** Appendix PDF page where this page's findings are listed (set when moreCount > 0). */
    moreRef: number | null;
}
export type AppendixItem = {
    kind: 'group';
    label: string;
    continued: boolean;
} | {
    kind: 'finding';
    finding: ReportFinding;
};
export interface ImageInfo {
    /** Absolute path of the source PNG. */
    path: string;
    width: number;
    height: number;
}
export interface Slice {
    top: number;
    height: number;
}
export type PlannedPage = {
    kind: 'title';
    pdfPage: number;
} | {
    kind: 'sitemap';
    pdfPage: number;
} | {
    kind: 'summary';
    pdfPage: number;
} | {
    kind: 'appendix';
    pdfPage: number;
    items: AppendixItem[];
    part: number;
    parts: number;
} | {
    kind: 'screenshot';
    pdfPage: number;
    view: View;
    page: ReportPageInput;
    image: ImageInfo;
    /** Position among pages captured in this view, 1-based, and how many there are. */
    index: number;
    total: number;
    /** Continuation part (1-based) and number of parts for this screenshot. */
    part: number;
    parts: number;
    /** One entry per column on this PDF page; each is drawn at `scale`. */
    columns: Slice[];
    scale: number;
    panel: PanelContent;
};
export interface ReportPlan {
    pageSize: PageSize;
    layout: Layout;
    pages: PlannedPage[];
    sections: {
        title: number;
        sitemap: number;
        summary: number;
        desktop: Range | null;
        mobile: Range | null;
        appendix: Range | null;
    };
    /** Pages with no screenshot in either view (HTTP errors, load failures, missing files). */
    notCaptured: ReportPageInput[];
}
export interface Range {
    from: number;
    to: number;
}
export interface Layout {
    page: {
        width: number;
        height: number;
    };
    margin: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    /** Printable area inside the margins. */
    content: {
        width: number;
        height: number;
    };
    headingHeight: number;
    panelWidth: number;
    gap: number;
    /** Space available for the screenshot(s) on a screenshot page. */
    shot: {
        width: number;
        height: number;
    };
}
export declare function layoutFor(pageSize: PageSize): Layout;
export declare function planReport(pageSize: PageSize, pages: ReportPageInput[], siteWide?: ReportFinding[]): ReportPlan;
export declare function pageLabel(p: Pick<ReportPageInput, 'number' | 'url' | 'title'>): string;
export declare const PANEL: {
    readonly lineHeight: 13;
    readonly charsPerLine: 38;
    readonly titleCharsPerLine: 32;
    readonly header: 22;
    readonly padding: 24;
    readonly findingGap: 10;
    readonly overflowNote: 34;
    readonly empty: 20;
    readonly clip: {
        readonly tip: 420;
        readonly evidence: 140;
        readonly fix: 170;
        readonly comment: 110;
        readonly precedent: 110;
    };
    /** Most past comments shown per page. */
    readonly precedents: 2;
};
export declare const APPENDIX: {
    readonly lineHeight: 14;
    readonly charsPerLine: 140;
    readonly heading: 44;
    readonly group: 28;
    readonly findingGap: 12;
    readonly clip: 1200;
};
/** Truncates to `max` characters with an ellipsis (the HTML uses the same function). */
export declare function clip(text: string | null | undefined, max: number): string;
/** Lines needed for text with greedy word wrap at `perLine` characters (long words break). */
export declare function wrapLines(text: string, perLine: number): number;
export declare function panelFindingHeight(f: ReportFinding): number;
export declare function panelTipHeight(tip: string): number;
/** One past-feedback line, as printed (the HTML uses this function too). */
export declare function precedentLine(p: ReportPrecedent): string;
export declare function panelPrecedentsHeight(list: ReportPrecedent[]): number;
/** Splits a page's tip and findings across its screenshot parts; leftovers go to the appendix. */
export declare function distributePanels(page: ReportPageInput, parts: number, layout: Pick<Layout, 'shot'>): PanelContent[];
export declare function appendixFindingHeight(f: ReportFinding): number;
/**
 * Splits an image into PDF pages of `columns` slices each. The image is scaled so a column fills
 * its share of the screenshot area's width (never enlarged); slice height fills the area's height.
 */
export declare function sliceImage(image: {
    width: number;
    height: number;
}, columns: number, layout: Pick<Layout, 'shot' | 'gap'>): {
    scale: number;
    pdfPages: Slice[][];
};
