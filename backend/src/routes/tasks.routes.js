const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/tasks.controller');

const createBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  boardId: z.number().int().positive().nullable().optional(),
  columnId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  sourceType: z.string().max(50).nullable().optional(),
  sourceId: z.number().int().positive().nullable().optional(),
});

const updateBody = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  columnId: z.number().int().positive().nullable().optional(),
  status: z.string().max(50).nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  position: z.number().int().nullable().optional(),
});

router.use(requireAuth);
router.get('/:id', requirePermission('task.view'), ctrl.detail);
router.post('/', requirePermission('task.create'), validate(createBody), ctrl.create);
router.patch('/:id', requirePermission('task.update'), validate(updateBody), ctrl.update);
router.delete('/:id', requirePermission('task.delete'), ctrl.remove);
router.post('/:id/comments',
  requirePermission('task.update'),
  validate(z.object({ body: z.string().min(1) })),
  ctrl.addComment);
module.exports = router;
