/** Precision/recall, or null when undefined (no findings / nothing expected). */
export function precision(tp, fp) {
    return tp + fp === 0 ? null : tp / (tp + fp);
}
export function recall(tp, fn) {
    return tp + fn === 0 ? null : tp / (tp + fn);
}
export function percentile(values, p) {
    if (!values.length)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    // Nearest-rank: the smallest value with at least p% of values at or below it.
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
/** Mean and range over runs, ignoring runs where the value is undefined. */
export function summarize(values) {
    const xs = values.filter((v) => v !== null && Number.isFinite(v));
    if (!xs.length)
        return { mean: null, min: null, max: null };
    return {
        mean: xs.reduce((a, b) => a + b, 0) / xs.length,
        min: Math.min(...xs),
        max: Math.max(...xs),
    };
}
//# sourceMappingURL=metrics.js.map