const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const checklistCtrl = require('../controllers/warehouseChecklists.controller');
const incidentCtrl = require('../controllers/warehouseIncidents.controller');
const movementCtrl = require('../controllers/warehouseMovements.controller');
const accurateCtrl = require('../controllers/warehouseAccurate.controller');
const reconCtrl = require('../controllers/warehouseRecon.controller');
const { cachedResponse } = require('../middleware/cachedResponse');
// Stock and the reconciliation list: cached 60 s per scope (cachedResponse.js).
const warehouseCache = cachedResponse('warehouse:', 60 * 1000);

router.use(requireAuth);

// ---------- Stock from Accurate (read-only; quantities only)
router.get('/accurate/status', requirePermission('warehouse.stock.view'), accurateCtrl.status);
router.get('/accurate/sync', requirePermission('warehouse.accurate.sync'), accurateCtrl.syncStatus);
router.post('/accurate/sync', requirePermission('warehouse.accurate.sync'), accurateCtrl.startSync);
router.get('/stock',
  requirePermission('warehouse.stock.view'),
  validate(z.object({
    q: z.string().max(100).optional(),
    status: z.enum(['ada', 'habis', 'minus', 'menipis']).optional(),
    warehouseId: z.coerce.number().int().positive().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  }), 'query'),
  warehouseCache,
  accurateCtrl.listStock);
router.get('/stock/:itemId', requirePermission('warehouse.stock.view'), accurateCtrl.stockItem);
router.get('/today', requirePermission('warehouse.stock.view'), accurateCtrl.today);
router.get('/shipping',
  requirePermission('warehouse.stock.view'),
  validate(z.object({
    q: z.string().max(100).optional(),
    status: z.enum(['short', 'late']).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  }), 'query'),
  accurateCtrl.listShipping);
router.get('/shipping/:id',
  requirePermission('warehouse.stock.view'),
  validate(z.object({ id: z.coerce.number().int().positive() }), 'params'),
  accurateCtrl.getShipping);
router.get('/documents',
  requirePermission('warehouse.stock.view'),
  validate(z.object({
    type: z.enum(['delivery', 'receipt', 'transfer', 'adjustment']).optional(),
    q: z.string().max(100).optional(),
    from: z.string().max(10).optional(),
    to: z.string().max(10).optional(),
    warehouse: z.string().max(120).optional(),
    status: z.enum(['in_transit']).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  }), 'query'),
  accurateCtrl.listDocuments);
router.get('/documents/:type/:id',
  requirePermission('warehouse.stock.view'),
  validate(z.object({ type: z.enum(['delivery', 'receipt', 'transfer', 'adjustment']), id: z.coerce.number().int().positive() }), 'params'),
  accurateCtrl.getDocument);

// ---------- Inbound / outbound movements (entity and division come from auth, never the body)
const movementType = z.enum(['inbound', 'outbound']);
const movementParams = z.object({ type: movementType, id: z.coerce.number().int().positive() });
const movementItem = z.object({
  sku: z.string().max(80).nullable().optional(),
  product: z.string().max(190),
  quantity: z.union([z.number(), z.string().max(30)]),
  unit: z.string().max(40),
  batchNo: z.string().max(80).nullable().optional(),
  expiresOn: z.string().max(10).nullable().optional(),
  location: z.string().max(120).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});
const movementFields = {
  movementDate: z.string().max(10),
  referenceNo: z.string().max(80).nullable().optional(),
  party: z.string().max(255).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  items: z.array(movementItem).max(200),
};

router.get('/movements',
  requirePermission('warehouse.movement.view'),
  validate(z.object({
    type: movementType.optional(),
    status: z.enum(['draft', 'pending_approval', 'revision_requested', 'approved', 'rejected', 'cancelled']).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    q: z.string().max(80).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }), 'query'),
  movementCtrl.list);
router.get('/movements/:type/:id',
  requirePermission('warehouse.movement.view'),
  validate(movementParams, 'params'),
  movementCtrl.detail);
router.post('/movements',
  requirePermission('warehouse.movement.create'),
  validate(z.object({ type: movementType, ...movementFields }).strict()),
  movementCtrl.create);
router.patch('/movements/:type/:id',
  requirePermission('warehouse.movement.update'),
  validate(movementParams, 'params'),
  validate(z.object({ version: z.number().int().positive(), ...movementFields }).strict()),
  movementCtrl.update);
router.post('/movements/:type/:id/submit',
  requirePermission('warehouse.movement.submit'),
  validate(movementParams, 'params'),
  validate(z.object({ version: z.number().int().positive().optional() }).strict()),
  movementCtrl.submit);
router.post('/movements/:type/:id/cancel',
  requirePermission('warehouse.movement.cancel'),
  validate(movementParams, 'params'),
  validate(z.object({ reason: z.string().trim().min(1).max(500), version: z.number().int().positive().optional() }).strict()),
  movementCtrl.cancel);
router.get('/movements/:type/:id/audit',
  requirePermission('warehouse.movement.audit.view'),
  validate(movementParams, 'params'),
  movementCtrl.audit);

// ---------- Pencocokan dengan Accurate (program 3.2; quantities only, Accurate is only read)
const reconDirection = z.enum(['inbound', 'outbound']);
const reconKey = z.string().regex(/^(?:(?=[A-Z0-9]*[0-9])[A-Z0-9]{4,80}|m-\d{1,10}|(?:receipt|delivery)-\d{1,19})$/);
const reconGroupParams = z.object({ direction: reconDirection, groupKey: reconKey });
const reconIdParams = z.object({ id: z.coerce.number().int().positive() });
const reconCancel = z.object({ reason: z.string().trim().min(3).max(255) }).strict();
router.get('/recon',
  requirePermission('warehouse.recon.view'),
  validate(z.object({
    status: z.enum(['open', 'qty_diff', 'app_only', 'acc_only', 'uncomparable', 'waiting', 'explained', 'matched', 'all']).optional(),
    direction: reconDirection.optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    q: z.string().max(80).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  }), 'query'),
  warehouseCache,
  reconCtrl.list);
router.get('/recon/movement/:type/:id',
  requirePermission('warehouse.recon.view'),
  validate(movementParams, 'params'),
  reconCtrl.forMovement);
router.get('/recon/:direction/:groupKey',
  requirePermission('warehouse.recon.view'),
  validate(reconGroupParams, 'params'),
  reconCtrl.detail);
router.get('/recon/:direction/:groupKey/candidates',
  requirePermission('warehouse.recon.resolve'),
  validate(reconGroupParams, 'params'),
  validate(z.object({ q: z.string().max(80).optional() }), 'query'),
  reconCtrl.candidates);
router.post('/recon/links',
  requirePermission('warehouse.recon.resolve'),
  validate(z.object({
    direction: reconDirection,
    movementId: z.number().int().positive(),
    docType: z.enum(['receipt', 'delivery', 'transfer', 'adjustment']),
    docId: z.number().int().positive(),
    reason: z.string().trim().max(255).optional(),
  }).strict()),
  reconCtrl.link);
router.post('/recon/links/:id/cancel',
  requirePermission('warehouse.recon.resolve'),
  validate(reconIdParams, 'params'),
  validate(reconCancel),
  reconCtrl.unlink);
router.post('/recon/notes',
  requirePermission('warehouse.recon.resolve'),
  validate(z.object({
    direction: reconDirection,
    groupKey: reconKey,
    signature: z.string().regex(/^[0-9a-f]{64}$/),
    reason: z.string().trim().min(5).max(500),
  }).strict()),
  reconCtrl.explain);
router.post('/recon/notes/:id/cancel',
  requirePermission('warehouse.recon.resolve'),
  validate(reconIdParams, 'params'),
  validate(reconCancel),
  reconCtrl.unexplain);

router.get('/checklists', requirePermission('warehouse.checklist.view'), checklistCtrl.list);
router.post('/checklists',
  requirePermission('warehouse.checklist.manage'),
  validate(z.object({
    // Company and division come from the signed-in user, never from the body.
    checklistDate: z.string(),
    title: z.string().min(1).max(190),
    items: z.array(z.object({
      label: z.string(),
      checked: z.boolean().optional(),
      note: z.string().nullable().optional(),
    })).optional(),
  })),
  checklistCtrl.create);
router.patch('/checklists/:id/complete',
  requirePermission('warehouse.checklist.manage'),
  validate(z.object({
    items: z.array(z.object({
      label: z.string(),
      checked: z.boolean().optional(),
      note: z.string().nullable().optional(),
    })),
  })),
  checklistCtrl.complete);

// ---------- Incidents
router.get('/incidents', requirePermission('warehouse.incident.view'), incidentCtrl.list);
router.post('/incidents',
  requirePermission('warehouse.incident.manage'),
  validate(z.object({
    // Company and division come from the signed-in user, never from the body.
    incidentDate: z.string(),
    category: z.string().min(1).max(80),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    description: z.string().min(1),
    photos: z.array(z.string()).nullable().optional(),
  })),
  incidentCtrl.create);
router.patch('/incidents/:id/resolve',
  requirePermission('warehouse.incident.manage'),
  validate(z.object({
    status: z.enum(['open', 'investigating', 'resolved', 'closed']).optional(),
    resolution: z.string().nullable().optional(),
  })),
  incidentCtrl.resolve);

module.exports = router;
