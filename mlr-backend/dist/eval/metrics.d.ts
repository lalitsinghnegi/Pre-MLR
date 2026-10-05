/** Precision/recall, or null when undefined (no findings / nothing expected). */
export declare function precision(tp: number, fp: number): number | null;
export declare function recall(tp: number, fn: number): number | null;
export declare function percentile(values: number[], p: number): number | null;
export interface Summary {
    mean: number | null;
    min: number | null;
    max: number | null;
}
/** Mean and range over runs, ignoring runs where the value is undefined. */
export declare function summarize(values: (number | null)[]): Summary;
