const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { requireEntityScope } = require('../middleware/entityScope');
const ctrl = require('../controllers/signaturePrecheck.controller');

const runBody = z.object({
  entityId: z.number().int().positive().optional(),
  documentId: z.number().int().positive(),
  signatureRequestId: z.number().int().positive().nullable().optional(),
  approvalRequestId: z.number().int().positive().nullable().optional(),
});

router.use(requireAuth);
router.use(requireEntityScope);

router.get('/', requirePermission('signature_precheck.view'), ctrl.list);
router.get('/:id', requirePermission('signature_precheck.view'), ctrl.detail);
router.post('/run',
  requirePermission('signature_precheck.run'),
  validate(runBody),
  ctrl.run);

module.exports = router;
