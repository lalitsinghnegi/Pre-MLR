const STOPWORDS = new Set(`a an and are as at be been but by can for from has have in into is it its may must need needs
  not of on or our out per please should so than that the their them then there these this those
  to too use used uses was we were what when which while will with would you your also only page
  check confirm make more less like off`.split(/\s+/));
/** Lowercased words of 3+ letters, minus stopwords, with plural "s" stripped. */
export function tokenize(text) {
    return (text.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? [])
        .flatMap((w) => w.split('-'))
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
        .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}
function normalize(v) {
    const n = Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0));
    if (n)
        for (const [k, x] of v)
            v.set(k, x / n);
    return v;
}
function cosine(a, b) {
    const [small, large] = a.size < b.size ? [a, b] : [b, a];
    let dot = 0;
    for (const [k, x] of small)
        dot += x * (large.get(k) ?? 0);
    return dot;
}
/**
 * Groups comments that no rule covers into recurring themes: TF-IDF vectors of the comment text
 * plus the classifier's topic (weighted), joined greedily to the most similar cluster centroid in
 * date order. Deterministic and dependency-free; embedding similarity arrives with Prompt 14.
 * Returns only clusters big enough to suggest a new rule, largest first.
 */
export function clusterNoMatch(items, opts = {}) {
    const threshold = opts.threshold ?? 0.3;
    const minSize = opts.minSize ?? 3;
    const minProofs = opts.minProofs ?? 2;
    const topicWeight = opts.topicWeight ?? 3;
    const sorted = [...items].sort((a, b) => a.commentedAt.localeCompare(b.commentedAt) || a.id.localeCompare(b.id));
    const docs = sorted.map((item) => {
        const tf = new Map();
        for (const t of tokenize(item.text))
            tf.set(t, (tf.get(t) ?? 0) + 1);
        for (const t of tokenize(item.topic ?? ''))
            tf.set(t, (tf.get(t) ?? 0) + topicWeight);
        return tf;
    });
    const df = new Map();
    for (const tf of docs)
        for (const t of tf.keys())
            df.set(t, (df.get(t) ?? 0) + 1);
    const idf = (t) => Math.log((1 + docs.length) / (1 + df.get(t))) + 1;
    const vectors = docs.map((tf) => normalize(new Map([...tf].map(([t, n]) => [t, n * idf(t)]))));
    const clusters = [];
    vectors.forEach((v, i) => {
        let best = -1;
        let bestSim = threshold;
        clusters.forEach((c, j) => {
            const sim = cosine(v, c.centroid);
            if (sim >= bestSim)
                [best, bestSim] = [j, sim];
        });
        if (best < 0) {
            clusters.push({ members: [i], sum: new Map(v), centroid: new Map(v) });
            return;
        }
        const c = clusters[best];
        c.members.push(i);
        for (const [k, x] of v)
            c.sum.set(k, (c.sum.get(k) ?? 0) + x);
        c.centroid = normalize(new Map(c.sum));
    });
    return clusters
        .map((c) => describe(c.members.map((i) => sorted[i]), c.sum))
        .filter((c) => c.count >= minSize && c.proofs >= minProofs)
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
function describe(members, sum) {
    const topics = countBy(members.map((m) => m.topic?.trim().toLowerCase() || 'other'));
    const label = [...topics].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const dates = members.map((m) => m.commentedAt).sort();
    return {
        label,
        terms: [...sum]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 5)
            .map(([t]) => t),
        count: members.length,
        proofs: new Set(members.map((m) => m.proofName ?? m.id)).size,
        brands: [...new Set(members.map((m) => m.brand))].sort(),
        reviewerFunctions: [
            ...new Set(members.flatMap((m) => (m.reviewerFunction ? [m.reviewerFunction] : []))),
        ].sort(),
        firstSeen: dates[0],
        lastSeen: dates.at(-1),
        // Most recent first: the freshest wording is the most useful when drafting a rule.
        examples: members
            .slice(-3)
            .reverse()
            .map((m) => ({
            id: m.id,
            text: m.text,
            brand: m.brand,
            reviewerFunction: m.reviewerFunction,
            commentedAt: m.commentedAt,
        })),
        precedentIds: members.map((m) => m.id),
    };
}
function countBy(xs) {
    const m = new Map();
    for (const x of xs)
        m.set(x, (m.get(x) ?? 0) + 1);
    return m;
}
//# sourceMappingURL=clusters.js.map