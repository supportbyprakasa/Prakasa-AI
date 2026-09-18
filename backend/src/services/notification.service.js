const pool = require('../db/pool');

async function create({ userId, entityId, title, body, event, subjectType, subjectId, actionUrl }) {
  const [r] = await pool.query(
    `INSERT INTO notifications
     (user_id, entity_id, title, body, event, subject_type, subject_id, action_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, entityId, title, body || null, event,
     subjectType || null, subjectId || null, actionUrl || null]
  );

  // Google Chat webhook (opsional) — cari rule aktif
  try {
    const [rules] = await pool.query(
      `SELECT channel, template FROM notification_rules
        WHERE entity_id=? AND event=? AND is_active=1 AND channel='google_chat'
        LIMIT 1`, [entityId, event]
    );
    if (rules[0] && process.env.GOOGLE_CHAT_WEBHOOK_URL) {
      await fetch(process.env.GOOGLE_CHAT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `*${title}*\n${body || ''}` }),
      });
    }
  } catch { /* jangan gagalkan transaksi utama karena webhook */ }

  return r.insertId;
}

async function notifyUsers({ userIds, ...payload }) {
  const ids = [];
  for (const uid of userIds) {
    ids.push(await create({ ...payload, userId: uid }));
  }
  return ids;
}

module.exports = { create, notifyUsers };
