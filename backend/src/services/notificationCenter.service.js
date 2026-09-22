const pool = require('../db/pool');

/* ============================================================
   All functions take an explicit authenticated userId and enforce
   user_id = ? on every query. Cross-user access is impossible here.
   ============================================================ */

function normalizeId(id) {
  const value = Number(id);
  if (!Number.isInteger(value) || value <= 0) {
    const e = new Error('ID notifikasi tidak valid');
    e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
  }
  return value;
}

function toDateStart(v) {
  if (!v) return null;
  // Accept "YYYY-MM-DD" or ISO; produce 'YYYY-MM-DD 00:00:00' for MySQL.
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return `${s} 00:00:00`;
}

function toDateEndExclusive(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10) + ' 00:00:00';
}

async function listForUser({
  userId, page = 1, limit = 20, unread, event, subjectType, from, to,
}) {
  page = Math.max(1, Number(page) || 1);
  limit = Math.min(100, Math.max(1, Number(limit) || 20));
  const offset = (page - 1) * limit;

  const where = ['user_id = ?', 'deleted_at IS NULL'];
  const args = [userId];

  if (unread === '1' || unread === 1 || unread === true) where.push('is_read = 0');
  else if (unread === '0' || unread === 0 || unread === false) where.push('is_read = 1');

  if (event) { where.push('event = ?'); args.push(event); }
  if (subjectType) { where.push('subject_type = ?'); args.push(subjectType); }

  const fromStr = toDateStart(from);
  const toStr = toDateEndExclusive(to);
  if (fromStr) { where.push('created_at >= ?'); args.push(fromStr); }
  if (toStr) { where.push('created_at < ?'); args.push(toStr); }

  const whereSql = where.join(' AND ');

  const [rows] = await pool.query(
    `SELECT id, title, body, event, subject_type AS subjectType,
            subject_id AS subjectId, action_url AS actionUrl,
            is_read AS isRead, read_at AS readAt, created_at AS createdAt
       FROM notifications
      WHERE ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM notifications WHERE ${whereSql}`, args
  );

  const [[{ unreadCount }]] = await pool.query(
    `SELECT COUNT(*) AS unreadCount FROM notifications
      WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL`, [userId]
  );

  return {
    rows: rows.map((r) => ({ ...r, isRead: !!r.isRead })),
    meta: { page, limit, total: Number(total), unreadCount: Number(unreadCount) },
  };
}

async function getUnreadCount(userId) {
  const [[{ c }]] = await pool.query(
    `SELECT COUNT(*) AS c FROM notifications
      WHERE user_id = ? AND is_read = 0 AND deleted_at IS NULL`,
    [userId]
  );
  return Number(c);
}

async function markRead({ userId, id }) {
  id = normalizeId(id);
  const [r] = await pool.query(
    `UPDATE notifications
        SET is_read = 1, read_at = COALESCE(read_at, NOW())
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId]
  );
  if (!r.affectedRows) {
    // Could be already-read (which is fine) or not-found. Confirm existence.
    const [[ex]] = await pool.query(
      `SELECT id FROM notifications WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [id, userId]
    );
    if (!ex) {
      const e = new Error('Notifikasi tidak ditemukan');
      e.status = 404; e.code = 'NOT_FOUND'; throw e;
    }
    // already read → treat as success (idempotent)
  }
  return { id: Number(id), isRead: true };
}

async function markUnread({ userId, id }) {
  id = normalizeId(id);
  const [r] = await pool.query(
    `UPDATE notifications
        SET is_read = 0, read_at = NULL
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId]
  );
  if (!r.affectedRows) {
    const [[ex]] = await pool.query(
      `SELECT id FROM notifications WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [id, userId]
    );
    if (!ex) {
      const e = new Error('Notifikasi tidak ditemukan');
      e.status = 404; e.code = 'NOT_FOUND'; throw e;
    }
  }
  return { id, isRead: false };
}

async function markAllRead(userId) {
  const [r] = await pool.query(
    `UPDATE notifications
        SET is_read = 1, read_at = COALESCE(read_at, NOW())
      WHERE user_id = ? AND deleted_at IS NULL AND is_read = 0`,
    [userId]
  );
  return { updated: r.affectedRows };
}

async function dismiss({ userId, id }) {
  id = normalizeId(id);
  const [r] = await pool.query(
    `UPDATE notifications
        SET deleted_at = NOW()
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId]
  );
  if (!r.affectedRows) {
    const e = new Error('Notifikasi tidak ditemukan');
    e.status = 404; e.code = 'NOT_FOUND'; throw e;
  }
  return { id };
}

async function clearRead(userId) {
  const [r] = await pool.query(
    `UPDATE notifications
        SET deleted_at = NOW()
      WHERE user_id = ? AND deleted_at IS NULL AND is_read = 1`,
    [userId]
  );
  return { deleted: r.affectedRows };
}

module.exports = {
  listForUser,
  getUnreadCount,
  markRead,
  markUnread,
  markAllRead,
  dismiss,
  clearRead,
};