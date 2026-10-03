const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/accurateWrite.controller');

// Mounted at /api/v1/accurate-write. Proposing needs accurate.write.request
// (Sales, Retail Commerce, Procurement); the deciders (accurate.batch.view)
// read the same lists. Decisions go through /approvals/:id/decide.
router.use(requireAuth);
const readers = requirePermission(['accurate.write.request', 'accurate.batch.view']);
const proposers = requirePermission('accurate.write.request');

const ID = validate(z.object({ id: z.coerce.number().int().positive() }), 'params');
const PAGE = { page: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().positive().max(100).optional() };
const text = (max) => z.string().max(max).nullable().optional();

const body = z.object({
  recordType: z.enum(['customer', 'vendor']),
  action: z.enum(['create', 'update']),
  requestKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  localId: z.coerce.number().int().positive().nullable().optional(),
  accurateId: z.string().max(120).nullable().optional(),
  payload: z.object({
    number: text(60), name: z.string().min(1).max(120), category: text(60), contactPerson: text(120),
    phone: text(40), businessPhone: text(40), email: text(120), address: text(500), city: text(100), notes: text(500),
  }).strict(),
}).strict();

router.get('/requests',
  readers,
  validate(z.object({
    status: z.enum(['open', 'pending', 'queued', 'sent', 'confirmed', 'rejected', 'failed', 'cancelled']).optional(),
    recordType: z.enum(['customer', 'vendor']).optional(),
    mine: z.enum(['1']).optional(), localId: z.coerce.number().int().positive().optional(),
    q: z.string().max(100).optional(), ...PAGE,
  }), 'query'),
  ctrl.list);
router.get('/requests/:id', readers, ID, ctrl.detail);
router.post('/requests', proposers, validate(body), ctrl.create);
router.post('/requests/:id/cancel', readers, ID, validate(z.object({ note: z.string().min(1).max(500) }).strict()), ctrl.cancel);
// App customers that Accurate lacks or names differently.
router.get('/reconciliation',
  readers,
  validate(z.object({ kind: z.enum(['missing', 'name']).optional(), q: z.string().max(100).optional(), ...PAGE }), 'query'),
  ctrl.reconciliation);

module.exports = router;
