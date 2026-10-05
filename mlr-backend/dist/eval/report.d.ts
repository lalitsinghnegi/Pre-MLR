import type { EvalResult } from './harness.js';
export declare function markdownReport(r: EvalResult): string;
/** Fixed-width table for the terminal (a subset of the columns). */
export declare function consoleTable(r: EvalResult): string;
