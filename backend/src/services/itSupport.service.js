const pool = require('../db/pool');
const gmail = require('./gmail.service');
const { log: activityLog } = require('./activityLog.service');

// "Butuh bantuan IT" (owner, 1 Oct 2026): every request from any role becomes
// an IT ticket, and a copy goes to the IT support mailbox. The address is a
// per-entity setting IT can change (default support@prakasagroup.com).
const SETTING_KEY = 'it.support';
const DEFAULT_EMAIL = 'support@prakasagroup.com';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CATEGORY_LABELS = Object.freeze({
  device_damage: 'Kerusakan perangkat',
  new_device_request: 'Permintaan perangkat baru',
  access_software: 'Akses dan software',
  network: 'Jaringan dan konektivitas',
});
const PRIORITY_LABELS = Object.freeze({ low: 'Rendah', normal: 'Normal', high: 'Tinggi', urgent: 'Mendesak' });

function defaults() {
  const fromEnv = String(process.env.IT_SUPPORT_EMAIL || '').trim().toLowerCase();
  return { email: EMAIL_RE.test(fromEnv) ? fromEnv : DEFAULT_EMAIL, sendEmail: true };
}

async function getSettings(entityId, db = pool) {
  const [[row]] = await db.query('SELECT value FROM settings WHERE entity_id = ? AND `key` = ? LIMIT 1', [entityId, SETTING_KEY]);
  let stored = {};
  try { stored = typeof row?.value === 'string' ? JSON.parse(row.value) : (row?.value || {}); } catch { stored = {}; }
  const base = defaults();
  return {
    email: EMAIL_RE.test(String(stored.email || '')) ? String(stored.email).toLowerCase() : base.email,
    sendEmail: stored.sendEmail === undefined ? base.sendEmail : Boolean(stored.sendEmail),
    // Project Tracker project that receives every ticket as an issue (null = off),
    // and the IT manager whose name posts the Space announcement.
    trackerProjectId: Number.isInteger(Number(stored.trackerProjectId)) && Number(stored.trackerProjectId) > 0 ? Number(stored.trackerProjectId) : null,
    trackerPostAsUserId: Number(stored.trackerPostAsUserId) > 0 ? Number(stored.trackerPostAsUserId) : null,
    // Sending needs the Gmail sender (domain-wide delegation) to be configured.
    mailReady: Boolean(String(process.env.GOOGLE_GMAIL_SENDER || '').trim()),
  };
}

async function saveSettings(entityId, { email, sendEmail, trackerProjectId = null }, actorId, actor = null) {
  const clean = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(clean) || clean.length > 190) {
    throw Object.assign(new Error('Tulis alamat email yang valid, misalnya support@prakasagroup.com'), { status: 400, code: 'VALIDATION_ERROR', field: 'email' });
  }
  let projectId = null;
  if (trackerProjectId !== null && trackerProjectId !== undefined && trackerProjectId !== '') {
    projectId = Number(trackerProjectId);
    // The manager must be a member of the project's Space: it is their name on
    // the Space announcements (tracker.accessProject checks company + membership).
    await require('./tracker.service').accessProject(actor || { sub: actorId, entityId }, projectId);
  }
  const value = { email: clean, sendEmail: Boolean(sendEmail), trackerProjectId: projectId, trackerPostAsUserId: projectId ? actorId : null };
  const before = await getSettings(entityId);
  await pool.query(
    'INSERT INTO settings (entity_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [entityId, SETTING_KEY, JSON.stringify(value)],
  );
  await activityLog({
    entityId, userId: actorId, action: 'it_support.settings_update', subjectType: 'setting', subjectId: null,
    metadata: { before: { email: before.email, sendEmail: before.sendEmail, trackerProjectId: before.trackerProjectId }, after: value },
  });
  return getSettings(entityId);
}

function ticketLink(id) {
  const base = String(process.env.APP_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  return `${base}/it/tickets/${id}`;
}

function emailText({ id, requester, category, priority, title, description, sourcePage }) {
  return [
    `Tiket IT #${id} dari ${requester.name || 'pengguna'}${requester.departmentName ? ` (${requester.departmentName})` : ''}.`,
    '',
    `Kategori : ${CATEGORY_LABELS[category] || category}`,
    `Urgensi  : ${PRIORITY_LABELS[priority] || priority}`,
    `Judul    : ${title}`,
    sourcePage ? `Halaman  : ${sourcePage}` : null,
    '',
    description,
    '',
    `Buka tiket: ${ticketLink(id)}`,
    `Balas email ini untuk menghubungi ${requester.email || 'pelapor'} langsung.`,
  ].filter((line) => line !== null).join('\n');
}

// Best effort: a ticket is never lost because the mail could not be sent; the
// outcome is returned (and the Gmail call is in the integration log).
async function notifySupport({ entityId, ticketId, requesterId, category, priority, title, description, sourcePage }) {
  const settings = await getSettings(entityId);
  if (!settings.sendEmail) return { emailed: false, reason: 'disabled', to: settings.email };
  if (!settings.mailReady) return { emailed: false, reason: 'mail_not_configured', to: settings.email };
  const [[requester]] = await pool.query(
    `SELECT u.name, u.email, d.name AS departmentName
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = ? LIMIT 1`,
    [requesterId],
  );
  try {
    await gmail.sendMail({
      to: settings.email,
      subject: `[Tiket IT #${ticketId}] ${title}`,
      text: emailText({ id: ticketId, requester: requester || {}, category, priority, title, description, sourcePage }),
      replyTo: requester?.email || undefined,
    }, { entityId, userId: requesterId, subjectType: 'it_ticket', subjectId: ticketId });
    return { emailed: true, to: settings.email };
  } catch {
    return { emailed: false, reason: 'send_failed', to: settings.email };
  }
}

module.exports = { SETTING_KEY, DEFAULT_EMAIL, CATEGORY_LABELS, getSettings, saveSettings, notifySupport, emailText };
