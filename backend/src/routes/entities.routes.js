const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/entities.controller');
const body = z.object({
  name: z.string().min(1).max(150),
  brandCode: z.string().min(1).max(50),
  logoUrl: z.string().url().optional().nullable(),
});
router.use(requireAuth);
router.get('/', requirePermission('entity.manage'), ctrl.list);
router.post('/', requirePermission('entity.manage'), validate(body), ctrl.create);
router.patch('/:id', requirePermission('entity.manage'), validate(body.partial()), ctrl.update);
router.delete('/:id', requirePermission('entity.manage'), ctrl.remove);
module.exports = router;
