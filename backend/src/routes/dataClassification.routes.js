const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/dataClassification.controller');

const body = z.object({
  entityId: z.number().int().positive(),
  subjectType: z.string().min(1).max(80),
  subjectId: z.number().int().positive(),
  classification: z.enum(['public', 'internal', 'confidential', 'restricted']),
  tags: z.array(z.string()).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

router.use(requireAuth);
router.get('/', requirePermission('data_classification.view'), ctrl.list);
router.get('/:subjectType/:subjectId', requirePermission('data_classification.view'), ctrl.get);
router.post('/', requirePermission('data_classification.manage'), validate(body), ctrl.upsert);

module.exports = router;
