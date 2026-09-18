const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const validate = require('../middleware/validate');
const requireAuth = require('../middleware/requireAuth');
const ctrl = require('../controllers/auth.controller');

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const manualSchema = z.object({
  email: z.string().email().max(190),
  password: z.string().min(1).max(200),
});

const googleSchema = z.object({
  idToken: z.string().min(10),
});

router.post('/login', loginLimiter, validate(manualSchema), ctrl.manualLogin);
router.post('/google', loginLimiter, validate(googleSchema), ctrl.googleLogin);
router.get('/me', requireAuth, ctrl.me);

module.exports = router;
