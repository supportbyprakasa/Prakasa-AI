const pool = require('../db/pool');
const { sanitizeActionUrl } = require('./notification.service');

/* ============================================================
   All functions take an explicit authenticated userId and enforce
   user_id = ? on every query. Cross-user access is impossible here.
   ============================================================ */

function parseDateOnly(value, field) {
  if (!value) return null;
  const text = String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    const e = new Error(`${field} harus berformat YYYY-MM-DD`);
    e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    const e = new Error(`${field} tidak valid`);
    e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
  }
  return text;
}

function toDateStart(value) {
  const date = parseDateOnly(value, 'from');
  return date ? `${date} 00:00:00` : null;
}

function toDateEndExclusive(value) {
  const dateText = parseDateOnly(value, 'to');
  if (!dateText) return null;
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return `${date.toISOString().slice(0, 10)} 00:00:00`;
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

  const fromDate = parseDateOnly(from, 'from');
  const toDate = parseDateOnly(to, 'to');
  if (fromDate && toDate && fromDate > toDate) {
    const e = new Error('from tidak boleh setelah to');
    e.status = 400; e.code = 'VALIDATION_ERROR'; throw e;
  }

  const fromStr = fromDate ? toDateStart(fromDate) : null;
  const toStr = toDate ? toDateEndExclusive(toDate) : null;
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
    rows: rows.map((row) => ({
      ...row,
      actionUrl: sanitizeActionUrl(row.actionUrl),
      isRead: Boolean(row.isRead),
    })),
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
  const [result] = await pool.query(
    `UPDATE notifications
        SET is_read = 0, read_at = NULL
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [id, userId]
  );

  if (!result.affectedRows) {
    const [[existing]] = await pool.query(
      `SELECT id FROM notifications
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [id, userId]
    );
    if (!existing) {
      const e = new Error('Notifikasi tidak ditemukan');
      e.status = 404; e.code = 'NOT_FOUND'; throw e;
    }
  }
  return { id: Number(id), isRead: false };
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
  return { id: Number(id) };
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