const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const { z } = require('zod');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/timeline.controller');

const ganttQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  entityId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
}).strict();

router.use(requireAuth);
router.get(
  '/gantt',
  requirePermission('timeline.view'),
  requirePermission('task.view'),
  validate(ganttQuery, 'query'),
  ctrl.gantt
);
router.get('/', requirePermission('timeline.view'), ctrl.timeline);
module.exports = router;
