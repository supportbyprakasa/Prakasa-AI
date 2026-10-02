const router = require('express').Router();
const { ok, fail } = require('../utils/response');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const ctrl = require('../controllers/managementDashboard.controller');
const { cachedResponse } = require('../middleware/cachedResponse');

// The four read pages are cached 120 s per scope: company, division and the
// exact permissions (middleware/cachedResponse.js). Saving a target or an
// escalation follow-up, and an approved Accurate batch, drop them.
const mgmtCache = cachedResponse('mgmt:', 120 * 1000);

router.use(requireAuth);
// Every module's headline numbers, scoped: entity-wide for management, one
// division for its Head (the providers filter by the caller's division).
// Dashboard divisi (migration 116): one division's figures, 12-month trends,
// motion chart data and escalations. The service checks which division.
const divisionDashboard = require('../services/divisionDashboard.service');
router.get('/division', requirePermission(['division_dashboard.view', 'management_dashboard.view']), mgmtCache, async (req, res, next) => {
  try {
    return ok(res, await divisionDashboard.build(req.user, { division: req.query.division }));
  } catch (e) {
    if (e?.status && e?.code && e.status < 500) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
});
router.get('/summary', requirePermission(['management_dashboard.view', 'management_dashboard.division']), mgmtCache, ctrl.summary);
// The project portfolio also answers a division Head, scoped to their division.
router.get('/projects', requirePermission(['management_dashboard.view', 'management_dashboard.division']), ctrl.projects);

// Pusat Eskalasi reads and writes under the same gate as the portfolio: the
// entity-wide view, or a division Head limited to their own division.
const managementOrDivision = requirePermission(['management_dashboard.view', 'management_dashboard.division']);
router.get('/escalations', managementOrDivision, mgmtCache, ctrl.escalations);
router.patch('/escalations/:source/:sourceId', managementOrDivision, ctrl.saveEscalation);
router.get('/roadmap', managementOrDivision, ctrl.roadmap);
router.get('/targets', managementOrDivision, mgmtCache, ctrl.targets);
// Setting a target is an entity-wide decision: the division view may only read.
router.put('/targets', requirePermission('management_dashboard.view'), ctrl.saveTarget);

// Alur & Margin (program 3.3): entity-wide management only. Two gates in a row
// are AND (one requirePermission call is "any of").
const { z } = require('zod');
const validate = require('../middleware/validate');
const flowCtrl = require('../controllers/managementFlow.controller');
const FLOW_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const FLOW_PERIOD = {
  preset: z.enum(['month', 'prev', '3m', 'ytd']).optional(),
  from: FLOW_DATE.optional(),
  to: FLOW_DATE.optional(),
  entityId: z.coerce.number().int().positive().optional(),
};
const management = requirePermission('management_dashboard.view');
router.get('/flow/sales', management, validate(z.object(FLOW_PERIOD), 'query'), flowCtrl.salesFlow);
router.get('/flow/purchase', management, validate(z.object(FLOW_PERIOD), 'query'), flowCtrl.purchaseFlow);
// Purchase prices (P1): management AND procurement.price.view.
router.get('/margin', management, requirePermission('procurement.price.view'),
  validate(z.object({ ...FLOW_PERIOD, departmentId: z.coerce.number().int().positive().optional() }), 'query'), flowCtrl.margin);
// Stock quantities (D2): management AND warehouse.stock.view.
router.get('/slow-movers', management, requirePermission('warehouse.stock.view'),
  validate(z.object({ entityId: FLOW_PERIOD.entityId }), 'query'), flowCtrl.slowMovers);
module.exports = router;
