const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { requireEntityScope } = require('../middleware/entityScope');
const ctrl = require('../controllers/workflows.controller');

const statusSchema = z.object({
  code: z.string().min(1).max(80).regex(/^[a-z0-9_-]+$/, 'Code hanya huruf kecil, angka, dash, underscore'),
  label: z.string().min(1).max(120),
  color: z.string().max(20).regex(/^#[0-9a-fA-F]{3,8}$/, 'Format warna hex tidak valid').optional(),
  isInitial: z.boolean().optional(),
  isFinal: z.boolean().optional(),
  orderIndex: z.number().int().optional(),
});

const transitionSchema = z.object({
  fromStatusCode: z.string().min(1).max(80).regex(/^[a-z0-9_-]+$/),
  toStatusCode: z.string().min(1).max(80).regex(/^[a-z0-9_-]+$/),
  actionLabel: z.string().min(1).max(120),
  requiredPermissionCode: z.string().max(100).nullable().optional(),
  requiresApproval: z.boolean().optional(),
  requiresSignature: z.boolean().optional(),
  requiresComment: z.boolean().optional(),
  orderIndex: z.number().int().optional(),
});

const createBody = z.object({
  name: z.string().min(1).max(190),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
  description: z.string().nullable().optional(),
  appliesTo: z.string().max(80).nullable().optional(),
  referenceId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
  statuses: z.array(statusSchema).min(1),
  transitions: z.array(transitionSchema).optional(),
});

router.use(requireAuth);

router.get('/',
  requireEntityScope,
  requirePermission('workflow_definition.view'),
  ctrl.list);
router.get('/:id',
  requireEntityScope,
  requirePermission('workflow_definition.view'),
  ctrl.detail);
router.post('/',
  requireEntityScope,
  requirePermission('workflow_definition.manage'),
  validate(createBody),
  ctrl.create);
router.patch('/:id',
  requireEntityScope,
  requirePermission('workflow_definition.manage'),
  validate(createBody.partial().omit({ slug: true, statuses: true, transitions: true })),
  ctrl.update);
router.delete('/:id',
  requireEntityScope,
  requirePermission('workflow_definition.manage'),
  ctrl.remove);

// Statuses
router.post('/:id/statuses',
  requireEntityScope,
  requirePermission('workflow_definition.manage'),
  validate(statusSchema),
  ctrl.createStatus);
router.patch('/:id/statuses/:statusId',
  requireEntityScope,
  requirePermission('workflow_definition.manage'),
  validate(statusSchema.partial().omit({ code: true })),
  ctrl.updateStatus);
router.delete('/:id/statuses/:statusId',
  requireEntityScope,
  requirePermission('workflow_definition.manage'),
  ctrl.removeStatus);

// Transitions
router.post('/:id/transitions',
  requireEntityScope,
  requirePermission('workflow_definition.manage'),
  validate(transitionSchema),
  ctrl.createTransition);
router.patch('/:id/transitions/:transitionId',
  requireEntityScope,
  requirePermission('workflow_definition.manage'),
  validate(transitionSchema.partial().omit({ fromStatusCode: true, toStatusCode: true })),
  ctrl.updateTransition);
router.delete('/:id/transitions/:transitionId',
  requireEntityScope,
  requirePermission('workflow_definition.manage'),
  ctrl.removeTransition);

module.exports = router;
