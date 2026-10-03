const router = require('express').Router();
const { cachedResponse } = require('../middleware/cachedResponse');
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { ok, fail } = require('../utils/response');
const receivables = require('../services/financeReceivables.service');
const payables = require('../services/financePayables.service');

// Finance reports (mounted at /finance/reports): Piutang from the approved
// Sales invoices and receipts, Utang from the approved Finance pull (purchase
// invoices and payments). Read only — nothing here writes anywhere. Finance
// sees the whole company; no division filter is taken from the request.
//
//   GET /receivables            everything the Piutang page shows
//   GET /receivables/summary | aging | customers | due-soon | collections
//   GET /payables               everything the Utang page shows
//   GET /payables/summary | aging | vendors | due-soon | overdue | payments
// Every answer carries `ready`; before the data exists it is
// { ready: false, reason } and nothing else.
router.use(requireAuth);

const RECEIVABLE = requirePermission('finance.receivable.view');
const PAYABLE = requirePermission('finance.payable.view');
const LIST = validate(z.object({ limit: z.coerce.number().int().positive().max(100).optional() }), 'query');
const SOON = validate(z.object({
  days: z.coerce.number().int().positive().max(60).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}), 'query');

const handle = (fn) => async (req, res, next) => {
  try {
    return ok(res, await fn(req));
  } catch (e) {
    if (e.status && e.code) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
};

// One receivables figure, behind the same readiness check as the page.
const receivable = (key, read) => handle(async (req) => {
  const state = await receivables.status(req.user.entityId);
  if (!state.ready) return { ready: false, reason: state.reason };
  return { ready: true, asOf: state.asOf, [key]: await read(req.user.entityId, req.query) };
});

// The two report pages are cached 60 s per scope (middleware/cachedResponse.js).
const financeCache = cachedResponse('finance:', 60 * 1000);
router.get('/receivables', RECEIVABLE, financeCache, handle((req) => receivables.overview(req.user.entityId)));
router.get('/receivables/summary', RECEIVABLE, receivable('summary', (entityId) => receivables.summary(entityId)));
router.get('/receivables/aging', RECEIVABLE, receivable('aging', (entityId) => receivables.aging(entityId)));
router.get('/receivables/customers', RECEIVABLE, LIST, receivable('customers', (entityId, q) => receivables.customers(entityId, { limit: q.limit })));
router.get('/receivables/due-soon', RECEIVABLE, SOON, receivable('dueSoon', (entityId, q) => receivables.dueSoon(entityId, { days: q.days, limit: q.limit })));
router.get('/receivables/collections', RECEIVABLE, receivable('collections', (entityId) => receivables.collections(entityId)));

router.get('/payables', PAYABLE, financeCache, handle((req) => payables.overview(req.user.entityId)));
router.get('/payables/summary', PAYABLE, handle((req) => payables.summary(req.user.entityId)));
router.get('/payables/aging', PAYABLE, handle((req) => payables.aging(req.user.entityId)));
router.get('/payables/vendors', PAYABLE, LIST, handle((req) => payables.vendors(req.user.entityId, { limit: req.query.limit })));
router.get('/payables/due-soon', PAYABLE, SOON, handle((req) => payables.dueSoon(req.user.entityId, { days: req.query.days, limit: req.query.limit })));
router.get('/payables/overdue', PAYABLE, LIST, handle((req) => payables.overdue(req.user.entityId, { limit: req.query.limit })));
router.get('/payables/payments', PAYABLE, handle((req) => payables.payments(req.user.entityId)));

module.exports = router;
