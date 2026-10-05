import type { CheckDefinition } from './types.js';
export declare const CHECKS: {
    readonly 'required-heading': CheckDefinition<{
        check: string;
        excludePaths: string[];
        headings: string[];
        suggestedFix?: string | undefined;
    }>;
    readonly 'section-readability': CheckDefinition<{
        check: string;
        excludePaths: string[];
        sectionHeadings: string[];
        minFontPx: number;
        minContrast: number;
        minContrastLarge: number;
        largeFontPx: number;
        largeBoldFontPx: number;
        suggestedFix?: string | undefined;
    }>;
    readonly 'required-link': CheckDefinition<{
        check: string;
        excludePaths: string[];
        linkText: string[];
        hrefContains: string[];
        mode: "present" | "resolves" | "present-and-resolves";
        name: string;
        suggestedFix?: string | undefined;
    }>;
    readonly 'required-text': CheckDefinition<{
        check: string;
        excludePaths: string[];
        patterns: string[];
        match: "all" | "any";
        onlyIfHeadings: string[];
        missing: string;
        suggestedFix?: string | undefined;
    }>;
    readonly 'phrase-list': CheckDefinition<{
        check: string;
        excludePaths: string[];
        phrases: string[];
        label: string;
        skipSections: string[];
        skipRegions: ("header" | "nav" | "footer")[];
        suggestedFix?: string | undefined;
    }>;
    readonly 'numeric-claims': CheckDefinition<{
        check: string;
        excludePaths: string[];
        patterns: string[];
        markerPattern: string;
        skipSections: string[];
        skipRegions: ("header" | "nav" | "footer")[];
        suggestedFix?: string | undefined;
    }>;
    readonly 'alt-text': CheckDefinition<{
        check: string;
        excludePaths: string[];
        minSizePx: number;
        suggestedFix?: string | undefined;
    }>;
    readonly 'brand-names': CheckDefinition<{
        check: string;
        excludePaths: string[];
        requirement: "established-name" | "trademark-symbol";
        symbols: string[];
        suggestedFix?: string | undefined;
    }>;
    readonly 'link-health': CheckDefinition<{
        check: string;
        excludePaths: string[];
        ignoreUrlsContaining: string[];
        suggestedFix?: string | undefined;
    }>;
};
export type CheckName = keyof typeof CHECKS;
export declare function getCheck(name: unknown): CheckDefinition | undefined;
