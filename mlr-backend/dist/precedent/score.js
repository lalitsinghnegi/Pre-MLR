import { eq } from 'drizzle-orm';
import { precedentClassifications, precedents } from '../db/schema.js';
const NONE = 'no_matching_rule';
/** Compares stored classifications with an answer key (e.g. the synthetic dataset's labels file). */
export function scoreClassifications(db, labels) {
    const rows = db
        .select({ p: precedents, c: precedentClassifications })
        .from(precedents)
        .innerJoin(precedentClassifications, eq(precedentClassifications.precedentId, precedents.id))
        .all();
    let scored = 0;
    let correct = 0;
    let failed = 0;
    let flagged = 0;
    let flaggedRight = 0;
    let actualNone = 0;
    const mistakes = [];
    for (const { p, c } of rows) {
        const label = p.sourceCommentId ? labels[p.sourceCommentId] : undefined;
        if (!label || label === 'invalid' || label === 'duplicate')
            continue;
        const expected = label.startsWith('off_rule:') ? NONE : label;
        const got = c.status !== 'ok' ? 'failed' : c.noMatchingRule ? NONE : (c.category ?? 'failed');
        scored++;
        if (got === 'failed')
            failed++;
        if (expected === NONE)
            actualNone++;
        if (got === NONE) {
            flagged++;
            if (expected === NONE)
                flaggedRight++;
        }
        if (got === expected)
            correct++;
        else
            mistakes.push({ sourceCommentId: p.sourceCommentId, expected, got, text: p.commentText });
    }
    const ratio = (a, b) => (b ? Math.round((a / b) * 1000) / 1000 : 0);
    mistakes.sort((a, b) => a.sourceCommentId.localeCompare(b.sourceCommentId));
    return {
        scored,
        correct,
        accuracy: ratio(correct, scored),
        noMatchPrecision: ratio(flaggedRight, flagged),
        noMatchRecall: ratio(flaggedRight, actualNone),
        failed,
        mistakes,
    };
}
//# sourceMappingURL=score.js.map