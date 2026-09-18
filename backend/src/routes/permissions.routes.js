const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/permissions.controller');

const body = z.object({
  code: z.string().min(2).max(100),
  description: z.string().max(255).optional().nullable(),
});

router.use(requireAuth);
router.get('/', requirePermission('permission.manage'), ctrl.list);
router.post('/', requirePermission('permission.manage'), validate(body), ctrl.create);
router.patch('/:id', requirePermission('permission.manage'), validate(body.partial()), ctrl.update);
router.delete('/:id', requirePermission('permission.manage'), ctrl.remove);
module.exports = router;
