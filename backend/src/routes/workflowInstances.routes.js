const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { requireEntityScope } = require('../middleware/entityScope');
const ctrl = require('../controllers/workflowInstances.controller');

router.use(requireAuth);

router.get('/',
  requireEntityScope,
  requirePermission('workflow_instance.view'),
  ctrl.listByEntity);
router.get('/by-subject',
  requirePermission('workflow_instance.view'),
  ctrl.listBySubject);
router.get('/:id',
  requirePermission('workflow_instance.view'),
  ctrl.detail);
router.post('/:id/transition',
  requirePermission('workflow_instance.transition'),
  validate(z.object({
    transitionId: z.number().int().positive(),
    comment: z.string().nullable().optional(),
    metadata: z.record(z.any()).nullable().optional(),
  })),
  ctrl.transition);

module.exports = router;
