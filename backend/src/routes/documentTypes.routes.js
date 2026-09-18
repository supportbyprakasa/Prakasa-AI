const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { requireEntityScope } = require('../middleware/entityScope');
const ctrl = require('../controllers/documentTypes.controller');

const body = z.object({
  code: z.string().min(1).max(80).regex(/^[a-z0-9-_]+$/),
  name: z.string().min(1).max(190),
  category: z.string().max(80).nullable().optional(),
  defaultWorkflowId: z.number().int().positive().nullable().optional(),
  defaultApprovalMatrixId: z.number().int().positive().nullable().optional(),
  defaultFolderId: z.string().max(190).nullable().optional(),
  requiresSignature: z.boolean().optional(),
  requiresAiPrecheck: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

router.use(requireAuth);
router.get('/',
  requireEntityScope,
  requirePermission('document_type.view'),
  ctrl.list);
router.get('/:id',
  requireEntityScope,
  requirePermission('document_type.view'),
  ctrl.detail);
router.post('/',
  requireEntityScope,
  requirePermission('document_type.manage'),
  validate(body),
  ctrl.create);
router.patch('/:id',
  requireEntityScope,
  requirePermission('document_type.manage'),
  validate(body.partial().omit({ code: true })),
  ctrl.update);
router.delete('/:id',
  requireEntityScope,
  requirePermission('document_type.manage'),
  ctrl.remove);

module.exports = router;
