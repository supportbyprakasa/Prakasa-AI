const router = require('express').Router();
const { z } = require('zod');
const requireAuth = require('../middleware/requireAuth');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/users.controller');

const createSchema = z.object({
  name: z.string().min(1).max(150),
  email: z.string().email().max(190),
  password: z.string().min(10).max(200),
  entityId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  roleIds: z.array(z.number().int().positive()).optional(),
  mustChangePassword: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  email: z.string().email().max(190).optional(),
  entityId: z.number().int().positive().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  roleIds: z.array(z.number().int().positive()).optional(),
  mustChangePassword: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(10).max(200),
  mustChangePassword: z.boolean().optional(),
});

router.use(requireAuth);
router.get('/', requirePermission('user.manage'), ctrl.list);
router.get('/:id', requirePermission('user.manage'), ctrl.detail);
router.post('/', requirePermission('user.manage'), validate(createSchema), ctrl.create);
router.patch('/:id', requirePermission('user.manage'), validate(updateSchema), ctrl.update);
router.post(
  '/:id/reset-password',
  requirePermission('user.manage'),
  validate(resetPasswordSchema),
  ctrl.resetPassword
);
router.delete('/:id', requirePermission('user.manage'), ctrl.remove);

module.exports = router;
