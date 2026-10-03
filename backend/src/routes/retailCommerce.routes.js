const router = require('express').Router();
const { z } = require('zod');
const { ok } = require('../utils/response');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const retail = require('../services/retailCommerce.service');
const { cachedResponse } = require('../middleware/cachedResponse');

// Retail Commerce — marketplace performance (migration 120). Read-only views
// of the approved Accurate mirror, scoped to the caller's entity and the
// Retail Commerce department. Mounted at /retail-commerce.
router.use(requireAuth);
// Every page here is a read of the mirror for the company: cached 60 s per
// scope (middleware/cachedResponse.js), dropped when a batch is approved.
const canView = [requirePermission('retail.insight.view'), cachedResponse('retail:', 60 * 1000)];

const handle = (fn) => async (req, res, next) => {
  try {
    return ok(res, await fn(req));
  } catch (e) {
    return next(e);
  }
};

router.get(
  '/overview',
  canView,
  validate(z.object({ months: z.coerce.number().int().min(3).max(24).optional() }), 'query'),
  handle((req) => retail.overview(req.user, { months: req.query.months })),
);
router.get(
  '/top-products',
  canView,
  validate(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }), 'query'),
  handle((req) => retail.topProducts(req.user, { month: req.query.month })),
);
router.get('/pending-shipments', canView, handle((req) => retail.pendingShipments(req.user)));
router.get('/receivables', canView, handle((req) => retail.receivables(req.user)));

module.exports = router;
