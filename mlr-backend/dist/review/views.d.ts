import { type SQL } from 'drizzle-orm';
import type { FindingPrecedent, FindingView, ScanSummary } from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
/** Findings joined with their page and rule version, ordered by page, then severity. */
export declare function findingViews(db: Pick<Db, 'select'>, where: SQL | undefined): FindingView[];
/** Attached precedents per finding, most similar first. Never includes reviewer pseudonyms. */
export declare function precedentsFor(db: Pick<Db, 'select'>, findingIds: string[]): Map<string, FindingPrecedent[]>;
/** Latest successful LLM page tip per page. */
export declare function pageTips(db: Pick<Db, 'select'>, pageIds: string[]): Map<string, string>;
export declare const findingViewsForScan: (db: Db, scanId: string) => {
    id: string;
    scanId: string;
    pageId: string | null;
    ruleId: string;
    ruleVersion: number;
    detectedBy: "llm" | "rules_engine";
    severity: "critical" | "major" | "minor" | "info";
    message: string;
    evidenceText: string | null;
    evidenceLocation: {
        view: "desktop" | "mobile";
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    evidenceCropPath: string | null;
    suggestedFix: string | null;
    editedFix: string | null;
    confidence: number | null;
    status: "open" | "accepted" | "rejected" | "edited";
    authorComment: string | null;
    revision: number;
    createdAt: string;
    updatedAt: string;
    updatedBy: string;
    page: {
        id: string;
        number: number;
        url: string;
        title: string | null;
        screenshots: {
            desktop: boolean;
            mobile: boolean;
        };
        tip: string | null;
    } | null;
    rule: {
        title: string;
        category: "links" | "safety_information" | "fair_balance" | "claims" | "references" | "branding" | "legal_privacy" | "accessibility";
        description: string;
        sourceCitation: string;
        sourceUrl: string | null;
        sourceNote: string | null;
    };
    precedents: {
        id: string;
        text: string;
        site: string | null;
        brand: string;
        commentedAt: string;
        reviewerFunction: string | null;
        outcome: string | null;
        category: string | null;
        rank: number;
        similarity: number;
    }[];
}[];
export declare const findingViewsByIds: (db: Db, ids: string[]) => {
    id: string;
    scanId: string;
    pageId: string | null;
    ruleId: string;
    ruleVersion: number;
    detectedBy: "llm" | "rules_engine";
    severity: "critical" | "major" | "minor" | "info";
    message: string;
    evidenceText: string | null;
    evidenceLocation: {
        view: "desktop" | "mobile";
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    evidenceCropPath: string | null;
    suggestedFix: string | null;
    editedFix: string | null;
    confidence: number | null;
    status: "open" | "accepted" | "rejected" | "edited";
    authorComment: string | null;
    revision: number;
    createdAt: string;
    updatedAt: string;
    updatedBy: string;
    page: {
        id: string;
        number: number;
        url: string;
        title: string | null;
        screenshots: {
            desktop: boolean;
            mobile: boolean;
        };
        tip: string | null;
    } | null;
    rule: {
        title: string;
        category: "links" | "safety_information" | "fair_balance" | "claims" | "references" | "branding" | "legal_privacy" | "accessibility";
        description: string;
        sourceCitation: string;
        sourceUrl: string | null;
        sourceNote: string | null;
    };
    precedents: {
        id: string;
        text: string;
        site: string | null;
        brand: string;
        commentedAt: string;
        reviewerFunction: string | null;
        outcome: string | null;
        category: string | null;
        rank: number;
        similarity: number;
    }[];
}[];
export declare const findingView: (db: Db, id: string) => FindingView | undefined;
/** Scans newest first, with finding counts. */
export declare function scanSummaries(db: Db): ScanSummary[];
