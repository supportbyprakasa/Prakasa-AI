const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const ctrl = require('../controllers/signatureQr.controller');

const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

router.get('/:code', verifyLimiter, ctrl.publicVerify);

module.exports = router;
