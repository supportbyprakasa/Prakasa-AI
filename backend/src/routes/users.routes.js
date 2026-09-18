const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/users.controller');
const createSchema = z.object({
  name: z.string().min(1).max(150), email: z.string().email().max(190),
  entityId: z.number().int().positive(), departmentId: z.number().int().positive().nullable().optional(),
  status: z.enum(['active','inactive']).optional(), roleIds: z.array(z.number().int().positive()).optional(),
});
router.use(requireAuth);
router.get('/', requirePermission('user.manage'), ctrl.list);
router.get('/:id', requirePermission('user.manage'), ctrl.detail);
router.post('/', requirePermission('user.manage'), validate(createSchema), ctrl.create);
router.patch('/:id', requirePermission('user.manage'), validate(createSchema.partial()), ctrl.update);
router.delete('/:id', requirePermission('user.manage'), ctrl.remove);
module.exports = router;
