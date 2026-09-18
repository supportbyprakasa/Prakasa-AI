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

router.use(requireAuth);

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
