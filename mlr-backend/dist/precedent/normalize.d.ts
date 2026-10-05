import type { ColumnMapping, MappedField } from './mapping.js';
import type { RawCell } from './read.js';
export interface NormalizedPrecedent {
    sourceCommentId: string | null;
    proofName: string | null;
    proofVersion: string | null;
    pageRef: string | null;
    commentText: string;
    reviewerPseudonym: string | null;
    reviewerFunction: string | null;
    status: string | null;
    /** YYYY-MM-DD */
    commentedAt: string;
    brand: string;
    country: string | null;
    site: string | null;
    fingerprint: string;
}
/** Maps each field to its column index; throws listing missing required headers and what the file has. */
export declare function resolveColumns(headers: string[], mapping: ColumnMapping): Partial<Record<MappedField, number>>;
/**
 * Stable, keyed pseudonym: the same name always maps to the same token under one key, and the name
 * can't be recovered from it. Case and whitespace differences in the name are ignored.
 */
export declare function pseudonymize(name: string, key: string): string;
/** Replaces email addresses and phone numbers in free text. Names in free text are NOT detected. */
export declare function redact(text: string): string;
export declare function parseDate(cell: RawCell, formats: ColumnMapping['dateFormats']): string | null;
/** One row → a precedent, or the reasons it can't be imported. */
export declare function normalizeRow(cells: RawCell[], cols: Partial<Record<MappedField, number>>, mapping: ColumnMapping, opts: {
    pseudonymKey: string;
    site: string | null;
}): {
    ok: true;
    value: NormalizedPrecedent;
} | {
    ok: false;
    errors: string[];
};
