/** Bump when changing the prompt files; old versions stay on disk so stored analyses stay traceable. */
export declare const PROMPT_VERSION = "v1";
export type PromptFamily = 'page-analysis' | 'precedent-classification';
export interface PromptSet {
    /** e.g. "v1#3fa2c1d0" – the directory version plus a hash of the file contents. */
    version: string;
    system: string;
    userTemplate: string;
}
export declare function loadPrompts(version?: string, family?: PromptFamily): Promise<PromptSet>;
export interface PromptRule {
    ruleId: string;
    version: number;
    title: string;
    severity: string;
    sourceCitation: string;
    description: string;
    promptTemplate: string | null;
}
/** The rules section; identical for every page of a scan, so it is sent as a cacheable system block. */
export declare function renderRules(rules: PromptRule[]): string;
export declare function renderUser(template: string, page: {
    url: string;
    title: string | null;
    text: string;
}, feedback?: string): string;
