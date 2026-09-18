const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/decisionLog.controller');

const body = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).max(255),
  decision: z.string().min(1),
  rationale: z.string().nullable().optional(),
  impact: z.string().nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  status: z.enum(['proposed', 'approved', 'implemented', 'rejected', 'archived']).optional(),
  decidedByUserId: z.number().int().positive().nullable().optional(),
  effectiveDate: z.string().nullable().optional(),
  subjectType: z.string().max(80).nullable().optional(),
  subjectId: z.number().int().positive().nullable().optional(),
  contextRecordId: z.number().int().positive().nullable().optional(),
  attachmentDocumentId: z.number().int().positive().nullable().optional(),
});

router.use(requireAuth);
router.get('/', requirePermission('decision_log.view'), ctrl.list);
router.post('/', requirePermission('decision_log.manage'), validate(body), ctrl.create);
router.patch('/:id', requirePermission('decision_log.manage'), validate(body.partial()), ctrl.update);
router.delete('/:id', requirePermission('decision_log.manage'), ctrl.remove);

module.exports = router;
