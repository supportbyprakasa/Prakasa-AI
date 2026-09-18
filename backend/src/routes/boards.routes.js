const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/boards.controller');
const taskCtrl = require('../controllers/tasks.controller');

const boardBody = z.object({
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1).max(190),
  description: z.string().max(500).nullable().optional(),
  columns: z.array(z.object({ name: z.string().min(1), position: z.number().int() })).optional(),
});

router.use(requireAuth);
router.get('/', requirePermission('board.view'), ctrl.list);
router.get('/:id', requirePermission('board.view'), ctrl.detail);
router.get('/:id/tasks', requirePermission('task.view'), taskCtrl.listByBoard);
router.post('/', requirePermission('board.manage'), validate(boardBody), ctrl.create);
router.delete('/:id', requirePermission('board.manage'), ctrl.remove);
module.exports = router;
