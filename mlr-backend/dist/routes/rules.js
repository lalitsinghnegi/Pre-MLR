import { CreateRuleSchema, NewRuleVersionSchema } from '@pre-mlr/shared';
import { auditFor } from '../audit/log.js';
import { requireRole } from '../auth/plugin.js';
import { ValidationError } from '../errors.js';
import { addRuleVersion, createRule, listRules, ruleDetail, ruleVersion, scanRuleList, setRetired, } from '../rules/admin.js';
import { ruleVersionYaml } from '../rules/pack.js';
/** Rule library: anyone signed in can read; only rule admins can change rules. */
export const ruleRoutes = (db) => async (app) => {
    app.get('/api/rules', async () => listRules(db));
    app.get('/api/rules/:id', async (req) => ruleDetail(db, req.params.id));
    app.get('/api/rules/:id/audit', async (req) => {
        ruleDetail(db, req.params.id); // 404 for unknown rules
        return auditFor(db, 'rule', req.params.id);
    });
    app.get('/api/rules/:id/versions/:version/yaml', async (req, reply) => {
        const version = Number(req.params.version);
        if (!Number.isInteger(version))
            throw new ValidationError('Invalid version');
        const v = ruleVersion(db, req.params.id, version);
        return reply
            .header('content-type', 'text/yaml; charset=utf-8')
            .header('content-disposition', `attachment; filename="${v.ruleId}.yaml"`)
            .send(ruleVersionYaml(v));
    });
    app.post('/api/rules', async (req, reply) => {
        const admin = requireRole(req, 'rule_admin');
        const body = CreateRuleSchema.safeParse(req.body ?? {});
        if (!body.success)
            throw ValidationError.fromIssues('Invalid rule', body.error.issues);
        createRule(db, body.data, admin.name);
        return reply.code(201).send(ruleDetail(db, body.data.ruleId));
    });
    app.post('/api/rules/:id/versions', async (req, reply) => {
        const admin = requireRole(req, 'rule_admin');
        const body = NewRuleVersionSchema.safeParse(req.body ?? {});
        if (!body.success)
            throw ValidationError.fromIssues('Invalid rule', body.error.issues);
        addRuleVersion(db, req.params.id, body.data, admin.name);
        return reply.code(201).send(ruleDetail(db, req.params.id));
    });
    for (const [action, retired] of [
        ['retire', true],
        ['restore', false],
    ]) {
        app.post(`/api/rules/:id/${action}`, async (req) => {
            const admin = requireRole(req, 'rule_admin');
            setRetired(db, req.params.id, retired, admin.name);
            return ruleDetail(db, req.params.id);
        });
    }
    app.get('/api/scans/:id/rules', async (req) => scanRuleList(db, req.params.id));
};
//# sourceMappingURL=rules.js.map