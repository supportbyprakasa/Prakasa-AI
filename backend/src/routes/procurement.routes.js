const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/procurementAccurate.controller');

// Procurement from approved Accurate data (read-only; prices gated inside).
router.use(requireAuth);

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const PAGE = { page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).optional() };
const ID = validate(z.object({ id: z.coerce.number().int().positive() }), 'params');

router.get('/accurate/status', requirePermission('procurement.view'), ctrl.status);
router.get('/accurate/sync', requirePermission('procurement.accurate.sync'), ctrl.syncStatus);
router.post('/accurate/sync', requirePermission('procurement.accurate.sync'), ctrl.startSync);
router.get('/today', requirePermission('procurement.view'), ctrl.today);
router.get('/orders',
  requirePermission('procurement.view'),
  validate(z.object({
    state: z.enum(['all', 'open', 'partial', 'late', 'received', 'closed', 'legacy']).optional(),
    q: z.string().max(100).optional(),
    vendor: z.string().max(80).optional(),
    from: DATE.optional(),
    to: DATE.optional(),
    ...PAGE,
  }), 'query'),
  ctrl.listOrders);
router.get('/orders/:id', requirePermission('procurement.view'), ID, ctrl.getOrder);
router.get('/vendors',
  requirePermission('procurement.view'),
  validate(z.object({ q: z.string().max(100).optional(), filter: z.enum(['all', 'active', 'late', 'no_po', 'inactive']).optional(), ...PAGE }), 'query'),
  ctrl.listVendors);
router.get('/vendors/:id', requirePermission('procurement.view'), ID, ctrl.getVendor);
// Saran pesan ulang (program 3.1): total stock and days of cover — Procurement
// Supervisor/Head and the Management Office only (D2 extended, 30 Sep 2026).
router.get('/reorder',
  requirePermission('procurement.reorder.view'),
  validate(z.object({
    urgency: z.enum(['all', 'critical', 'reorder', 'out']).optional(),
    q: z.string().max(100).optional(), vendor: z.string().max(120).optional(),
    // "Belum ada PO" (the escalation's link): nothing on order yet.
    noPo: z.enum(['1']).optional(), ...PAGE,
  }), 'query'),
  ctrl.listReorder);
// Harga beli (program 3.1): purchase prices only for the Procurement
// Supervisor/Head and the Management Office (P1).
router.get('/prices',
  requirePermission('procurement.price.view'),
  validate(z.object({
    q: z.string().max(100).optional(), vendor: z.string().max(120).optional(),
    trend: z.enum(['all', 'up', 'down', 'single']).optional(), ...PAGE,
  }), 'query'),
  ctrl.listPrices);
router.get('/prices/history',
  requirePermission('procurement.price.view'),
  validate(z.object({ vendor: z.string().min(1).max(80), item: z.string().min(1).max(80), unit: z.string().min(1).max(40) }), 'query'),
  ctrl.priceHistory);

module.exports = router;
