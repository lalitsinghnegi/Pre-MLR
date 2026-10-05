import type { z } from 'zod';
import type { PageFacts, PageLink, ProductProfile } from '@pre-mlr/shared';
import type { NewFinding } from '../findings/service.js';
export interface CheckPage {
    id: string;
    url: string;
    title: string | null;
    text: string | null;
    links: PageLink[];
    facts: PageFacts | null;
    httpStatus: number | null;
    error: string | null;
}
export interface LinkStatus {
    ok: boolean;
    httpStatus: number | null;
    error: string | null;
    /** The site refused automated checks (even from a browser): not known to be broken. */
    unverified?: boolean;
}
export interface CheckContext {
    pages: CheckPage[];
    product: ProductProfile | null;
    /** Status of a link by URL (any form; normalized internally). Undefined if it wasn't checked. */
    link(url: string): LinkStatus | undefined;
}
/** A finding produced by a check; the engine adds rule id/version and detectedBy. */
export type CheckFinding = Omit<NewFinding, 'ruleId' | 'detectedBy'>;
/**
 * A reusable deterministic check. Rules select one with `params.check` and configure it with the
 * rest of `params`, so new rules of an existing kind need only a YAML file.
 */
export interface CheckDefinition<P = unknown> {
    params: z.ZodType<P>;
    run(params: P, ctx: CheckContext): CheckFinding[];
}
