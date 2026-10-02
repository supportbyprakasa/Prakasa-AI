const { fail } = require('../utils/response');
const rolePolicy = require('../services/rolePolicy.service');

// Gate for powers only a Super Admin holds (security review, Oct 2026): the
// permission catalog, AI provider/routing settings and the Accurate connection.
// A permission alone is not enough here, because an Administrator Sistem edits
// role permissions and could otherwise hand such a power to an account.
// Runs after requireAuth. `message` is the Indonesian text shown on 403.
function requireSuperAdmin(message = 'Hanya Super Admin yang bisa melakukan tindakan ini') {
  return async (req, res, next) => {
    try {
      if (req.user?.sub && await rolePolicy.isSuperAdmin(req.user.sub)) return next();
      return fail(res, 'SUPER_ADMIN_ONLY', message, 403);
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = requireSuperAdmin;
