const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/tasks.controller');

const idParams = z.object({
  id: z.coerce.number().int().positive(),
}).strict();

const watcherParams = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
}).strict();

const checklistParams = z.object({
  id: z.coerce.number().int().positive(),
  itemId: z.coerce.number().int().positive(),
}).strict();

const dependencyParams = z.object({
  id: z.coerce.number().int().positive(),
  dependencyId: z.coerce.number().int().positive(),
}).strict();

const createBody = z.object({
  entityId: z.number().int().positive().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  boardId: z.number().int().positive().nullable().optional(),
  columnId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).max(255),
  description: z.string().max(10000).nullable().optional(),
  status: z.string().min(1).max(50).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  progressPercent: z.number().int().min(0).max(100).optional(),
}).strict();

const updateBody = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(10000).nullable().optional(),
  status: z.string().min(1).max(50).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  boardId: z.number().int().positive().nullable().optional(),
  columnId: z.number().int().positive().nullable().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  progressPercent: z.number().int().min(0).max(100).optional(),
  position: z.number().int().optional(),
}).strict();

const commentBody = z.object({
  body: z.string().min(1).max(5000),
}).strict();

router.use(requireAuth);

router.get(
  '/:id',
  requirePermission('task.view'),
  validate(idParams, 'params'),
  ctrl.detail
);
router.post(
  '/',
  requirePermission('task.create'),
  validate(createBody),
  ctrl.create
);
router.patch(
  '/:id',
  requirePermission('task.update'),
  validate(idParams, 'params'),
  validate(updateBody),
  ctrl.update
);
router.delete(
  '/:id',
  requirePermission('task.delete'),
  validate(idParams, 'params'),
  ctrl.remove
);

router.post(
  '/:id/comments',
  requirePermission('task.update'),
  validate(idParams, 'params'),
  validate(commentBody),
  ctrl.addComment
);

router.get(
  '/:id/activity',
  requirePermission('task.activity.view'),
  validate(idParams, 'params'),
  ctrl.listActivity
);

router.get(
  '/:id/watchers',
  requirePermission('task.view'),
  validate(idParams, 'params'),
  ctrl.listWatchers
);
router.post(
  '/:id/watchers',
  requirePermission('task.view'),
  validate(idParams, 'params'),
  validate(z.object({
    userId: z.number().int().positive().optional(),
  }).strict()),
  ctrl.addWatcher
);
router.delete(
  '/:id/watchers/:userId',
  requirePermission('task.view'),
  validate(watcherParams, 'params'),
  ctrl.removeWatcher
);

router.get(
  '/:id/checklist',
  requirePermission('task.view'),
  validate(idParams, 'params'),
  ctrl.listChecklist
);
router.post(
  '/:id/checklist',
  requirePermission('task.checklist.manage'),
  validate(idParams, 'params'),
  validate(z.object({
    title: z.string().min(1).max(500),
    position: z.number().int().optional(),
  }).strict()),
  ctrl.addChecklistItem
);
router.patch(
  '/:id/checklist/:itemId',
  requirePermission('task.checklist.manage'),
  validate(checklistParams, 'params'),
  validate(
    z.object({
      title: z.string().min(1).max(500).optional(),
      position: z.number().int().optional(),
      isDone: z.boolean().optional(),
    }).strict().refine(
      (value) => Object.keys(value).length > 0,
      { message: 'Minimal satu field harus diubah' }
    )
  ),
  ctrl.patchChecklistItem
);
router.delete(
  '/:id/checklist/:itemId',
  requirePermission('task.checklist.manage'),
  validate(checklistParams, 'params'),
  ctrl.removeChecklistItem
);
router.post(
  '/:id/checklist/reorder',
  requirePermission('task.checklist.manage'),
  validate(idParams, 'params'),
  validate(z.object({
    orderedIds: z.array(z.number().int().positive()).min(1),
  }).strict()),
  ctrl.reorderChecklist
);

router.get(
  '/:id/dependencies',
  requirePermission('task.view'),
  validate(idParams, 'params'),
  ctrl.listDependencies
);
router.post(
  '/:id/dependencies',
  requirePermission('task.dependency.manage'),
  validate(idParams, 'params'),
  validate(z.object({
    predecessorTaskId: z.number().int().positive(),
    successorTaskId: z.number().int().positive(),
    dependencyType: z.enum(['blocks', 'related']).optional(),
  }).strict()),
  ctrl.addDependency
);
router.delete(
  '/:id/dependencies/:dependencyId',
  requirePermission('task.dependency.manage'),
  validate(dependencyParams, 'params'),
  ctrl.removeDependency
);

module.exports = router;
