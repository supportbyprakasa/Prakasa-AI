const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/approvals.controller');

const createBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  documentId: z.number().int().positive().nullable().optional(),
  subjectType: z.string().min(1).max(80).optional(),
  subjectId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  approvalType: z.enum(['level_1', 'level_2']).optional(),
});

const decideBody = z.object({
  action: z.enum(['approve', 'reject', 'request_revision']),
  note: z.string().max(500).nullable().optional(),
});

router.use(requireAuth);
router.get('/', requirePermission('approval.view'), ctrl.list);
router.get('/:id', requirePermission('approval.view'), ctrl.detail);
router.post('/', requirePermission('approval.request'), validate(createBody), ctrl.create);
router.patch('/:id', requirePermission('approval.decide'), validate(decideBody), ctrl.decide);
module.exports = router;
