const pool = require('../db/pool');
const { ok } = require('../utils/response');

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = ['1=1'];
    const args = [];
    if (req.query.entityId) { where.push('entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.provider) { where.push('provider = ?'); args.push(req.query.provider); }
    if (req.query.status) { where.push('status = ?'); args.push(req.query.status); }
    if (req.query.operation) { where.push('operation = ?'); args.push(req.query.operation); }
    if (req.query.subjectType) { where.push('subject_type = ?'); args.push(req.query.subjectType); }
    if (req.query.subjectId) { where.push('subject_id = ?'); args.push(req.query.subjectId); }
    if (req.query.from) { where.push('created_at >= ?'); args.push(req.query.from); }
    if (req.query.to) { where.push('created_at <= ?'); args.push(req.query.to); }

    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, user_id AS userId,
              provider, operation,
              subject_type AS subjectType, subject_id AS subjectId,
              status, error_message AS errorMessage,
              request_meta AS requestMeta, response_meta AS responseMeta,
              duration_ms AS durationMs, created_at AS createdAt
         FROM integration_logs
        WHERE ${where.join(' AND ')}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM integration_logs WHERE ${where.join(' AND ')}`,
      args    );

    return ok(res, rows, { page, limit, total });
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM integration_logs WHERE id = ?`, [id]
    );
    if (!rows[0]) return ok(res, null);
    return ok(res, rows[0]);
  } catch (e) { next(e); }
}

async function health(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT provider,
              SUM(status = 'success') AS success,
              SUM(status = 'failed') AS failed,
              SUM(status = 'skipped') AS skipped,
              AVG(duration_ms) AS avgDurationMs,
              MAX(created_at) AS lastCall
         FROM integration_logs
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        GROUP BY provider
        ORDER BY provider ASC`
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

module.exports = { list, detail, health };
