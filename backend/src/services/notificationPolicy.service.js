const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { logWith } = require('./activityLog.service');
const { EVENTS } = require('../config/notificationPolicy');

// Notifikasi & email admin page: every event with its policy (in the app,
// email by default) and the administrator's email switch per company.

const GROUPS = [
  ['approval.', 'Approval (semua divisi)'],
  ['accurate.', 'Data Accurate'],
  ['signature.', 'Tanda tangan'],
  ['sales.', 'Sales & Retail Commerce'],
  ['finance.', 'Finance'],
  ['hrga.', 'Onboarding & offboarding'],
  ['it_ticket.', 'IT'],
  ['device.', 'IT'],
  ['license.', 'IT'],
  ['it.', 'IT'],
  ['ga_ops.', 'Operasional GA'],
  ['ga.', 'Layanan GA'],
  ['task.', 'Project Tracker & tugas'],
  ['tracker.', 'Project Tracker & tugas'],
  ['ai.', 'Prakasa AI'],
  ['marketing.', 'Marketing'],
];
const groupOf = (event) => (GROUPS.find(([prefix]) => event.startsWith(prefix)) || [null, 'Lainnya'])[1];

async function list(entityId) {
  const [rules] = await pool.query("SELECT event, is_active FROM notification_rules WHERE entity_id = ? AND channel = 'email'", [entityId]);
  const override = new Map(rules.map((r) => [r.event, Number(r.is_active) === 1]));
  return Object.entries(EVENTS).map(([event, p]) => ({
    event,
    group: groupOf(event),
    description: p.why,
    inApp: p.inApp,
    emailDefault: p.email,
    emailOverride: override.has(event) ? override.get(event) : null,
    email: p.inApp && (override.has(event) ? override.get(event) : p.email),
  }));
}

/** email: true/false = the admin's choice; null = back to the policy default. */
async function save(user, event, email) {
  const policy = EVENTS[event];
  if (!policy) throw Object.assign(new Error('Jenis notifikasi tidak dikenal'), { status: 404, code: 'NOT_FOUND' });
  if (!policy.inApp && email) throw Object.assign(new Error('Notifikasi ini tidak dikirim sama sekali, jadi email tidak bisa dinyalakan'), { status: 400, code: 'NOT_NOTIFIED' });
  const value = email === null ? (policy.email ? 1 : 0) : (email ? 1 : 0);
  const [[row]] = await pool.query("SELECT id, is_active FROM notification_rules WHERE entity_id = ? AND event = ? AND channel = 'email' LIMIT 1", [user.entityId, event]);
  if (row) await pool.query('UPDATE notification_rules SET is_active = ? WHERE id = ?', [value, row.id]);
  else await pool.query("INSERT INTO notification_rules (entity_id, event, channel, is_active) VALUES (?, ?, 'email', ?)", [user.entityId, event, value]);
  await logWith(pool, {
    entityId: user.entityId, userId: user.sub, action: 'notification_rule.email', subjectType: 'notification_rule', subjectId: row ? Number(row.id) : null,
    metadata: { event, before: row ? Number(row.is_active) === 1 : policy.email, after: Boolean(value), reset: email === null },
  });
  return (await list(user.entityId)).find((r) => r.event === event);
}

const listHandler = async (req, res, next) => {
  try { return ok(res, await list(req.user.entityId)); } catch (e) { return next(e); }
};
const saveHandler = async (req, res, next) => {
  try {
    const email = req.body?.email;
    if (!(email === true || email === false || email === null)) return fail(res, 'VALIDATION_ERROR', 'email harus true, false, atau null', 400);
    return ok(res, await save(req.user, String(req.params.event), email));
  } catch (e) {
    if (e.status && e.status < 500) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
};

module.exports = { list, save, listHandler, saveHandler, groupOf };
