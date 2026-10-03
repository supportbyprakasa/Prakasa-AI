const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const validate = require('../middleware/validate');
const requireAuth = require('../middleware/requireAuth');
const ctrl = require('../controllers/auth.controller');
const { limitFromEnv } = require('../middleware/rateLimits');

const RATE_LIMITED = (message) => ({ success: false, error: { code: 'RATE_LIMITED', message } });

// Per IP: 30 failed attempts a minute (successful sign-ins do not count, so an
// office behind one NAT address is not locked out). Behind a proxy req.ip is
// only right when TRUST_PROXY matches the number of proxy hops (app.js,
// .env.example). The per-email limiter below is the real brute-force brake.
const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: limitFromEnv('LOGIN_PER_IP_PER_MIN', 30) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: RATE_LIMITED('Terlalu banyak percobaan masuk. Tunggu sebentar lalu coba lagi.'),
});

// Per account (security review, Oct 2026): an attacker rotating IP addresses
// still gets only LOGIN_PER_EMAIL_PER_15MIN guesses (default 10) per email
// every 15 minutes. Keyed on the normalized email, so case or spaces do not
// open a fresh bucket. Successful sign-ins do not count.
function emailKey(req) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  return email ? `email:${email}` : `ip:${req.ip}`;
}

const emailLoginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: limitFromEnv('LOGIN_PER_EMAIL_PER_15MIN', 10) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: emailKey,
  message: RATE_LIMITED('Terlalu banyak percobaan masuk untuk akun ini. Coba lagi dalam 15 menit.'),
});

// Replacing a temporary password asks for the current one, so it is a
// guessing surface too: per signed-in user, 10 attempts per 15 minutes.
const changePasswordUserLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => (req.user?.sub != null ? `user:${req.user.sub}` : `ip:${req.ip}`),
  message: RATE_LIMITED('Terlalu banyak percobaan mengganti kata sandi. Coba lagi dalam 15 menit.'),
});

const manualSchema = z.object({
  email: z.string().email().max(190),
  password: z.string().min(1).max(200),
});

const googleSchema = z.object({
  idToken: z.string().min(10).optional(),
  code: z.string().min(10).optional(),
}).refine((data) => data.idToken || data.code, { message: 'idToken atau code wajib diisi' });

router.post('/login', loginLimiter, emailLoginLimiter, validate(manualSchema), ctrl.manualLogin);
router.post('/google', loginLimiter, validate(googleSchema), ctrl.googleLogin);
router.get('/me', requireAuth, ctrl.me);
// The signed-in user's own preferences (interface language, and whether the
// home page shows "Ringkasan pagi"). The account is always the session's; a
// body naming another user is refused (strict). At least one preference.
const preferencesSchema = z.object({
  language: z.enum(ctrl.LANGUAGES).optional(),
  morningBriefing: z.boolean().optional(),
}).strict().refine((body) => body.language !== undefined || body.morningBriefing !== undefined, { message: 'Tidak ada preferensi yang diubah' });
router.patch('/me/preferences', requireAuth, validate(preferencesSchema), ctrl.updatePreferences);
// Ends every session of this account on every device (users.tokens_valid_after).
router.post('/logout', requireAuth, ctrl.logout);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10, 'Kata sandi baru minimal 10 karakter').max(200)
    .regex(/[A-Za-z]/, 'Kata sandi baru harus memuat huruf')
    .regex(/[0-9]/, 'Kata sandi baru harus memuat angka'),
}).strict();
router.post('/change-password', loginLimiter, requireAuth, changePasswordUserLimiter, validate(changePasswordSchema), ctrl.changePassword);

module.exports = router;
module.exports.emailKey = emailKey;
module.exports.schemas = { changePassword: changePasswordSchema, preferences: preferencesSchema };
module.exports.limiters = { loginLimiter, emailLoginLimiter, changePasswordUserLimiter };
