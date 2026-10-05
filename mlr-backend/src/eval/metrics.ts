/** Precision/recall, or null when undefined (no findings / nothing expected). */
export function precision(tp: number, fp: number): number | null {
  return tp + fp === 0 ? null : tp / (tp + fp);
}
export function recall(tp: number, fn: number): number | null {
  return tp + fn === 0 ? null : tp / (tp + fn);
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Nearest-rank: the smallest value with at least p% of values at or below it.
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  ]!;
}

export interface Summary {
  mean: number | null;
  min: number | null;
  max: number | null;
}

/** Mean and range over runs, ignoring runs where the value is undefined. */
export function summarize(values: (number | null)[]): Summary {
  const xs = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!xs.length) return { mean: null, min: null, max: null };
  return {
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
    min: Math.min(...xs),
    max: Math.max(...xs),
  };
}
