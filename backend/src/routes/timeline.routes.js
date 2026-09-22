const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { requireEntityScope } = require('../middleware/entityScope');
const ctrl = require('../controllers/timeline.controller');

const ganttQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  boardId: z.coerce.number().int().positive().optional(),
}).strict();

router.use(requireAuth);
router.use(requireEntityScope);

router.get(
  '/gantt',
  requirePermission('timeline.view'),
  validate(ganttQuery, 'query'),
  ctrl.gantt
);

router.get(
  '/',
  requirePermission('timeline.view'),
  ctrl.timeline
);

module.exports = router;
