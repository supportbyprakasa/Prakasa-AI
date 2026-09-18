const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/signatures.controller');

const assetBody = z.object({ imageBase64: z.string().min(20) });

const createBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  documentId: z.number().int().positive(),
  approvalRequestId: z.number().int().positive(),
  signatureType: z.enum(['level_1', 'level_2']).optional(),
  signerUserId: z.number().int().positive().nullable().optional(),
});

router.use(requireAuth);
router.get('/', requirePermission('signature.view'), ctrl.list);
router.post('/asset', requirePermission('signature.manage_asset'), validate(assetBody), ctrl.saveSignatureAsset);
router.post('/', requirePermission('signature.request'), validate(createBody), ctrl.create);
router.post('/:id/sign', requirePermission('signature.sign'), ctrl.sign);

// Endpoint verifikasi publik (sengaja di luar requireAuth)
module.exports = router;

// router terpisah untuk verifikasi publik (dipasang tanpa requireAuth di index.js)
const publicRouter = require('express').Router();
publicRouter.get('/verify/:code', ctrl.verify);
module.exports.publicRouter = publicRouter;
