const pool = require('../db/pool');
const gmail = require('./gmail.service');
const { policyFor } = require('../config/notificationPolicy');
const pendingWork = require('../utils/pendingWork');

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

  // Notification policy (config/notificationPolicy.js): small edits people
  // already see on the board / in the Space do not notify at all.
  const policy = policyFor(safeEvent);
  if (!policy.inApp) return null;

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

  // Email: the policy decides; an administrator's notification_rules row for
  // this event (channel 'email') switches it on or off. Sent in the
  // background so a slow mail server never slows the action that notified.
  sendEmail({ entityId, userId, event: safeEvent, title: safeTitle, body: safeBody, actionUrl: safeUrl, defaultOn: policy.email });

  return result.insertId;
}

function absoluteLink(path) {
  const base = String(process.env.APP_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (!path || !base) return null;
  return /^https?:\/\//.test(path) ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

function emailText({ title, body, actionUrl }) {
  const link = absoluteLink(actionUrl);
  return [
    title,
    '',
    body || '',
    link ? `\nBuka di Prakasa Workspace: ${link}` : '',
    '',
    '—',
    'Email otomatis dari Prakasa Workspace. Notifikasi yang sama ada di ikon lonceng aplikasi.',
  ].filter((line, i, all) => !(line === '' && all[i - 1] === '')).join('\n');
}

async function emailEnabled(entityId, event, defaultOn) {
  const [[rule]] = await pool.query(
    `SELECT is_active FROM notification_rules WHERE entity_id = ? AND event = ? AND channel = 'email' LIMIT 1`,
    [entityId, event],
  );
  return rule ? Number(rule.is_active) === 1 : Boolean(defaultOn);
}

// Tracked (utils/pendingWork) so a cron job waits for it before closing the
// pool; a web request still returns without waiting.
// Reserved test domains (RFC 2606/6761) never get a real email: test and
// audit accounts use them, and a background job must not mail them.
const RESERVED_EMAIL = /@(?:[^@]+\.)?(?:invalid|test|example|localhost|example\.(?:com|net|org))$/i;
function deliverableEmail(email) {
  return !RESERVED_EMAIL.test(String(email || '').trim());
}

function sendEmail({ entityId, userId, event, title, body, actionUrl, defaultOn }) {
  return pendingWork.track((async () => {
    try {
      if (!process.env.GOOGLE_GMAIL_SENDER) return false;
      if (!(await emailEnabled(entityId, event, defaultOn))) return false;
      const [[recipient]] = await pool.query("SELECT email FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL LIMIT 1", [userId]);
      if (!recipient?.email || !deliverableEmail(recipient.email)) return false;
      await gmail.sendMail({ to: recipient.email, subject: `[Prakasa Workspace] ${title}`, text: emailText({ title, body, actionUrl }) }, { entityId, userId, subjectType: 'notification' });
      return true;
    } catch {
      // Email is best-effort: the in-app notification is already saved.
      return false;
    }
  })());
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
  sendEmail,
  deliverableEmail,
  emailText,
  emailEnabled,
  create,
  notifyUsers,
  sanitizeActionUrl,
  validateRecipient,
  validateEntity,
};
