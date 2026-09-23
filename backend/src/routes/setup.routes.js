const router = require('express').Router();
const { z } = require('zod');
const validate = require('../middleware/validate');
const {
  setupGuard,
  setupLockGuard,
  setupLimiter,
} = require('../middleware/setupGuard');
const ctrl = require('../controllers/setup.controller');

router.use(setupLimiter);
router.use(setupLockGuard);
router.use(setupGuard);

const bootstrapBody = z.object({
  email: z.string().email().max(190),
  name: z.string().min(1).max(150),
  password: z.string().min(12).max(200),
  entityId: z.number().int().positive().optional(),
});

router.get('/status', ctrl.status);
router.post('/migrate', ctrl.migrate);
router.post(
  '/bootstrap-admin',
  validate(bootstrapBody),
  ctrl.bootstrapAdmin
);

module.exports = router;
