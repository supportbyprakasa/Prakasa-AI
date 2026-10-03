// Pengajuan ke Accurate: master data (customers, vendors) proposed from the
// app, decided by the division's Supervisor or Head, then queued for Accurate.
//
// Owner's decisions (3 Oct 2026):
//   - Accurate is the source of truth; the app writes TO it, never the reverse.
//   - Supervisor or Head decides (the Head holds the step from the start).
//   - Nothing is tested against Accurate yet, so the send channel
//     (services/accurate/accurateWriteTransport.js) is closed: an approved
//     request waits in the queue ("Dalam antrean") until the owner opens it.
//
// Guarantees that keep Accurate tidy:
//   - one open request per target (number or app row): no double proposal;
//   - one request_key per submission: a retried submit returns the same row;
//   - an update starts from the approved mirror snapshot (before_data), so the
//     decider sees exactly what changes;
//   - the number of a new record is checked against the mirror: no duplicate;
//   - a sent request is only "Terkonfirmasi" once the next approved pull shows
//     the record in Accurate — the mirror, not the send, is the proof.
//
// Status machine: pending → queued (approved) → sent → confirmed
//                 pending → rejected | cancelled;  queued → cancelled | failed

const crypto = require('node:crypto');
const pool = require('../db/pool');
const engine = require('./approvalEngine.service');
const notif = require('./notification.service');
const approvalAudit = require('./approvalAudit.service');
const { log } = require('./activityLog.service');
const batches = require('./salesAccurateBatches.service');
const transport = require('./accurate/accurateWriteTransport');
const { paging, positiveId } = require('./salesQuery');

const REQUEST_TYPE = 'accurate_write';
const SUBJECT_TYPE = 'accurate_write_request';
const OPEN = ['pending', 'queued', 'sent'];
const REQUEST_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_ATTEMPTS = 5;

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

// What may be proposed per record type: the fields, their limits, the mirror
// record type the result is confirmed against, and the division that decides.
const FIELD = (max, { required = false } = {}) => ({ max, required });
const COMMON_FIELDS = {
  number: FIELD(60), name: FIELD(120, { required: true }), category: FIELD(60), contactPerson: FIELD(120),
  phone: FIELD(40), businessPhone: FIELD(40), email: FIELD(120), address: FIELD(500), city: FIELD(100), notes: FIELD(500),
};
const RECORD_TYPES = Object.freeze({
  customer: {
    label: 'Pelanggan', mirrorType: 'customer', numberLabel: 'ID pelanggan',
    divisions: ['sales', 'retail_commerce'], defaultDivision: 'sales', localTable: 'sales_customers',
    fields: COMMON_FIELDS,
  },
  vendor: {
    label: 'Pemasok', mirrorType: 'pc_vendor', numberLabel: 'ID pemasok',
    divisions: ['procurement'], defaultDivision: 'procurement', localTable: null,
    fields: COMMON_FIELDS,
  },
});
const ACTIONS = ['create', 'update'];

const parse = (v) => (v == null ? null : (typeof v === 'string' ? JSON.parse(v) : v));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}
const payloadHash = (recordType, action, payload) => crypto.createHash('sha256')
  .update(JSON.stringify([recordType, action, canonical(payload)])).digest('hex');

// Only listed fields, trimmed, empty dropped; the name is required.
function cleanPayload(recordType, raw) {
  const spec = RECORD_TYPES[recordType];
  const out = {};
  const source = raw && typeof raw === 'object' ? raw : {};
  for (const key of Object.keys(source)) {
    if (!spec.fields[key]) throw httpError(400, 'VALIDATION_ERROR', `Kolom "${key}" tidak bisa dikirim ke Accurate`);
  }
  for (const [key, rule] of Object.entries(spec.fields)) {
    const value = source[key];
    if (value === undefined || value === null || value === '') {
      if (rule.required) throw httpError(400, 'VALIDATION_ERROR', `${key === 'name' ? 'Nama' : key} wajib diisi`);
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number') throw httpError(400, 'VALIDATION_ERROR', `Kolom "${key}" harus teks`);
    const text = String(value).trim();
    if (!text) { if (rule.required) throw httpError(400, 'VALIDATION_ERROR', 'Nama wajib diisi'); continue; }
    if (text.length > rule.max) throw httpError(400, 'VALIDATION_ERROR', `Kolom "${key}" maksimal ${rule.max} karakter`);
    out[key] = text;
  }
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw httpError(400, 'VALIDATION_ERROR', 'Email tidak valid');
  return out;
}

// The mirror's view of a record, as the fields the request uses.
function mirrorToPayload(row) {
  if (!row) return null;
  const data = parse(row.data) || {};
  const out = { number: row.number || null, name: row.name || null, category: data.category || null, status: row.status || null };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null));
}

// Which fields differ between the approved mirror snapshot and the proposal.
function diffFields(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = [];
  for (const key of keys) {
    if (key === 'status') continue;
    const was = before?.[key] ?? null;
    const now = after?.[key] ?? null;
    if (was === now) continue;
    // A proposal that leaves a mirror-only field alone is not a change of it.
    if (now === null && !(key in (after || {}))) continue;
    out.push({ field: key, before: was, after: now });
  }
  return out;
}

async function divisionFor(db, user, recordType) {
  const spec = RECORD_TYPES[recordType];
  const [rows] = await db.query(
    'SELECT id, code, name FROM departments WHERE entity_id = ? AND deleted_at IS NULL AND code IN (?)',
    [user.entityId, spec.divisions],
  );
  const own = rows.find((d) => Number(d.id) === Number(user.departmentId));
  const chosen = own || rows.find((d) => d.code === spec.defaultDivision) || rows[0];
  if (!chosen) throw httpError(409, 'DIVISION_MISSING', `Divisi ${spec.defaultDivision} belum ada, jadi pengajuan belum bisa dibuat.`);
  return chosen;
}

async function mirrorRecord(db, entityId, mirrorType, { accurateId = null, number = null }) {
  if (!accurateId && !number) return null;
  const [[row]] = await db.query(
    `SELECT accurate_id, number, name, status, data FROM accurate_latest
      WHERE entity_id = ? AND record_type = ? AND ${accurateId ? 'accurate_id = ?' : 'number = ?'} LIMIT 1`,
    [entityId, mirrorType, accurateId || number],
  );
  return row || null;
}

async function openRequestFor(db, entityId, recordType, { number = null, localId = null }) {
  const parts = [];
  const args = [entityId, recordType, OPEN];
  if (number) { parts.push('accurate_number = ?'); args.push(number); }
  if (localId) { parts.push('local_id = ?'); args.push(localId); }
  if (!parts.length) return null;
  const [[row]] = await db.query(
    `SELECT id, status FROM accurate_write_requests
      WHERE entity_id = ? AND record_type = ? AND status IN (?) AND (${parts.join(' OR ')}) LIMIT 1`,
    args,
  );
  return row || null;
}

// ------------------------------------------------------------------ create

async function createRequest(user, input) {
  const recordType = String(input.recordType || '');
  const action = String(input.action || '');
  const spec = RECORD_TYPES[recordType];
  if (!spec) throw httpError(400, 'VALIDATION_ERROR', 'Jenis data tidak dikenal');
  if (!ACTIONS.includes(action)) throw httpError(400, 'VALIDATION_ERROR', 'Aksi harus create atau update');
  const requestKey = String(input.requestKey || '');
  if (!REQUEST_KEY.test(requestKey)) throw httpError(400, 'VALIDATION_ERROR', 'requestKey harus 8–64 karakter huruf, angka, - atau _');
  const payload = cleanPayload(recordType, input.payload);
  const localId = positiveId(input.localId);
  const accurateId = input.accurateId ? String(input.accurateId).slice(0, 120) : null;
  if (action === 'update' && !accurateId) throw httpError(400, 'VALIDATION_ERROR', 'Perubahan harus menunjuk data Accurate yang sudah ada');

  const entityId = user.entityId;
  // A retried submit (same key) is the same request.
  const [[existing]] = await pool.query('SELECT id FROM accurate_write_requests WHERE entity_id = ? AND request_key = ? LIMIT 1', [entityId, requestKey]);
  if (existing) return { ...(await getRequest(user, existing.id)), repeated: true };

  const db = await pool.getConnection();
  let created;
  try {
    await db.beginTransaction();
    const department = await divisionFor(db, user, recordType);
    let before = null;
    let accurateNumber = payload.number || null;
    if (action === 'update') {
      const mirror = await mirrorRecord(db, entityId, spec.mirrorType, { accurateId });
      if (!mirror) throw httpError(404, 'NOT_FOUND', `${spec.label} itu belum ada di data Accurate yang disetujui, jadi belum bisa diubah dari sini.`);
      before = mirrorToPayload(mirror);
      accurateNumber = mirror.number || accurateNumber;
      if (!diffFields(before, payload).length) throw httpError(409, 'NO_CHANGE', 'Tidak ada yang berubah dibanding data Accurate saat ini.');
    } else if (accurateNumber) {
      const clash = await mirrorRecord(db, entityId, spec.mirrorType, { number: accurateNumber });
      if (clash) throw httpError(409, 'DUPLICATE', `${spec.numberLabel} ${accurateNumber} sudah ada di Accurate (${clash.name}). Ajukan perubahan, bukan data baru.`);
    }
    const open = await openRequestFor(db, entityId, recordType, { number: accurateNumber, localId });
    if (open) throw httpError(409, 'ALREADY_REQUESTED', `${spec.label} ini sudah punya pengajuan #${open.id} yang belum selesai.`);

    const title = `${action === 'create' ? `${spec.label} baru` : `Ubah ${spec.label.toLowerCase()}`}: ${payload.name}${accurateNumber ? ` (${accurateNumber})` : ''}`;
    const [r] = await db.query(
      `INSERT INTO accurate_write_requests
         (entity_id, department_id, record_type, action, local_id, accurate_id, accurate_number, title,
          payload, before_data, payload_hash, request_key, status, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [entityId, department.id, recordType, action, localId, accurateId, accurateNumber, title.slice(0, 255),
        JSON.stringify(payload), before ? JSON.stringify(before) : null, payloadHash(recordType, action, payload), requestKey, user.sub],
    );
    const id = r.insertId;
    const changed = action === 'update' ? diffFields(before, payload).map((d) => d.field).join(', ') : Object.keys(payload).join(', ');
    const approval = await engine.createApprovalRequest({
      entityId, departmentId: department.id, subjectType: SUBJECT_TYPE, subjectId: id, requestType: REQUEST_TYPE,
      title, description: `Kolom: ${changed}`, requestedBy: user.sub,
    }, db);
    if (approval.flowType === 'legacy') {
      throw httpError(409, 'APPROVAL_MATRIX_MISSING', `Matrix approval "Pengajuan ke Accurate" untuk ${department.name} belum ada (migrasi 145), jadi pengajuan belum bisa dibuat.`);
    }
    // Supervisor OR Head: the Head holds the step from the start.
    await db.query(
      `UPDATE approval_steps s JOIN approval_matrix am ON am.id = s.matrix_rule_id
          SET s.escalated_at = NOW(), s.escalated_to_role_id = am.escalation_role_id
        WHERE s.approval_request_id = ? AND am.escalation_role_id IS NOT NULL`,
      [approval.id],
    );
    await batches.ensureDecider(db, { approvalRequestId: approval.id, entityId, departmentId: department.id, divisionCode: department.code });
    await batches.ensureOwnerDecider(db, { approvalRequestId: approval.id, entityId });
    await db.query('UPDATE accurate_write_requests SET approval_request_id = ? WHERE id = ?', [approval.id, id]);
    await approvalAudit.log({
      entityId, actorUserId: user.sub, entityType: 'request', entityIdRef: approval.id, action: 'create',
      after: { subjectType: SUBJECT_TYPE, subjectId: id, flowType: approval.flowType },
    }, db);
    await db.commit();
    created = { id, approvalRequestId: approval.id, departmentId: department.id, title };
  } catch (e) {
    await db.rollback().catch(() => {});
    throw e;
  } finally { db.release(); }

  await log({ entityId, userId: user.sub, action: 'accurate.write_request.create', subjectType: SUBJECT_TYPE, subjectId: created.id, metadata: { recordType, action } });
  await notifyDeciders(entityId, created);
  return getRequest(user, created.id);
}

async function notifyDeciders(entityId, request) {
  try {
    for (const id of await batches.deciderIds(entityId, { approvalRequestId: request.approvalRequestId, departmentId: request.departmentId })) {
      await notif.create({
        userId: id, entityId, title: 'Pengajuan ke Accurate menunggu persetujuan Anda', body: request.title,
        event: 'approval.step_activated', subjectType: 'approval_request', subjectId: request.approvalRequestId,
        actionUrl: `/data-accurate/pengajuan/${request.id}`,
      }).catch(() => {});
    }
  } catch { /* a notification failure never undoes the submission */ }
}

// ------------------------------------------------------------------ read

const SELECT = `SELECT w.*, d.name AS department_name, d.code AS department_code,
         ru.name AS requested_by_name, du.name AS decided_by_name
    FROM accurate_write_requests w
    JOIN departments d ON d.id = w.department_id
    LEFT JOIN users ru ON ru.id = w.requested_by
    LEFT JOIN users du ON du.id = w.decided_by`;

function dto(row, { full = false } = {}) {
  const payload = parse(row.payload) || {};
  const before = parse(row.before_data);
  const out = {
    id: Number(row.id), recordType: row.record_type, recordLabel: RECORD_TYPES[row.record_type]?.label || row.record_type,
    action: row.action, status: row.status, title: row.title, name: payload.name || null, number: row.accurate_number || payload.number || null,
    localId: row.local_id ? Number(row.local_id) : null, accurateId: row.accurate_id || null,
    departmentId: Number(row.department_id), departmentName: row.department_name, departmentCode: row.department_code,
    approvalRequestId: row.approval_request_id ? Number(row.approval_request_id) : null,
    requestedBy: Number(row.requested_by), requestedByName: row.requested_by_name || null,
    decidedBy: row.decided_by ? Number(row.decided_by) : null, decidedByName: row.decided_by_name || null,
    decidedAt: row.decided_at || null, decisionNote: row.decision_note || null,
    attempts: Number(row.attempts || 0), lastAttemptAt: row.last_attempt_at || null, lastError: row.last_error || null,
    sentAt: row.sent_at || null, confirmedAt: row.confirmed_at || null, createdAt: row.created_at, updatedAt: row.updated_at,
  };
  if (full) {
    out.payload = payload;
    out.before = before;
    out.changes = row.action === 'update' ? diffFields(before, payload) : Object.entries(payload).map(([field, after]) => ({ field, before: null, after }));
    out.accurateResponse = parse(row.accurate_response);
    out.sendEnabled = transport.enabled();
  }
  return out;
}

async function listRequests(user, query = {}) {
  const { page, limit, offset } = paging(query);
  const where = ['w.entity_id = ?'];
  const args = [user.entityId];
  if (query.status === 'open') { where.push('w.status IN (?)'); args.push(OPEN); } else if (query.status) { where.push('w.status = ?'); args.push(String(query.status)); }
  if (query.recordType && RECORD_TYPES[query.recordType]) { where.push('w.record_type = ?'); args.push(query.recordType); }
  if (query.mine === '1') { where.push('w.requested_by = ?'); args.push(user.sub); }
  const localId = positiveId(query.localId);
  if (localId) { where.push('w.local_id = ?'); args.push(localId); }
  if (query.q) { where.push('(w.title LIKE ? OR w.accurate_number LIKE ?)'); args.push(`%${String(query.q).slice(0, 100)}%`, `%${String(query.q).slice(0, 100)}%`); }
  const whereSql = where.join(' AND ');
  const [rows] = await pool.query(`${SELECT} WHERE ${whereSql} ORDER BY w.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  const [[count]] = await pool.query(`SELECT COUNT(*) AS n FROM accurate_write_requests w WHERE ${whereSql}`, args);
  return { items: rows.map((r) => dto(r)), total: Number(count.n || 0), page, limit };
}

async function getRequest(user, id) {
  const [[row]] = await pool.query(`${SELECT} WHERE w.id = ? AND w.entity_id = ? LIMIT 1`, [id, user.entityId]);
  if (!row) throw httpError(404, 'NOT_FOUND', 'Pengajuan tidak ditemukan');
  return dto(row, { full: true });
}

// ------------------------------------------------------------------ cancel

const canOversee = (user) => (user?.permissions || []).includes('accurate.batch.view');

async function cancelRequest(user, id, note) {
  const reason = String(note || '').trim();
  if (!reason) throw httpError(400, 'VALIDATION_ERROR', 'Tulis alasan membatalkan pengajuan');
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[row]] = await db.query('SELECT * FROM accurate_write_requests WHERE id = ? AND entity_id = ? LIMIT 1 FOR UPDATE', [id, user.entityId]);
    if (!row) throw httpError(404, 'NOT_FOUND', 'Pengajuan tidak ditemukan');
    if (Number(row.requested_by) !== Number(user.sub) && !canOversee(user)) throw httpError(403, 'FORBIDDEN', 'Hanya pengaju atau Supervisor/Head yang bisa membatalkan');
    if (!['pending', 'queued'].includes(row.status)) throw httpError(409, 'CONFLICT', 'Pengajuan yang sudah terkirim atau selesai tidak bisa dibatalkan');
    if (row.status === 'pending' && row.approval_request_id) {
      await engine.withdrawRequest({ approvalRequestId: row.approval_request_id, actorUserId: user.sub, note: reason, conn: db });
    }
    await db.query(
      "UPDATE accurate_write_requests SET status = 'cancelled', decided_by = ?, decided_at = NOW(), decision_note = ? WHERE id = ?",
      [user.sub, reason.slice(0, 500), id],
    );
    await db.commit();
  } catch (e) {
    await db.rollback().catch(() => {});
    throw e;
  } finally { db.release(); }
  await log({ entityId: user.entityId, userId: user.sub, action: 'accurate.write_request.cancel', subjectType: SUBJECT_TYPE, subjectId: Number(id), metadata: { note: reason.slice(0, 200) } });
  return getRequest(user, id);
}

// ------------------------------------------------------------------ approval hooks

async function lockRequest(approval, conn) {
  const [[row]] = await conn.query(
    'SELECT * FROM accurate_write_requests WHERE id = ? AND entity_id = ? LIMIT 1 FOR UPDATE',
    [approval.subject_id, approval.entity_id],
  );
  if (!row) throw httpError(404, 'NOT_FOUND', 'Pengajuan ke Accurate tidak ditemukan');
  if (Number(row.approval_request_id) !== Number(approval.id)) throw httpError(409, 'STALE_APPROVAL', 'Approval ini bukan approval aktif pengajuan tersebut');
  return row;
}

async function assertCanDecide({ approval, user, action, note, conn }) {
  const row = await lockRequest(approval, conn);
  if (row.status !== 'pending') throw httpError(409, 'CONFLICT', 'Pengajuan ini sudah diputuskan');
  if (user && Number(row.requested_by) === Number(user.sub)) throw httpError(403, 'SELF_APPROVAL_FORBIDDEN', 'Pengaju tidak bisa memutuskan pengajuannya sendiri');
  if (action !== 'approve' && action !== 'reject') throw httpError(400, 'VALIDATION_ERROR', 'Pengajuan ke Accurate hanya bisa disetujui atau ditolak. Untuk perubahan, ajukan ulang.');
  if (action === 'reject' && !String(note || '').trim()) throw httpError(400, 'VALIDATION_ERROR', 'Tulis alasan penolakan');
}

async function canUserDecide({ approval, conn }) {
  const [[row]] = await conn.query('SELECT status FROM accurate_write_requests WHERE id = ? LIMIT 1', [approval.subject_id]);
  return row?.status === 'pending';
}

async function applyApprovalDecision({ approval, result, actorUserId, note = null, conn }) {
  if (result?.status !== 'approved' && result?.status !== 'rejected') return { changed: false };
  const row = await lockRequest(approval, conn);
  if (row.status !== 'pending') return { changed: false };
  const cleanNote = note ? String(note).slice(0, 500) : null;
  const status = result.status === 'rejected' ? 'rejected' : 'queued';
  await conn.query(
    'UPDATE accurate_write_requests SET status = ?, decided_by = ?, decided_at = NOW(), decision_note = ? WHERE id = ?',
    [status, actorUserId, cleanNote, row.id],
  );
  return { changed: true, status, requestId: Number(row.id), entityId: Number(row.entity_id), requestedBy: Number(row.requested_by), title: row.title };
}

async function afterDecision(outcome, actorUserId) {
  if (!outcome?.changed) return;
  await log({
    entityId: outcome.entityId, userId: actorUserId, action: `accurate.write_request.${outcome.status}`,
    subjectType: SUBJECT_TYPE, subjectId: outcome.requestId,
  }).catch(() => {});
  // The first send attempt right after approval: with the channel closed it
  // only records why the request waits, so the requester sees it on the page.
  if (outcome.status === 'queued') await dispatchOne(outcome.requestId).catch(() => {});
}

// ------------------------------------------------------------------ queue

async function dispatchOne(id) {
  const [[row]] = await pool.query('SELECT * FROM accurate_write_requests WHERE id = ? LIMIT 1', [id]);
  if (!row || row.status !== 'queued') return { skipped: true };
  const request = { ...dto(row, { full: true }) };
  let outcome;
  try {
    outcome = await transport.send(request);
  } catch (e) {
    const permanent = Boolean(e.permanent) || Number(row.attempts) + 1 >= MAX_ATTEMPTS;
    await pool.query(
      'UPDATE accurate_write_requests SET attempts = attempts + 1, last_attempt_at = NOW(), last_error = ?, status = ? WHERE id = ?',
      [String(e.message || e).slice(0, 500), permanent ? 'failed' : 'queued', id],
    );
    return { sent: false, failed: permanent, error: e.message };
  }
  if (outcome.sent) {
    await pool.query(
      `UPDATE accurate_write_requests SET status = 'sent', sent_at = NOW(), attempts = attempts + 1, last_attempt_at = NOW(), last_error = NULL,
              accurate_id = COALESCE(?, accurate_id), accurate_number = COALESCE(?, accurate_number), accurate_response = ? WHERE id = ?`,
      [outcome.accurateId || null, outcome.number || null, outcome.response ? JSON.stringify(outcome.response) : null, id],
    );
    return { sent: true };
  }
  // Blocked: the channel is closed. Not an attempt against Accurate, only a note.
  await pool.query('UPDATE accurate_write_requests SET last_attempt_at = NOW(), last_error = ? WHERE id = ?', [String(outcome.message || outcome.reason).slice(0, 500), id]);
  return { sent: false, blocked: true, reason: outcome.reason };
}

async function dispatchQueued(entityId = null) {
  const [rows] = await pool.query(
    `SELECT id FROM accurate_write_requests WHERE status = 'queued'${entityId ? ' AND entity_id = ?' : ''} ORDER BY id LIMIT 200`,
    entityId ? [entityId] : [],
  );
  const counts = { sent: 0, blocked: 0, failed: 0 };
  for (const { id } of rows) {
    const r = await dispatchOne(id);
    if (r.sent) counts.sent += 1; else if (r.failed) counts.failed += 1; else counts.blocked += 1;
  }
  return counts;
}

// A sent request is confirmed when the approved mirror shows the record.
async function confirmSent(entityId) {
  const [rows] = await pool.query("SELECT * FROM accurate_write_requests WHERE entity_id = ? AND status = 'sent'", [entityId]);
  let confirmed = 0;
  for (const row of rows) {
    const spec = RECORD_TYPES[row.record_type];
    const mirror = await mirrorRecord(pool, entityId, spec.mirrorType, { accurateId: row.accurate_id, number: row.accurate_id ? null : row.accurate_number });
    if (!mirror) continue;
    const payload = parse(row.payload) || {};
    const mismatch = diffFields(mirrorToPayload(mirror), payload).filter((d) => d.after !== null);
    await pool.query(
      `UPDATE accurate_write_requests SET status = 'confirmed', confirmed_at = NOW(), accurate_id = COALESCE(accurate_id, ?), accurate_number = COALESCE(?, accurate_number),
              last_error = ? WHERE id = ?`,
      [mirror.accurate_id, mirror.number, mismatch.length ? `Terkonfirmasi, tetapi berbeda di Accurate: ${mismatch.map((m) => m.field).join(', ')}` : null, row.id],
    );
    confirmed += 1;
  }
  return { checked: rows.length, confirmed };
}

// ------------------------------------------------------------------ reconciliation (customers)

// App customers against the approved Accurate mirror, by ID pelanggan:
// missing in Accurate, or named differently. Vendors live only in Accurate,
// so there is nothing to reconcile for them beyond the request list.
async function reconcileCustomers(user, query = {}) {
  const { page, limit, offset } = paging(query, { defaultLimit: 25 });
  const entityId = user.entityId;
  const where = ['c.entity_id = ?', 'c.deleted_at IS NULL', "(a.accurate_id IS NULL OR a.name <> c.name COLLATE utf8mb4_unicode_ci)"];
  const args = [entityId, entityId, entityId];
  if (query.kind === 'missing') where.push('a.accurate_id IS NULL');
  if (query.kind === 'name') where.push('a.accurate_id IS NOT NULL');
  if (query.q) { where.push('(c.name LIKE ? OR c.customer_code LIKE ?)'); args.push(`%${String(query.q).slice(0, 100)}%`, `%${String(query.q).slice(0, 100)}%`); }
  const from = `FROM sales_customers c
    LEFT JOIN accurate_latest a ON a.entity_id = ? AND a.record_type = 'customer' AND a.number = c.customer_code COLLATE utf8mb4_unicode_ci
    LEFT JOIN accurate_write_requests w ON w.entity_id = ? AND w.record_type = 'customer' AND w.local_id = c.id AND w.status IN ('pending','queued','sent')
    WHERE ${where.join(' AND ')}`;
  const [rows] = await pool.query(
    `SELECT c.id, c.customer_code, c.name, c.channel, c.contact_person, c.phone, c.business_phone, c.email, c.address, c.city, c.notes,
            a.accurate_id, a.name AS accurate_name, w.id AS request_id, w.status AS request_status
       ${from} ORDER BY (a.accurate_id IS NULL) DESC, c.name LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );
  const [[count]] = await pool.query(`SELECT COUNT(*) AS n ${from}`, args);
  const [[summary]] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(a.accurate_id IS NULL) AS missing, SUM(a.accurate_id IS NOT NULL AND a.name <> c.name COLLATE utf8mb4_unicode_ci) AS differs
       FROM sales_customers c
       LEFT JOIN accurate_latest a ON a.entity_id = ? AND a.record_type = 'customer' AND a.number = c.customer_code COLLATE utf8mb4_unicode_ci
      WHERE c.entity_id = ? AND c.deleted_at IS NULL`,
    [entityId, entityId],
  );
  const total = Number(summary?.total || 0);
  const missing = Number(summary?.missing || 0);
  const differs = Number(summary?.differs || 0);
  return {
    items: rows.map((r) => ({
      id: Number(r.id), customerCode: r.customer_code, name: r.name, channel: r.channel || null,
      kind: r.accurate_id ? 'name' : 'missing', accurateId: r.accurate_id || null, accurateName: r.accurate_name || null,
      request: r.request_id ? { id: Number(r.request_id), status: r.request_status } : null,
      payload: {
        number: r.customer_code, name: r.name, category: r.channel || null, contactPerson: r.contact_person, phone: r.phone,
        businessPhone: r.business_phone, email: r.email, address: r.address, city: r.city, notes: r.notes,
      },
    })),
    total: Number(count?.n || 0), page, limit,
    summary: { customers: total, matched: total - missing - differs, missing, differs },
  };
}

module.exports = {
  REQUEST_TYPE, SUBJECT_TYPE, RECORD_TYPES, OPEN, MAX_ATTEMPTS,
  cleanPayload, diffFields, mirrorToPayload, payloadHash,
  createRequest, listRequests, getRequest, cancelRequest,
  assertCanDecide, canUserDecide, applyApprovalDecision, afterDecision,
  dispatchOne, dispatchQueued, confirmSent, reconcileCustomers,
};
