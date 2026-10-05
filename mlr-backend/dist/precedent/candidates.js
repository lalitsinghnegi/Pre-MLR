import { randomUUID } from 'node:crypto';
import { desc, eq, inArray } from 'drizzle-orm';
import { appendAudit } from '../audit/log.js';
import { findingPrecedents, findings, precedents, ruleCandidates } from '../db/schema.js';
import { ConflictError, ValidationError } from '../errors.js';
const PRECEDENT_ACTION = 'promoted_to_rule_candidate';
/**
 * Records a proposal for a new rule from one or more historic comments (the route allows rule
 * admins only). When promoted from a finding, the precedents must be ones attached to that
 * finding. The same set of comments can't be proposed twice. Audited for the candidate and for
 * each source comment.
 */
export function createRuleCandidate(db, input, actor) {
    const ids = [...new Set(input.precedentIds)].sort();
    const found = db
        .select({ id: precedents.id })
        .from(precedents)
        .where(inArray(precedents.id, ids))
        .all();
    if (found.length !== ids.length) {
        const known = new Set(found.map((f) => f.id));
        throw new ValidationError(`Unknown precedent id(s): ${ids.filter((id) => !known.has(id)).join(', ')}`);
    }
    let scanId = null;
    if (input.findingId) {
        const finding = db
            .select({ scanId: findings.scanId })
            .from(findings)
            .where(eq(findings.id, input.findingId))
            .get();
        if (!finding)
            throw new ValidationError('Unknown finding id');
        const attached = new Set(db
            .select({ id: findingPrecedents.precedentId })
            .from(findingPrecedents)
            .where(eq(findingPrecedents.findingId, input.findingId))
            .all()
            .map((r) => r.id));
        if (ids.some((id) => !attached.has(id))) {
            throw new ValidationError('Those precedents are not attached to that finding.');
        }
        scanId = finding.scanId;
    }
    const key = JSON.stringify(ids);
    const duplicate = db
        .select({ id: ruleCandidates.id, ids: ruleCandidates.precedentIds })
        .from(ruleCandidates)
        .all()
        .find((c) => JSON.stringify([...c.ids].sort()) === key);
    if (duplicate) {
        throw new ConflictError('These comments have already been proposed as a rule candidate.', {
            id: duplicate.id,
        });
    }
    const row = {
        id: randomUUID(),
        title: input.title,
        status: 'proposed',
        precedentIds: ids,
        findingId: input.findingId ?? null,
        scanId,
        note: input.note || null,
        createdBy: actor,
        createdAt: new Date().toISOString(),
    };
    db.transaction((tx) => {
        tx.insert(ruleCandidates).values(row).run();
        appendAudit(tx, [
            {
                entityType: 'rule_candidate',
                entityId: row.id,
                scanId,
                action: PRECEDENT_ACTION,
                changes: {
                    status: [null, 'proposed'],
                    title: [null, row.title],
                    precedentIds: [null, ids],
                    findingId: [null, row.findingId],
                },
                actor: actor,
                at: row.createdAt,
            },
            ...ids.map((id) => ({
                entityType: 'precedent',
                entityId: id,
                scanId,
                action: PRECEDENT_ACTION,
                changes: { ruleCandidateId: [null, row.id] },
                actor: actor,
                at: row.createdAt,
            })),
        ]);
    });
    return listRuleCandidates(db).find((c) => c.id === row.id);
}
/** Proposals, newest first, each with up to three of its source comments. */
export function listRuleCandidates(db) {
    const rows = db.select().from(ruleCandidates).orderBy(desc(ruleCandidates.createdAt)).all();
    const allIds = [...new Set(rows.flatMap((r) => r.precedentIds.slice(0, 3)))];
    const byId = new Map(allIds.length
        ? db
            .select()
            .from(precedents)
            .where(inArray(precedents.id, allIds))
            .all()
            .map((p) => [p.id, p])
        : []);
    return rows.map((r) => ({
        ...r,
        examples: r.precedentIds.slice(0, 3).flatMap((id) => {
            const p = byId.get(id);
            return p
                ? [
                    {
                        id: p.id,
                        text: p.commentText,
                        brand: p.brand,
                        reviewerFunction: p.reviewerFunction,
                        commentedAt: p.commentedAt,
                    },
                ]
                : [];
        }),
    }));
}
//# sourceMappingURL=candidates.js.map