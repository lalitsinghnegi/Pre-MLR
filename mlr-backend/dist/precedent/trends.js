import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { PRECEDENT_BUCKETS, RULE_CATEGORIES, } from '@pre-mlr/shared';
import { precedentClassifications, precedents } from '../db/schema.js';
import { clusterNoMatch } from './clusters.js';
function filterWhere(f) {
    return and(f.from ? gte(precedents.commentedAt, f.from) : undefined, f.to ? lte(precedents.commentedAt, f.to) : undefined, f.brand ? eq(precedents.brand, f.brand) : undefined, f.reviewerFunction ? eq(precedents.reviewerFunction, f.reviewerFunction) : undefined);
}
function rowsFor(db, f) {
    return db
        .select({ p: precedents, c: precedentClassifications })
        .from(precedents)
        .leftJoin(precedentClassifications, eq(precedentClassifications.precedentId, precedents.id))
        .where(filterWhere(f))
        .orderBy(asc(precedents.commentedAt), asc(precedents.id))
        .all();
}
export function bucketOf(c) {
    if (c?.status !== 'ok')
        return 'unclassified';
    if (c.noMatchingRule)
        return 'no_matching_rule';
    // A category the shared schema doesn't know (a company pack with its own) can't be charted yet.
    return RULE_CATEGORIES.includes(c.category ?? '')
        ? c.category
        : 'unclassified';
}
/** "2025-03" or "2025-Q1" for a YYYY-MM-DD date. */
export function periodOf(date, interval) {
    const [y, m] = [date.slice(0, 4), Number(date.slice(5, 7))];
    return interval === 'month' ? `${y}-${date.slice(5, 7)}` : `${y}-Q${Math.ceil(m / 3)}`;
}
/** Every period from first to last, inclusive. */
export function periodRange(first, last, interval) {
    const step = interval === 'month' ? 1 : 3;
    let y = Number(first.slice(0, 4));
    let m = interval === 'month' ? Number(first.slice(5, 7)) : (Number(first.slice(6)) - 1) * 3 + 1;
    const out = [];
    for (;;) {
        const p = periodOf(`${y}-${String(m).padStart(2, '0')}-01`, interval);
        out.push(p);
        if (p === last || out.length > 1200)
            return out;
        m += step;
        if (m > 12)
            [y, m] = [y + 1, m - 12];
    }
}
const emptyCounts = () => Object.fromEntries(PRECEDENT_BUCKETS.map((b) => [b, 0]));
function groupBy(rows, keyOf) {
    const groups = new Map();
    for (const r of rows) {
        const key = keyOf(r);
        const g = groups.get(key) ?? { key, total: 0, counts: emptyCounts() };
        g.total++;
        g.counts[bucketOf(r.c)]++;
        groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}
/**
 * Comment counts by category over time, by brand and by reviewer function. Aggregated in JS
 * (precedent sets are small) so no database-specific date functions are needed.
 */
export function precedentTrends(db, f) {
    const rows = rowsFor(db, f);
    const buckets = rows.map((r) => bucketOf(r.c));
    const count = (b) => buckets.filter((x) => x === b).length;
    const overTime = [];
    if (rows.length) {
        const byPeriod = new Map();
        rows.forEach((r, i) => {
            const p = periodOf(r.p.commentedAt, f.interval);
            const counts = byPeriod.get(p) ?? emptyCounts();
            counts[buckets[i]]++;
            byPeriod.set(p, counts);
        });
        const first = periodOf(rows[0].p.commentedAt, f.interval);
        const last = periodOf(rows.at(-1).p.commentedAt, f.interval);
        for (const period of periodRange(first, last, f.interval)) {
            const counts = byPeriod.get(period) ?? emptyCounts();
            overTime.push({
                period,
                total: Object.values(counts).reduce((s, n) => s + n, 0),
                counts,
            });
        }
    }
    const all = db
        .select({
        brand: precedents.brand,
        fn: precedents.reviewerFunction,
        date: precedents.commentedAt,
    })
        .from(precedents)
        .all();
    const dates = all.map((r) => r.date).sort();
    const classifiers = new Set(rows.flatMap((r) => (r.c?.status === 'ok' ? [`${r.c.provider}:${r.c.model}`] : [])));
    return {
        interval: f.interval,
        totals: {
            comments: rows.length,
            classified: rows.length - count('unclassified'),
            noMatchingRule: count('no_matching_rule'),
            unclassified: count('unclassified'),
        },
        overTime,
        byCategory: PRECEDENT_BUCKETS.map((bucket) => ({ bucket, total: count(bucket) }))
            .filter((c) => c.total > 0)
            .sort((a, b) => b.total - a.total),
        byBrand: groupBy(rows, (r) => r.p.brand),
        byReviewerFunction: groupBy(rows, (r) => r.p.reviewerFunction ?? 'Unknown'),
        filterOptions: {
            brands: [...new Set(all.map((r) => r.brand))].sort(),
            reviewerFunctions: [...new Set(all.flatMap((r) => (r.fn ? [r.fn] : [])))].sort(),
            firstDate: dates[0] ?? null,
            lastDate: dates.at(-1) ?? null,
        },
        classifiers: [...classifiers].sort(),
    };
}
/** Recurring themes among comments no rule covers: candidates for new rules. */
export function candidateRules(db, f) {
    const noMatch = rowsFor(db, f).filter((r) => bucketOf(r.c) === 'no_matching_rule');
    const candidates = clusterNoMatch(noMatch.map(({ p, c }) => ({
        id: p.id,
        text: p.commentText,
        topic: c.topic,
        brand: p.brand,
        proofName: p.proofName,
        reviewerFunction: p.reviewerFunction,
        commentedAt: p.commentedAt,
    })), { minSize: f.minSize });
    return {
        noMatchTotal: noMatch.length,
        clustered: candidates.reduce((s, c) => s + c.count, 0),
        candidates,
    };
}
//# sourceMappingURL=trends.js.map