const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const tasksCtrl = require('../controllers/warehouseSampleTasks.controller');
const proofCtrl = require('../controllers/warehouseDeliveryProofs.controller');
const checklistCtrl = require('../controllers/warehouseChecklists.controller');
const incidentCtrl = require('../controllers/warehouseIncidents.controller');
const movementCtrl = require('../controllers/warehouseMovements.controller');

router.use(requireAuth);

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

// ---------- Sample tasks
router.get('/sample-tasks', requirePermission('warehouse.sample.view'), tasksCtrl.list);
router.patch('/sample-tasks/:id/assign',
  requirePermission('warehouse.sample.manage'),
  validate(z.object({ assignedTo: z.number().int().positive().nullable() })),
  tasksCtrl.assign);
router.patch('/sample-tasks/:id/status',
  requirePermission('warehouse.sample.manage'),
  validate(z.object({
    status: z.enum(['queued', 'preparing', 'ready', 'delivered', 'cancelled']),
    notes: z.string().nullable().optional(),
  })),
  tasksCtrl.updateStatus);

// ---------- Delivery proofs
router.get('/delivery-proofs', requirePermission('warehouse.sample.view'), proofCtrl.list);
router.post('/delivery-proofs',
  requirePermission('warehouse.delivery_proof.upload'),
  upload.single('photo'),
  validate(z.object({
    entityId: z.coerce.number().int().positive(),
    departmentId: z.coerce.number().int().positive().optional().nullable(),
    sampleTaskId: z.coerce.number().int().positive(),
    recipientName: z.string().max(190).nullable().optional(),
    recipientPhone: z.string().max(40).nullable().optional(),
    deliveredAt: z.string().nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    notes: z.string().nullable().optional(),
  })),
  proofCtrl.upload);

// ---------- Checklists
router.get('/checklists', requirePermission('warehouse.checklist.view'), checklistCtrl.list);
router.post('/checklists',
  requirePermission('warehouse.checklist.manage'),
  validate(z.object({
    entityId: z.number().int().positive(),
    departmentId: z.number().int().positive().nullable().optional(),
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
    entityId: z.number().int().positive(),
    departmentId: z.number().int().positive().nullable().optional(),
    incidentDate: z.string(),
    category: z.string().min(1).max(80),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    description: z.string().min(1),
    sampleTaskId: z.number().int().positive().nullable().optional(),
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
