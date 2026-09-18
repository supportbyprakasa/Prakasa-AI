const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { requireEntityScope } = require('../middleware/entityScope');
const ctrl = require('../controllers/approvalMatrix.controller');

const ruleSchema = z.object({
  level: z.number().int().positive().optional(),
  orderIndex: z.number().int().positive().optional(),
  approverRoleId: z.number().int().positive().nullable().optional(),
  approverUserId: z.number().int().positive().nullable().optional(),
  signerUserId: z.number().int().positive().nullable().optional(),
  signerRoleId: z.number().int().positive().nullable().optional(),
  parallelGroup: z.string().min(1).max(40).nullable().optional(),
  isOptional: z.boolean().optional(),
  escalationUserId: z.number().int().positive().nullable().optional(),
  escalationRoleId: z.number().int().positive().nullable().optional(),
  reminderAfterHours: z.number().int().nonnegative().nullable().optional(),
  escalateAfterHours: z.number().int().nonnegative().nullable().optional(),
});

const createBody = z.object({
  matrixKey: z.string().min(1).max(120).regex(/^[a-z0-9:_-]+$/),
  matrixName: z.string().min(1).max(190),
  departmentId: z.number().int().positive().nullable().optional(),
  documentType: z.string().max(80).nullable().optional(),
  documentTypeId: z.number().int().positive().nullable().optional(),
  requestType: z.string().max(80).nullable().optional(),
  amountMin: z.number().nonnegative().nullable().optional(),
  amountMax: z.number().nonnegative().nullable().optional(),
  currency: z.string().min(3).max(8).optional(),
  flowType: z.enum(['sequential', 'parallel']).default('sequential'),
  priority: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
  rules: z.array(ruleSchema).min(1).max(100),
});

const ruleUpdateBody = z.object({
  level: z.number().int().positive().optional(),
  orderIndex: z.number().int().positive().optional(),
  approverRoleId: z.number().int().positive().nullable().optional(),
  approverUserId: z.number().int().positive().nullable().optional(),
  signerUserId: z.number().int().positive().nullable().optional(),
  signerRoleId: z.number().int().positive().nullable().optional(),
  parallelGroup: z.string().min(1).max(40).nullable().optional(),
  isOptional: z.boolean().optional(),
  escalationUserId: z.number().int().positive().nullable().optional(),
  escalationRoleId: z.number().int().positive().nullable().optional(),
  reminderAfterHours: z.number().int().nonnegative().nullable().optional(),
  escalateAfterHours: z.number().int().nonnegative().nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Minimal satu field update wajib',
});

const matrixUpdateBody = z.object({
  matrixName: z.string().min(1).max(190).optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  documentType: z.string().max(80).nullable().optional(),
  documentTypeId: z.number().int().positive().nullable().optional(),
  requestType: z.string().max(80).nullable().optional(),
  amountMin: z.number().nonnegative().nullable().optional(),
  amountMax: z.number().nonnegative().nullable().optional(),
  currency: z.string().min(3).max(8).optional(),
  flowType: z.enum(['sequential', 'parallel']).optional(),
  priority: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Minimal satu field update wajib',
});

router.use(requireAuth);
router.use(requireEntityScope);

router.get('/', requirePermission('approval_matrix.view'), ctrl.list);
router.get('/matrix-keys', requirePermission('approval_matrix.view'), ctrl.matrixKeys);
router.get('/:id', requirePermission('approval_matrix.view'), ctrl.detail);
router.post('/', requirePermission('approval_matrix.manage'), validate(createBody), ctrl.createMatrix);
router.patch('/rules/:id',
  requirePermission('approval_matrix.manage'),
  validate(ruleUpdateBody),
  ctrl.updateRule);
router.patch('/matrix/:matrixKey',
  requirePermission('approval_matrix.manage'),
  validate(matrixUpdateBody),
  ctrl.updateMatrix);
router.delete('/rules/:id', requirePermission('approval_matrix.manage'), ctrl.removeRule);
router.delete('/matrix/:matrixKey', requirePermission('approval_matrix.manage'), ctrl.removeMatrix);

module.exports = router;
