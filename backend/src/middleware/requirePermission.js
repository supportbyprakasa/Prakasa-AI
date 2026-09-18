const { fail } = require('../utils/response');

module.exports = function requirePermission(code) {
  return (req, res, next) => {
    const perms = req.user?.permissions || [];
    if (!perms.includes(code)) {
      return fail(res, 'FORBIDDEN', 'Tidak punya izin', 403);
    }
    next();
  };
};
