const pool = require('../db/pool');
const { ok } = require('../utils/response');
const { hasCrossEntityAccess } = require('../middleware/entityScope');

// Entity scope (same rule as integrationLogs.controller): the resolved entity
// only; entity.cross_access also sees system rows without an entity.
function scopeWhere(req, alias = 'al') {
  const prefix = alias ? `${alias}.` : '';
  if (hasCrossEntityAccess(req)) {
    return { sql: `(${prefix}entity_id = ? OR ${prefix}entity_id IS NULL)`, args: [req.entityScope.entityId] };
  }
  return { sql: `${prefix}entity_id = ?`, args: [req.entityScope.entityId] };
}

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const scope = scopeWhere(req, 'al');
    const where = [scope.sql];
    const args = [...scope.args];
    if (req.query.userId) { where.push('al.user_id = ?'); args.push(req.query.userId); }
    // From/to are WIB wall-clock values; created_at is read in UTC.
    if (req.query.from) { where.push('al.created_at >= ? - INTERVAL 7 HOUR'); args.push(req.query.from); }
    if (req.query.to) { where.push('al.created_at <= ? - INTERVAL 7 HOUR'); args.push(req.query.to); }

    const [rows] = await pool.query(
      `SELECT al.id, al.entity_id AS entityId, al.user_id AS userId,
              u.name AS userName, al.action, al.subject_type AS subjectType,
              al.subject_id AS subjectId, al.metadata, al.created_at AS createdAt
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY al.id DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM activity_logs al WHERE ${where.join(' AND ')}`, args
    );
    return ok(res, rows, { page, limit, total });
  } catch (e) { next(e); }
}

module.exports = { list, scopeWhere };
