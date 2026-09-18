const jwt = require('jsonwebtoken');
const { fail } = require('../utils/response');

module.exports = function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, 'UNAUTHORIZED', 'Token tidak ada', 401);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return fail(res, 'UNAUTHORIZED', 'Token tidak valid', 401);
  }
};
