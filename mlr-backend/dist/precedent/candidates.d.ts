import type { CreateRuleCandidate, RuleCandidate } from '@pre-mlr/shared';
import type { Db } from '../db/client.js';
/**
 * Records a proposal for a new rule from one or more historic comments (the route allows rule
 * admins only). When promoted from a finding, the precedents must be ones attached to that
 * finding. The same set of comments can't be proposed twice. Audited for the candidate and for
 * each source comment.
 */
export declare function createRuleCandidate(db: Db, input: CreateRuleCandidate, actor: string): RuleCandidate;
/** Proposals, newest first, each with up to three of its source comments. */
export declare function listRuleCandidates(db: Db): RuleCandidate[];
