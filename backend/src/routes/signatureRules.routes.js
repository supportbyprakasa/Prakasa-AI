const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { requireEntityScope } = require('../middleware/entityScope');
const ctrl = require('../controllers/signatureRules.controller');

const body = z.object({
  documentTypeId: z.number().int().positive().nullable().optional(),
  appliesToFormId: z.number().int().positive().nullable().optional(),
  minApprovalLevel: z.number().int().nonnegative().optional(),
  requiredSignerRoleId: z.number().int().positive().nullable().optional(),
  requiredSignerUserId: z.number().int().positive().nullable().optional(),
  requiresAiPrecheck: z.boolean().optional(),
  allowDelegation: z.boolean().optional(),
  autoGenerateVerificationCode: z.boolean().optional(),
  qrRequired: z.boolean().optional(),
  checksumAlgorithm: z.enum(['sha256','sha512']).optional(),
  precheckModule: z.string().min(1).max(80).optional(),
  archiveFolderDriveId: z.string().max(190).nullable().optional(),
  isActive: z.boolean().optional(),
});

router.use(requireAuth);
router.get('/',
  requireEntityScope,
  requirePermission('signature_rule.view'),
  ctrl.list);
router.post('/',
  requireEntityScope,
  requirePermission('signature_rule.manage'),
  validate(body),
  ctrl.create);
router.patch('/:id',
  requireEntityScope,
  requirePermission('signature_rule.manage'),
  validate(body.partial()),
  ctrl.update);
router.delete('/:id',
  requireEntityScope,
  requirePermission('signature_rule.manage'),
  ctrl.remove);

module.exports = router;
