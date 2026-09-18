const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { requireEntityScope } = require('../middleware/entityScope');
const ctrl = require('../controllers/approvals.controller');

const createBody = z.object({
  entityId: z.number().int().positive().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  documentId: z.number().int().positive().nullable().optional(),
  subjectType: z.string().min(1).max(80).optional(),
  subjectId: z.number().int().positive().nullable().optional(),
  requestType: z.string().max(80).nullable().optional(),
  documentTypeId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  amount: z.number().nonnegative().nullable().optional(),
  currency: z.string().min(3).max(8).optional(),
  approvalType: z.enum(['level_1', 'level_2']).optional(),
});

const decisionBody = z.object({
  stepId: z.number().int().positive().optional(),
  action: z.enum(['approve', 'reject', 'skip', 'request_revision']),
  note: z.string().max(500).nullable().optional(),
});

router.use(requireAuth);

router.get('/', requireEntityScope, requirePermission('approval.view'), ctrl.list);
router.get('/:id/my-pending-steps',
  requireEntityScope,
  requirePermission('approval.view'),
  ctrl.myPendingSteps);
router.get('/:id', requireEntityScope, requirePermission('approval.view'), ctrl.detail);
router.post('/',
  requireEntityScope,
  requirePermission('approval.request'),
  validate(createBody),
  ctrl.create);
router.post('/:id/decide',
  requireEntityScope,
  requirePermission('approval.decide'),
  validate(decisionBody),
  ctrl.decide);

// Phase-3 backward-compatible decision endpoint.
router.patch('/:id',
  requireEntityScope,
  requirePermission('approval.decide'),
  validate(decisionBody),
  ctrl.decide);

module.exports = router;
