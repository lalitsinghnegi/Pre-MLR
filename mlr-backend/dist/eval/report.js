const pct = (v) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
const num = (v, digits = 0) => (v === null ? 'n/a' : v.toFixed(digits));
const usd = (v) => (v === null ? 'n/a' : `$${v.toFixed(4)}`);
const secs = (ms) => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)}s`);
/** "mean (min–max)" when runs differ visibly, else just the value. */
function fmt(s, f) {
    if (s.mean === null)
        return 'n/a';
    const [lo, hi] = [f(s.min), f(s.max)];
    return lo === hi ? f(s.mean) : `${f(s.mean)} (${lo}–${hi})`;
}
const describeModel = (c) => c.provider === 'mock'
    ? 'mock'
    : `${c.model}${c.effort ? ` · ${c.effort}` : ''}${c.fallback ? ' · fallback' : ''}`;
const HEADERS = [
    'Model',
    'Config',
    'Runs',
    'Precision',
    'Recall',
    'TP',
    'FP',
    'FN',
    'Failed pages',
    'Retries',
    'Latency/page (mean)',
    'Latency/page (p95)',
    'Scan time',
    'Tokens in',
    'Tokens out',
    'Cost/scan',
];
function row(m) {
    return [
        m.config.id,
        describeModel(m.config),
        String(m.runs.length),
        fmt(m.precision, pct),
        fmt(m.recall, pct),
        fmt(m.tp, (v) => num(v, 1)),
        fmt(m.fp, (v) => num(v, 1)),
        fmt(m.fn, (v) => num(v, 1)),
        fmt(m.failedPages, (v) => num(v, 1)),
        fmt(m.retries, (v) => num(v, 1)),
        fmt(m.latencyMeanMs, secs),
        fmt(m.latencyP95Ms, secs),
        fmt(m.scanMs, secs),
        fmt(m.inputTokens, (v) => num(v)),
        fmt(m.outputTokens, (v) => num(v)),
        fmt(m.costUsd, usd),
    ];
}
export function markdownReport(r) {
    const lines = [
        `# LLM evaluation: ${r.site}`,
        '',
        `Run ${r.startedAt.slice(0, 16).replace('T', ' ')} UTC. Scored against the ${r.expectedLlm.length} \`llm\` entries in expected-findings.yaml; LLM findings only (deterministic findings are tested exactly elsewhere). Total spend: ${usd(r.totalCostUsd)}.`,
        '',
        'Precision = TP / (TP + FP); recall = TP / (TP + FN). With several runs, values are mean (min–max).',
        '',
        `| ${HEADERS.join(' | ')} |`,
        `| ${HEADERS.map(() => '---').join(' | ')} |`,
        ...r.models.map((m) => `| ${row(m).join(' | ')} |`),
    ];
    if (r.stoppedEarly)
        lines.push('', `**Stopped early:** ${r.stoppedEarly}`);
    for (const m of r.models) {
        lines.push('', `## ${m.config.id}`);
        for (const run of m.runs) {
            const served = run.servedModels.length ? ` · served by ${run.servedModels.join(', ')}` : '';
            lines.push('', `Run ${run.run}: TP ${run.tp}, FP ${run.fp}, FN ${run.fn}${served}`);
            for (const f of run.comparison.unexpected)
                lines.push(`- False positive: \`${f.page}\` ${f.rule} — “${f.evidence ?? ''}”`);
            for (const f of run.comparison.missing)
                lines.push(`- Missed: \`${f.page}\` ${f.rule}${f.evidence ? ` (expected “${f.evidence}”)` : ''}`);
        }
    }
    return `${lines.join('\n')}\n`;
}
/** Fixed-width table for the terminal (a subset of the columns). */
export function consoleTable(r) {
    const cols = [0, 3, 4, 6, 7, 8, 11, 15];
    const rows = [HEADERS, ...r.models.map(row)].map((cells) => cols.map((i) => cells[i]));
    const widths = cols.map((_, c) => Math.max(...rows.map((cells) => cells[c].length)));
    return rows.map((cells) => cells.map((cell, c) => cell.padEnd(widths[c])).join('  ')).join('\n');
}
//# sourceMappingURL=report.js.map