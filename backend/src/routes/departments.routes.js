const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/departments.controller');

const body = z.object({
  entityId: z.number().int().positive(),
  name: z.string().min(1).max(150),
});

router.use(requireAuth);
router.get('/', requirePermission('department.manage'), ctrl.list);
router.post('/', requirePermission('department.manage'), validate(body), ctrl.create);
router.patch('/:id', requirePermission('department.manage'), validate(body.partial()), ctrl.update);
router.delete('/:id', requirePermission('department.manage'), ctrl.remove);
module.exports = router;
