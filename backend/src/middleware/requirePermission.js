const { fail } = require('../utils/response');

// A string requires that one permission; an array requires any one of them —
// the same "any of" rule the sidebar uses, so a page and its API agree.
module.exports = function requirePermission(code) {
  const codes = Array.isArray(code) ? code : [code];
  // Named, so a route's middleware order can be checked (test/cachedResponse.test.js).
  return function requirePermissionMiddleware(req, res, next) {
    const perms = req.user?.permissions || [];
    if (!codes.some((one) => perms.includes(one))) {
      return fail(res, 'FORBIDDEN', 'Tidak punya izin', 403);
    }
    next();
  };
};
