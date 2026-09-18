const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { requireEntityScope } = require('../middleware/entityScope');
const ctrl = require('../controllers/signatureQr.controller');

router.use(requireAuth);
router.use(requireEntityScope);

router.post('/generate',
  requirePermission('signature_qr.generate'),
  validate(z.object({
    entityId: z.number().int().positive().optional(),
    documentId: z.number().int().positive(),
    signatureRequestId: z.number().int().positive().nullable().optional(),
  })),
  ctrl.generate);

router.get('/document/:documentId',
  requirePermission('signature_qr.view'),
  ctrl.getForDocument);

module.exports = router;
