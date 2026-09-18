const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { hasCrossEntityAccess } = require('../middleware/entityScope');

function scopeWhere(req, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (hasCrossEntityAccess(req)) {
    return {
      sql: `(${prefix}entity_id = ? OR ${prefix}entity_id IS NULL)`,
      args: [req.entityScope.entityId],
    };
  }
  return {
    sql: `${prefix}entity_id = ?`,
    args: [req.entityScope.entityId],
  };
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);
    const offset = (page - 1) * limit;

    const scope = scopeWhere(req);
    const where = [scope.sql];
    const args = [...scope.args];

    if (req.query.provider) { where.push('provider=?'); args.push(req.query.provider); }
    if (req.query.status) { where.push('status=?'); args.push(req.query.status); }
    if (req.query.operation) { where.push('operation=?'); args.push(req.query.operation); }
    if (req.query.subjectType) { where.push('subject_type=?'); args.push(req.query.subjectType); }
    if (req.query.subjectId) { where.push('subject_id=?'); args.push(req.query.subjectId); }
    if (req.query.from) { where.push('created_at>=?'); args.push(req.query.from); }
    if (req.query.to) { where.push('created_at<=?'); args.push(req.query.to); }

    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, user_id AS userId,
              provider, operation, subject_type AS subjectType,
              subject_id AS subjectId, status,
              error_message AS errorMessage,
              request_meta AS requestMeta,
              response_meta AS responseMeta,
              duration_ms AS durationMs, created_at AS createdAt
         FROM integration_logs
        WHERE ${where.join(' AND ')}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
         FROM integration_logs
        WHERE ${where.join(' AND ')}`,
      args
    );

    return ok(res, rows.map((row) => ({
      ...row,
      requestMeta: parseJson(row.requestMeta),
      responseMeta: parseJson(row.responseMeta),
    })), { page, limit, total });
  } catch (error) { next(error); }
}

async function detail(req, res, next) {
  try {
    const scope = scopeWhere(req);
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, user_id AS userId,
              provider, operation, subject_type AS subjectType,
              subject_id AS subjectId, status,
              error_message AS errorMessage,
              request_meta AS requestMeta,
              response_meta AS responseMeta,
              duration_ms AS durationMs, created_at AS createdAt
         FROM integration_logs
        WHERE id=? AND ${scope.sql}
        LIMIT 1`,
      [req.params.id, ...scope.args]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Integration log tidak ditemukan', 404);

    return ok(res, {
      ...rows[0],
      requestMeta: parseJson(rows[0].requestMeta),
      responseMeta: parseJson(rows[0].responseMeta),
    });
  } catch (error) { next(error); }
}

async function health(req, res, next) {
  try {
    const scope = scopeWhere(req);
    const [rows] = await pool.query(
      `SELECT provider,
              SUM(status='success') AS success,
              SUM(status='failed') AS failed,
              SUM(status='skipped') AS skipped,
              AVG(duration_ms) AS avgDurationMs,
              MAX(created_at) AS lastCall
         FROM integration_logs
        WHERE ${scope.sql}
          AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        GROUP BY provider
        ORDER BY provider ASC`,
      scope.args
    );
    return ok(res, rows);
  } catch (error) { next(error); }
}

module.exports = { list, detail, health };
