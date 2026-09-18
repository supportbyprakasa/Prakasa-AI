const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { requireEntityScope } = require('../middleware/entityScope');
const ctrl = require('../controllers/signatures.controller');

const assetBody = z.object({
  imageBase64: z.string().min(20),
});

const createBody = z.object({
  entityId: z.number().int().positive().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  documentId: z.number().int().positive(),
  approvalRequestId: z.number().int().positive(),
  signatureType: z.enum(['level_1', 'level_2']).optional(),
  signerUserId: z.number().int().positive().nullable().optional(),
  signerRoleId: z.number().int().positive().nullable().optional(),
});

const signBody = z.object({
  overridePrecheck: z.boolean().optional(),
  overrideReason: z.string().max(500).nullable().optional(),
});

router.use(requireAuth);
router.use(requireEntityScope);

router.get('/', requirePermission('signature.view'), ctrl.list);
router.get('/:id', requirePermission('signature.view'), ctrl.detail);
router.post('/asset',
  requirePermission('signature.manage_asset'),
  validate(assetBody),
  ctrl.saveSignatureAsset);
router.post('/',
  requirePermission('signature.request'),
  validate(createBody),
  ctrl.create);
router.post('/:id/precheck',
  requirePermission('signature_precheck.run'),
  ctrl.runPrecheck);
router.post('/:id/sign',
  requirePermission('signature.sign'),
  validate(signBody),
  ctrl.sign);

module.exports = router;
