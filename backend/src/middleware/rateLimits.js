// Per-user rate limits for the expensive endpoints (production hardening,
// Oct 2026). Memory store: the API runs as ONE Passenger process on shared
// hosting; a multi-process deployment would need a shared store.
//
//   aiMessageLimiter  AI chat send/stream — RATE_LIMIT_AI_PER_MIN (default 30 per minute)
//   uploadLimiter     file uploads — RATE_LIMIT_UPLOAD_PER_10MIN (default 60 per 10 minutes)
//   batchReviewLimiter  "Periksa dengan AI" on an Accurate batch — RATE_LIMIT_BATCH_REVIEW_PER_HOUR (default 6 per hour)
//
// Keyed by the signed-in user (requireAuth runs first); by IP otherwise.
// 0 switches a limiter off.
const rateLimit = require('express-rate-limit');

function limitFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function userKey(req) {
  const userId = req.user?.sub ?? req.user?.id;
  return userId != null ? `user:${userId}` : `ip:${req.ip}`;
}

function perUserLimiter({ windowMs, limit, message }) {
  if (!limit) return (req, res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: userKey,
    message: { success: false, error: { code: 'RATE_LIMITED', message } },
  });
}

const aiMessageLimiter = perUserLimiter({
  windowMs: 60 * 1000,
  limit: limitFromEnv('RATE_LIMIT_AI_PER_MIN', 30),
  message: 'Terlalu banyak pesan ke Prakasa AI. Tunggu sebentar lalu coba lagi.',
});

const uploadLimiter = perUserLimiter({
  windowMs: 10 * 60 * 1000,
  limit: limitFromEnv('RATE_LIMIT_UPLOAD_PER_10MIN', 60),
  message: 'Terlalu banyak unggahan file. Tunggu beberapa menit lalu coba lagi.',
});

// "Periksa dengan AI" on a Data Accurate batch: each click may run the model
// once. RATE_LIMIT_BATCH_REVIEW_PER_HOUR (default 6 per user per hour).
const batchReviewLimiter = perUserLimiter({
  windowMs: 60 * 60 * 1000,
  limit: limitFromEnv('RATE_LIMIT_BATCH_REVIEW_PER_HOUR', 6),
  message: 'Terlalu sering memeriksa batch. Pemeriksaan dibatasi 6 kali per jam; coba lagi nanti.',
});

module.exports = { aiMessageLimiter, uploadLimiter, batchReviewLimiter, perUserLimiter, userKey, limitFromEnv };
