import { type ReportFinding, type ReportPlan } from './plan.js';
export interface ReportMeta {
    scanId: string;
    startUrl: string;
    maxPages: number;
    maxDepth: number;
    pagesCrawled: number;
    startedAt: string | null;
    finishedAt: string | null;
    generatedAt: string;
    summary: ReportSummary;
}
export interface ReportSummary {
    /** Every included (non-rejected) finding, with its page label (null for site-wide). */
    findings: {
        finding: ReportFinding;
        page: {
            number: number;
            label: string;
        } | null;
    }[];
    /** Rejected findings, counted but not shown. */
    rejected: number;
}
/** Origin the PDF renderer intercepts to serve screenshot slices; never hits the network. */
export declare const IMAGE_ORIGIN = "http://report.invalid";
export declare const imageUrl: (pdfPage: number, column: number) => string;
export declare function renderReportHtml(plan: ReportPlan, meta: ReportMeta, sitemapSvg: string): string;
export declare function fmtDate(iso: string | null): string;
export declare function esc(s: string): string;
/** Playwright footer template (rendered in the bottom margin of every page). */
export declare function footerTemplate(generatedAt: string): string;
