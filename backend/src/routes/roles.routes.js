const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/roles.controller');

const createSchema = z.object({
  entityId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  permissionIds: z.array(z.number().int().positive()).optional(),
});
const updateSchema = createSchema.partial();

router.use(requireAuth);
router.get('/', requirePermission('role.manage'), ctrl.list);
router.get('/:id', requirePermission('role.manage'), ctrl.detail);
router.post('/', requirePermission('role.manage'), validate(createSchema), ctrl.create);
router.patch('/:id', requirePermission('role.manage'), validate(updateSchema), ctrl.update);
router.delete('/:id', requirePermission('role.manage'), ctrl.remove);
module.exports = router;
