const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const where = ['user_id = ?'];
    const args = [req.user.sub];
    if (req.query.unread === '1') where.push('is_read = 0');

    const [rows] = await pool.query(
      `SELECT id, title, body, event, subject_type AS subjectType,
              subject_id AS subjectId, action_url AS actionUrl,
              is_read AS isRead, read_at AS readAt, created_at AS createdAt
         FROM notifications WHERE ${where.join(' AND ')}
        ORDER BY id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM notifications WHERE ${where.join(' AND ')}`, args
    );
    return ok(res, rows, { page, limit, total });
  } catch (e) { next(e); }
}

async function markRead(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE notifications SET is_read=1, read_at=NOW()
        WHERE id=? AND user_id=?`, [id, req.user.sub]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Notifikasi tidak ditemukan', 404);
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function markAllRead(req, res, next) {
  try {
    await pool.query(
      `UPDATE notifications SET is_read=1, read_at=NOW()
        WHERE user_id=? AND is_read=0`, [req.user.sub]
    );
    return ok(res, { done: true });
  } catch (e) { next(e); }
}

module.exports = { list, markRead, markAllRead };
