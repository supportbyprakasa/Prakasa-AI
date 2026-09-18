const pool = require('../db/pool');

function sanitizeActionUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const value = url.trim();
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('://') || /[\s\\]/.test(value)) return null;
  return value.slice(0, 500);
}

async function validateRecipient(userId, entityId) {
  if (!userId || !entityId) return false;
  const [rows] = await pool.query(
    `SELECT id
       FROM users
      WHERE id=? AND entity_id=?
        AND status='active' AND deleted_at IS NULL
      LIMIT 1`,
    [userId, entityId]
  );
  return Boolean(rows[0]);
}

async function validateEntity(entityId) {
  if (!entityId) return false;
  const [rows] = await pool.query(
    `SELECT id FROM entities
      WHERE id=? AND deleted_at IS NULL
      LIMIT 1`,
    [entityId]
  );
  return Boolean(rows[0]);
}

async function create({
  userId,
  entityId,
  title,
  body,
  event,
  subjectType,
  subjectId,
  actionUrl,
  dedupeKey = null,
}) {
  if (!(await validateEntity(entityId))) return null;
  if (!(await validateRecipient(userId, entityId))) return null;

  const safeTitle = String(title || '').trim().slice(0, 190);
  const safeEvent = String(event || '').trim().slice(0, 80);
  if (!safeTitle || !safeEvent) return null;

  const safeBody = body == null ? null : String(body).slice(0, 500);
  const safeUrl = sanitizeActionUrl(actionUrl);
  const safeDedupeKey = dedupeKey == null
    ? null
    : String(dedupeKey).slice(0, 190);

  let result;
  if (safeDedupeKey) {
    [result] = await pool.query(
      `INSERT IGNORE INTO notifications
       (user_id, entity_id, title, body, event,
        subject_type, subject_id, action_url, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        entityId,
        safeTitle,
        safeBody,
        safeEvent,
        subjectType || null,
        subjectId || null,
        safeUrl,
        safeDedupeKey,
      ]
    );
    if (!result.affectedRows) return null;
  } else {
    [result] = await pool.query(
      `INSERT INTO notifications
       (user_id, entity_id, title, body, event,
        subject_type, subject_id, action_url, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        userId,
        entityId,
        safeTitle,
        safeBody,
        safeEvent,
        subjectType || null,
        subjectId || null,
        safeUrl,
      ]
    );
  }

  // Optional external delivery is deliberately best-effort and runs only
  // after the in-app notification row has been committed by this statement.
  try {
    const [rules] = await pool.query(
      `SELECT channel, template
         FROM notification_rules
        WHERE entity_id=? AND event=?
          AND is_active=1 AND channel='google_chat'
        LIMIT 1`,
      [entityId, safeEvent]
    );

    if (rules[0] && process.env.GOOGLE_CHAT_WEBHOOK_URL) {
      await fetch(process.env.GOOGLE_CHAT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*${safeTitle}*\n${safeBody || ''}`,
        }),
      });
    }
  } catch {
    // External notification delivery must never invalidate in-app delivery.
  }

  return result.insertId;
}

async function notifyUsers({ userIds, ...payload }) {
  if (!Array.isArray(userIds) || !userIds.length) return [];
  const unique = [
    ...new Set(
      userIds
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    ),
  ];

  const ids = [];
  for (const userId of unique) {
    const id = await create({ ...payload, userId });
    if (id != null) ids.push(id);
  }
  return ids;
}

module.exports = {
  create,
  notifyUsers,
  sanitizeActionUrl,
  validateRecipient,
  validateEntity,
};
