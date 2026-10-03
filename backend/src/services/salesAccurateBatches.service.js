const crypto = require('node:crypto');
const pool = require('../db/pool');
const engine = require('./approvalEngine.service');
const notif = require('./notification.service');
const approvalAudit = require('./approvalAudit.service');
const { log } = require('./activityLog.service');
const { divisionForAccurateChannel } = require('./salesStatus');
const { int, money } = require('./salesQuery');
const { WAREHOUSE_RECORD_TYPES, WAREHOUSE_TYPE_NAMES } = require('./accurate/warehouseRecordTypes');
const { PROCUREMENT_RECORD_TYPES, PROCUREMENT_TYPE_NAMES, scanPersonal } = require('./accurate/procurementRecordTypes');
const { FINANCE_RECORD_TYPES, FINANCE_TYPE_NAMES } = require('./accurate/financeRecordTypes');
const { invalidateFigures } = require('../utils/memo');

// After an approved batch: wait this long, then refill the dashboards' series.
const WARM_AFTER_APPLY_MS = 5000;

// Accurate data never lands in the Sales tables. Owner's decisions (2026-09-29):
//   - every pull is staged as one batch per division — e-Commerce customers to
//     Retail Commerce, everything else to Sales — and approved by that
//     division's Supervisor or Head through the approval engine;
//   - "TEGAS": nothing is changed or removed — not in Accurate, not in the
//     app's existing data. Approving a batch only INSERTs version rows into the
//     Accurate mirror (accurate_records); rejecting changes nothing.
//
// This module is the ONLY writer of Accurate data, and it writes to nothing
// but accurate_records. The Accurate reader only ever feeds stageChanges.

const REQUEST_TYPE = 'sales_accurate_sync';
const SUBJECT_TYPE = 'sales_accurate_batch';
const ACTIONS = ['create', 'update', 'missing'];

// Mirror columns each Accurate record type fills; `data` holds the rest.
const COLUMNS = ['number', 'name', 'trans_date', 'due_date', 'customer_no', 'customer_name', 'channel', 'salesman', 'status',
  'dpp_amount', 'total_amount', 'outstanding_amount'];

// `data` keys each type may store (and, for lists, the keys of each entry).
// The mirror keeps every version for good, so anything not listed here —
// personal data, costs, fields nobody decided to keep — is refused at staging.
const SALES_TYPES = Object.freeze({
  customer: {
    label: 'Customer',
    required: ['number', 'name'],
    fields: ['number', 'name', 'channel', 'status', 'data'],
    dataKeys: { category: null, created: null },
  },
  sales_order: {
    label: 'Sales order',
    required: ['number', 'trans_date'],
    fields: ['number', 'trans_date', 'customer_no', 'customer_name', 'channel', 'salesman', 'status', 'dpp_amount', 'total_amount', 'data'],
    dataKeys: { percent_shipped: null, tax_amount: null, ship_date: null, closed: null },
  },
  sales_invoice: {
    label: 'Faktur',
    required: ['number', 'trans_date'],
    fields: ['number', 'trans_date', 'due_date', 'customer_no', 'customer_name', 'channel', 'salesman', 'status',
      'dpp_amount', 'total_amount', 'outstanding_amount', 'data'],
    dataKeys: {
      tax_amount: null, tax_dpp: null, so_numbers: null, lines: ['item_no', 'item_name', 'qty', 'unit', 'amount'], dp: null, _last_update: null,
    },
  },
  delivery_order: {
    label: 'Surat jalan',
    required: ['number', 'trans_date'],
    fields: ['number', 'trans_date', 'customer_no', 'customer_name', 'channel', 'status', 'data'],
    dataKeys: { so_numbers: null, _last_update: null },
  },
  sales_receipt: {
    label: 'Penerimaan',
    required: ['number', 'trans_date'],
    fields: ['number', 'trans_date', 'customer_no', 'customer_name', 'channel', 'total_amount', 'data'],
    dataKeys: { bank: null, invoices: ['number', 'amount'], _last_update: null },
  },
  sales_return: {
    label: 'Retur penjualan',
    required: ['number', 'trans_date'],
    fields: ['number', 'trans_date', 'customer_no', 'customer_name', 'channel', 'status', 'dpp_amount', 'total_amount', 'data'],
    dataKeys: { tax_amount: null },
  },
  item: {
    label: 'Barang',
    required: ['number', 'name'],
    fields: ['number', 'name', 'status', 'data'],
    dataKeys: { category: null, type: null, unit_price: null },
  },
});
const SALES_TYPE_NAMES = Object.freeze(Object.keys(SALES_TYPES));

// Sales and Warehouse types share the mirror, never a record_type.
const RECORD_TYPES = Object.freeze({ ...SALES_TYPES, ...WAREHOUSE_RECORD_TYPES, ...PROCUREMENT_RECORD_TYPES, ...FINANCE_RECORD_TYPES });

// The `data` keys (and list-entry keys) a change carries that its type does not allow.
function unlistedDataKeys(type, data) {
  if (data === undefined || data === null) return [];
  if (typeof data !== 'object' || Array.isArray(data)) return ['data'];
  const allowed = type.dataKeys || {};
  const bad = [];
  for (const [key, value] of Object.entries(data)) {
    if (!Object.hasOwn(allowed, key)) { bad.push(key); continue; }
    const entryKeys = allowed[key];
    const flat = (v) => v === null || typeof v !== 'object';
    if (!entryKeys) {
      // Listed as a single value: a scalar or a list of scalars, never a nested object.
      if (!(flat(value) || (Array.isArray(value) && value.every(flat)))) bad.push(`${key}{}`);
      continue;
    }
    if (!Array.isArray(value)) { bad.push(`${key}{}`); continue; }
    for (const entry of value) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { bad.push(`${key}[]`); break; }
      for (const k of Object.keys(entry)) if (!entryKeys.includes(k) && !bad.includes(`${key}[].${k}`)) bad.push(`${key}[].${k}`);
    }
  }
  return bad;
}

// Master data (a name and a number) vs documents (a number and a customer).
const MASTER_TYPES = new Set(['customer', 'item']);

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

async function inTx(fn) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const result = await fn(db);
    await db.commit();
    return result;
  } catch (e) {
    await db.rollback().catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}

// ------------------------------------------------------------------ staging

function validateChange(change, index) {
  const where = `Perubahan #${index + 1}`;
  const type = RECORD_TYPES[change?.recordType];
  if (!type) throw httpError(400, 'VALIDATION_ERROR', `${where}: jenis data "${change?.recordType}" tidak dikenal`);
  if (!ACTIONS.includes(change.action)) throw httpError(400, 'VALIDATION_ERROR', `${where}: aksi "${change.action}" tidak dikenal`);
  const key = String(change.externalKey ?? '').trim();
  if (!/^\d+$/.test(key)) throw httpError(400, 'VALIDATION_ERROR', `${where}: ID Accurate tidak valid`);
  if (change.action !== 'missing' && (!change.after || typeof change.after !== 'object')) {
    throw httpError(400, 'VALIDATION_ERROR', `${where}: data dari Accurate kosong`);
  }
  const unknown = Object.keys(change.after || {}).filter((k) => !type.fields.includes(k));
  if (unknown.length) throw httpError(400, 'VALIDATION_ERROR', `${where}: kolom tidak dikenal untuk ${type.label}: ${unknown.join(', ')}`);
  const unlisted = unlistedDataKeys(type, change.after?.data);
  if (unlisted.length) {
    throw httpError(400, 'VALIDATION_ERROR', `${where}: isi data tidak terdaftar untuk ${type.label}: ${unlisted.join(', ')}`);
  }
  if (change.action === 'create') {
    const missing = type.required.filter((f) => change.after[f] === undefined || change.after[f] === null || change.after[f] === '');
    if (missing.length) throw httpError(400, 'VALIDATION_ERROR', `${where}: ${type.label} baru butuh ${missing.join(', ')}`);
  }
  // Last-line guard: a value that still looks like personal data is refused
  // (the collectors clean these fields with the same patterns). Never echoed.
  for (const path of type.personalScan || []) {
    const value = path.split('.').reduce((v, k) => (v == null ? v : v[k]), change.after);
    if (scanPersonal(value)) throw httpError(400, 'PERSONAL_DATA_FOUND', `${where}: ${change.recordType}.${path} memuat pola data pribadi`);
  }
  if (change.action === 'missing' && (!change.before || typeof change.before !== 'object')) {
    throw httpError(400, 'VALIDATION_ERROR', `${where}: data terakhir wajib ada untuk menandai "tidak ada lagi"`);
  }
  // A record type owned by one division (stock → Warehouse, purchases →
  // Procurement, cash/GL → Finance) goes there; sales documents follow the
  // customer's channel (Shopee/TokoPedia → Retail Commerce, else Sales).
  return { ...change, externalKey: key, division: type.division || divisionForAccurateChannel((change.after || change.before)?.channel) };
}

function summarize(items) {
  const counts = {};
  let revenue = 0;
  for (const item of items) {
    counts[item.recordType] = counts[item.recordType] || { create: 0, update: 0, missing: 0 };
    counts[item.recordType][item.action] += 1;
    if (item.recordType === 'sales_invoice' && item.action !== 'missing') revenue += Number(item.after?.dpp_amount || 0);
  }
  return { counts, revenue: Math.round(revenue * 100) / 100 };
}

function describe(summary) {
  const parts = Object.entries(summary.counts).map(([type, c]) => {
    const bits = [c.create && `${c.create} baru`, c.update && `${c.update} berubah`, c.missing && `${c.missing} tidak ada lagi`].filter(Boolean);
    return `${RECORD_TYPES[type].label}: ${bits.join(', ')}`;
  });
  return parts.join(' · ');
}

// A division without any active Supervisor or Head (Retail Commerce today)
// would leave its batch undecidable. Owner's decision (2026-09-29): until it has
// one, the Head of Sales decides for it. The fallback is set per batch, so the
// division's own people decide again as soon as they exist.
const FALLBACK_DECIDER_ROLE = 'sales.head';
// Stand-in per division; a division not listed falls back to the Head of the
// Management Office (the owner's own division) rather than leave a batch stuck.
// Procurement: the Management Office Head (owner decision P3), stated here too.
const FALLBACK_DECIDER_BY_DIVISION = Object.freeze({ retail_commerce: FALLBACK_DECIDER_ROLE, procurement: 'management_office.head' });
const DEFAULT_FALLBACK_DECIDER = 'management_office.head';
// Divisions whose batches only their Head decides (owner decision P3).
const HEAD_ONLY_DIVISIONS = new Set(['procurement']);

async function ensureDecider(db, { approvalRequestId, entityId, departmentId, divisionCode = null }) {
  const [[deciders]] = await db.query(
    `SELECT COUNT(DISTINCT u.id) AS n
       FROM approval_steps s
       JOIN user_roles ur ON ur.role_id IN (s.approver_role_id, s.escalated_to_role_id)
       JOIN users u ON u.id = ur.user_id
      WHERE s.approval_request_id = ? AND s.status = 'pending' AND u.entity_id = ? AND u.department_id = ?
        AND u.status = 'active' AND u.deleted_at IS NULL`,
    [approvalRequestId, entityId, departmentId],
  );
  if (Number(deciders?.n || 0) > 0) return false;
  const fallbackRole = (divisionCode && FALLBACK_DECIDER_BY_DIVISION[divisionCode])
    || (divisionCode ? DEFAULT_FALLBACK_DECIDER : FALLBACK_DECIDER_ROLE);
  const [[fallback]] = await db.query(
    'SELECT id FROM roles WHERE entity_id = ? AND role_key = ? AND deleted_at IS NULL LIMIT 1',
    [entityId, fallbackRole],
  );
  if (!fallback) return false;
  await db.query(
    "UPDATE approval_steps SET escalated_at = COALESCE(escalated_at, NOW()), escalated_to_role_id = ? WHERE approval_request_id = ? AND status = 'pending'",
    [fallback.id, approvalRequestId],
  );
  return true;
}

// Owner's decision (2026-09-29): "fokus ke akun Wahyudi Local — yang terpenting
// datanya terintegrasi dulu". The owner's account (ACCURATE_OWNER_DECIDER_EMAIL)
// may decide any division's Accurate batch, next to that division's own
// Supervisor/Head, who still can. Unset → only the divisions decide.
async function ensureOwnerDecider(db, { approvalRequestId, entityId }) {
  const email = String(process.env.ACCURATE_OWNER_DECIDER_EMAIL || '').trim().toLowerCase();
  if (!email) return false;
  const [[owner]] = await db.query(
    "SELECT id FROM users WHERE LOWER(email) = ? AND entity_id = ? AND status = 'active' AND deleted_at IS NULL LIMIT 1",
    [email, entityId],
  );
  if (!owner) return false;
  await db.query(
    `UPDATE approval_steps SET escalated_at = COALESCE(escalated_at, NOW()), escalated_to_user_id = ?
      WHERE approval_request_id = ? AND status = 'pending' AND escalated_to_user_id IS NULL`,
    [owner.id, approvalRequestId],
  );
  return true;
}

// Who may decide a batch: the division's Supervisors and the Head (or the
// stand-in role), plus the owner set as decider by name. `escalationOnly`: the
// Head, stand-in and owner — who hear again when a batch waits too long.
async function deciderIds(entityId, { approvalRequestId, departmentId }, { escalationOnly = false } = {}) {
  const [users] = await pool.query(
    `SELECT DISTINCT u.id
       FROM approval_steps s
       JOIN user_roles ur ON ur.role_id IN (s.approver_role_id, s.escalated_to_role_id)
       JOIN users u ON u.id = ur.user_id
      WHERE s.approval_request_id = ? AND s.status = 'pending' AND u.entity_id = ?
        AND ${escalationOnly ? 'ur.role_id = s.escalated_to_role_id' : '(u.department_id = ? OR ur.role_id = s.escalated_to_role_id)'}
        AND u.status = 'active' AND u.deleted_at IS NULL
     UNION
     SELECT u.id
       FROM approval_steps s JOIN users u ON u.id = s.escalated_to_user_id
      WHERE s.approval_request_id = ? AND s.status = 'pending' AND u.entity_id = ?
        AND u.status = 'active' AND u.deleted_at IS NULL`,
    escalationOnly
      ? [approvalRequestId, entityId, approvalRequestId, entityId]
      : [approvalRequestId, entityId, departmentId, approvalRequestId, entityId],
  );
  return users.map((u) => Number(u.id));
}

const rupiah = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

// The sentence a decider reads before approving — in the notification and on the
// batch: what changed, and anything the pull itself flagged.
function noticeText(summary) {
  const parts = [describe(summary)];
  const c = summary.checks || {};
  if (c.stock_sum?.mismatched) parts.push(`${c.stock_sum.mismatched} barang: stok per gudang tidak cocok dengan total`);
  if (c.complete === false) parts.push('bacaan Accurate tidak lengkap (tidak ada yang dinolkan)');
  const unread = Object.values(c.unread_documents || {}).reduce((n, v) => n + Number(v || 0), 0);
  if (unread) parts.push(`${unread} dokumen belum terbaca, ikut tarikan berikutnya`);
  if (summary.revenue) parts.push(`DPP faktur Rp ${rupiah.format(summary.revenue)}`);
  return parts.join(' · ');
}

// Every decider hears about a new batch, in one sentence they can approve from —
// the requester too: the scheduled pull is submitted in the name of the account
// that connected Accurate, who may be the owner deciding it.
async function notifyDeciders(entityId, batch) {
  try {
    for (const id of await deciderIds(entityId, batch)) {
      await notif.create({
        userId: id,
        entityId,
        title: `${batch.title} menunggu persetujuan Anda`,
        body: batch.notice || batch.title,
        event: 'approval.step_activated',
        subjectType: 'approval_request',
        subjectId: batch.approvalRequestId,
        actionUrl: `/data-accurate/${batch.id}`,
      }).catch(() => {});
    }
  } catch { /* a notification failure never undoes the submission */ }
}

// Stages what an Accurate pull found. `changes`:
//   [{ recordType, action: create|update|delete, externalKey, label, amount, before, after }]
// Returns the batches submitted for approval and the divisions skipped
// because their previous batch is still waiting (nothing is queued behind a
// batch nobody has decided yet — the next pull brings the changes again).
// `checks`: optional counts per division code (e.g. how well stock per gudang
// adds up to the total), shown to the approver with the batch.
async function stageChanges({ entityId, requestedBy, syncRunId = null, changes, checks = {} }) {
  if (!requestedBy) throw httpError(400, 'VALIDATION_ERROR', 'Pengaju batch wajib diisi');
  const valid = (changes || []).map(validateChange);
  const groups = new Map();
  for (const change of valid) {
    if (!groups.has(change.division)) groups.set(change.division, []);
    groups.get(change.division).push(change);
  }
  if (!groups.size) return { batches: [], skipped: [] };

  const [departments] = await pool.query(
    "SELECT id, code, name FROM departments WHERE entity_id = ? AND code IN (?) AND deleted_at IS NULL",
    [entityId, [...groups.keys()]],
  );
  const byCode = new Map(departments.map((d) => [d.code, d]));

  const batches = [];
  const skipped = [];
  for (const [code, items] of groups) {
    const department = byCode.get(code);
    if (!department) throw httpError(409, 'DIVISION_MISSING', `Divisi ${code} tidak ditemukan`);
    const outcome = await inTx(async (db) => {
      const [[waiting]] = await db.query(
        "SELECT id FROM sales_accurate_batches WHERE entity_id = ? AND department_id = ? AND status = 'pending' LIMIT 1 FOR UPDATE",
        [entityId, department.id],
      );
      if (waiting) return { skipped: { departmentId: department.id, reason: 'PENDING_BATCH', pendingBatchId: waiting.id } };

      const summary = { ...summarize(items), ...(checks[code] ? { checks: checks[code] } : {}) };
      const [created] = await db.query(
        `INSERT INTO sales_accurate_batches (entity_id, department_id, sync_run_id, item_count, summary, requested_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [entityId, department.id, syncRunId, items.length, JSON.stringify(summary), requestedBy],
      );
      const batchId = created.insertId;
      await db.query(
        `INSERT INTO sales_accurate_batch_items
           (batch_id, record_type, action, external_key, label, amount, before_data, after_data)
         VALUES ?`,
        [items.map((c) => [batchId, c.recordType, c.action, c.externalKey, c.label ? String(c.label).slice(0, 255) : null,
          c.amount ?? null, c.before ? JSON.stringify(c.before) : null, c.after ? JSON.stringify(c.after) : null])],
      );
      const title = `Data Accurate — ${department.name} (${items.length} perubahan)`;
      const approval = await engine.createApprovalRequest({
        entityId,
        departmentId: department.id,
        subjectType: SUBJECT_TYPE,
        subjectId: batchId,
        requestType: REQUEST_TYPE,
        title,
        description: describe(summary),
        amount: summary.revenue || null,
        requestedBy,
      }, db);
      if (approval.flowType === 'legacy') {
        throw httpError(409, 'APPROVAL_MATRIX_MISSING',
          `Matrix approval data Accurate untuk ${department.name} belum ada, jadi data belum bisa diajukan.`);
      }
      // "Supervisor atau Head divisi": the Head holds the step from the start
      // (as if already escalated), so either of them can decide.
      await db.query(
        `UPDATE approval_steps s JOIN approval_matrix am ON am.id = s.matrix_rule_id
            SET s.escalated_at = NOW(), s.escalated_to_role_id = am.escalation_role_id
          WHERE s.approval_request_id = ? AND am.escalation_role_id IS NOT NULL`,
        [approval.id],
      );
      // Owner decision P3: a Procurement batch is decided by the Head (stand-in:
      // the Management Office Head), never by a Supervisor alone.
      if (HEAD_ONLY_DIVISIONS.has(department.code)) {
        await db.query(
          `UPDATE approval_steps s JOIN approval_matrix am ON am.id = s.matrix_rule_id
              SET s.approver_role_id = am.escalation_role_id
            WHERE s.approval_request_id = ? AND am.escalation_role_id IS NOT NULL`,
          [approval.id],
        );
      }
      await ensureDecider(db, { approvalRequestId: approval.id, entityId, departmentId: department.id, divisionCode: department.code });
      await ensureOwnerDecider(db, { approvalRequestId: approval.id, entityId });
      await db.query('UPDATE sales_accurate_batches SET approval_request_id = ? WHERE id = ?', [approval.id, batchId]);
      await approvalAudit.log({
        entityId, actorUserId: requestedBy, entityType: 'request', entityIdRef: approval.id, action: 'create',
        after: { subjectType: SUBJECT_TYPE, subjectId: batchId, flowType: approval.flowType },
      }, db);
      return { batch: { id: batchId, departmentId: department.id, itemCount: items.length, approvalRequestId: approval.id, title, notice: noticeText(summary) } };
    });

    if (outcome.skipped) { skipped.push(outcome.skipped); continue; }
    batches.push(outcome.batch);
    await log({
      entityId, userId: requestedBy, action: 'sales.accurate_batch.submit', subjectType: SUBJECT_TYPE,
      subjectId: outcome.batch.id, metadata: { departmentId: outcome.batch.departmentId, items: outcome.batch.itemCount },
    });
    await notifyDeciders(entityId, outcome.batch);
  }
  return { batches, skipped };
}

// ------------------------------------------------------------------ applying

const parse = (v) => (v == null ? null : (typeof v === 'string' ? JSON.parse(v) : v));

// Content only: keys in `data` starting with "_" (e.g. Accurate's lastUpdate)
// are bookkeeping and never make a new version on their own.
// Keys sorted at every level: MySQL hands JSON back with its own key order
// (e.g. {amount, number}), which must never read as a change.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}

function contentHash(recordType, row) {
  const data = row.data && typeof row.data === 'object'
    ? canonical(Object.fromEntries(Object.entries(row.data).filter(([k]) => !k.startsWith('_'))))
    : null;
  const text = JSON.stringify([recordType, ...COLUMNS.map((c) => row[c] ?? null), row.missing ? 1 : 0, data]);
  return crypto.createHash('sha256').update(text).digest('hex');
}

// Approving = one new version row per item. INSERT only: earlier versions stay
// as they were, and "tidak ada lagi di Accurate" is a new version, not a delete.
async function applyBatch(db, batch) {
  const [items] = await db.query('SELECT * FROM sales_accurate_batch_items WHERE batch_id = ? ORDER BY id', [batch.id]);
  const counts = { create: 0, update: 0, missing: 0 };
  for (const item of items) {
    if (!RECORD_TYPES[item.record_type]) throw httpError(409, 'VALIDATION_ERROR', `Jenis data "${item.record_type}" tidak dikenal`);
    const missing = item.action === 'missing' || item.action === 'delete';
    const row = { ...(parse(missing ? item.before_data : item.after_data) || {}), missing };
    const [[current]] = await db.query(
      'SELECT MAX(version) AS v FROM accurate_records WHERE entity_id = ? AND record_type = ? AND accurate_id = ? FOR UPDATE',
      [batch.entity_id, item.record_type, item.external_key],
    );
    await db.query(
      `INSERT INTO accurate_records
         (entity_id, record_type, accurate_id, version, ${COLUMNS.join(', ')}, missing, data, content_hash, batch_id)
       VALUES (?, ?, ?, ?, ${COLUMNS.map(() => '?').join(', ')}, ?, ?, ?, ?)`,
      [batch.entity_id, item.record_type, item.external_key, Number(current?.v || 0) + 1,
        ...COLUMNS.map((c) => row[c] ?? null), missing ? 1 : 0, row.data ? JSON.stringify(row.data) : null,
        contentHash(item.record_type, row), batch.id],
    );
    counts[missing ? 'missing' : item.action] += 1;
  }
  return { items: items.length, ...counts };
}

// ------------------------------------------------------------------ approval hooks

async function lockBatch(approval, conn) {
  const [[batch]] = await conn.query(
    'SELECT * FROM sales_accurate_batches WHERE id = ? AND entity_id = ? LIMIT 1 FOR UPDATE',
    [approval.subject_id, approval.entity_id],
  );
  if (!batch) throw httpError(404, 'NOT_FOUND', 'Batch data Accurate tidak ditemukan');
  if (Number(batch.approval_request_id) !== Number(approval.id)) {
    throw httpError(409, 'STALE_APPROVAL', 'Approval ini bukan approval aktif batch tersebut');
  }
  return batch;
}

async function assertCanDecide({ approval, action, note, conn }) {
  const batch = await lockBatch(approval, conn);
  if (batch.status !== 'pending') throw httpError(409, 'CONFLICT', 'Batch ini sudah diputuskan');
  if (action !== 'approve' && action !== 'reject') {
    throw httpError(400, 'VALIDATION_ERROR', 'Data Accurate hanya bisa disetujui atau ditolak. Tarikan berikutnya membawa perubahan terbaru.');
  }
  if (action === 'reject' && !String(note || '').trim()) {
    throw httpError(400, 'VALIDATION_ERROR', 'Tulis alasan penolakan');
  }
}

async function canUserDecide({ approval, conn }) {
  const [[batch]] = await conn.query('SELECT status FROM sales_accurate_batches WHERE id = ? LIMIT 1', [approval.subject_id]);
  return batch?.status === 'pending';
}

async function applyApprovalDecision({ approval, result, actorUserId, note = null, conn }) {
  if (result?.status !== 'approved' && result?.status !== 'rejected') return { changed: false };
  const batch = await lockBatch(approval, conn);
  if (batch.status !== 'pending') return { changed: false };
  const cleanNote = note ? String(note).slice(0, 500) : null;
  if (result.status === 'rejected') {
    await conn.query(
      "UPDATE sales_accurate_batches SET status = 'rejected', decided_by = ?, decided_at = NOW(), decision_note = ? WHERE id = ?",
      [actorUserId, cleanNote, batch.id],
    );
    return { changed: true, status: 'rejected', batchId: batch.id, entityId: batch.entity_id };
  }
  let applied;
  try {
    applied = await applyBatch(conn, batch);
  } catch (e) {
    if (e.status && e.code) throw e;
    // The whole decision rolls back: nothing half-applied, the batch stays pending.
    throw httpError(409, 'APPLY_FAILED', `Data Accurate belum bisa diterapkan, jadi batch tetap menunggu. Detail: ${String(e.sqlMessage || e.message).slice(0, 200)}`);
  }
  await conn.query(
    "UPDATE sales_accurate_batches SET status = 'applied', decided_by = ?, decided_at = NOW(), decision_note = ?, applied_at = NOW() WHERE id = ?",
    [actorUserId, cleanNote, batch.id],
  );
  return { changed: true, status: 'applied', batchId: batch.id, entityId: batch.entity_id, applied };
}

async function afterDecision(outcome, actorUserId) {
  if (!outcome?.changed) return;
  // Runs after the decision committed: the mirror now holds the batch, so
  // every cached figure built on it is dropped (utils/memo.js) and the
  // division dashboards are refilled in the background a moment later.
  if (outcome.status === 'applied') {
    invalidateFigures();
    // A "Pengajuan ke Accurate" already sent is confirmed by the mirror, so
    // every applied batch is a chance to confirm one (lazy: no load cycle).
    require('./accurateWriteRequests.service').confirmSent(outcome.entityId).catch(() => {});
    const timer = setTimeout(() => {
      require('./divisionDashboard.service').warmDivisionDashboards(Number(outcome.entityId)).catch(() => {});
    }, WARM_AFTER_APPLY_MS);
    timer.unref?.();
  }
  await log({
    entityId: outcome.entityId, userId: actorUserId, action: `sales.accurate_batch.${outcome.status}`,
    subjectType: SUBJECT_TYPE, subjectId: outcome.batchId, metadata: outcome.applied || null,
  });
}

// ------------------------------------------------------------------ reading

// People in a division that receives Accurate data see their own division's
// batches; anyone else allowed on the page (management, admins) sees all.
const ACCURATE_DIVISIONS = Object.freeze(['sales', 'retail_commerce', 'warehouse', 'procurement', 'finance']);

async function divisionFilter(user) {
  const [[row]] = await pool.query(
    "SELECT d.id, d.code FROM users u JOIN departments d ON d.id = u.department_id WHERE u.id = ? LIMIT 1",
    [user.sub],
  );
  return row && ACCURATE_DIVISIONS.includes(row.code) ? Number(row.id) : null;
}

const batchDto = (b) => ({
  id: b.id,
  departmentId: b.department_id,
  departmentName: b.department_name,
  status: b.status,
  itemCount: int(b.item_count),
  summary: parse(b.summary),
  approvalRequestId: b.approval_request_id,
  approvalStatus: b.approval_status || null,
  requestedByName: b.requested_by_name,
  decidedByName: b.decided_by_name || null,
  decidedAt: b.decided_at,
  decisionNote: b.decision_note,
  appliedAt: b.applied_at,
  createdAt: b.created_at,
});

const BATCH_SELECT = `
  SELECT b.*, d.name AS department_name, ru.name AS requested_by_name, du.name AS decided_by_name, ar.status AS approval_status
    FROM sales_accurate_batches b
    JOIN departments d ON d.id = b.department_id
    LEFT JOIN users ru ON ru.id = b.requested_by
    LEFT JOIN users du ON du.id = b.decided_by
    LEFT JOIN approval_requests ar ON ar.id = b.approval_request_id`;

// Own division's batches, plus any batch this user stands in to decide for.
const STAND_IN = `EXISTS (SELECT 1 FROM approval_steps s JOIN user_roles ur ON ur.role_id = s.escalated_to_role_id
                           WHERE s.approval_request_id = b.approval_request_id AND ur.user_id = ?)`;

// `division`: one division's batches only (e.g. the Warehouse module's tab). It
// narrows what the user may already see; it never widens it.
async function listBatches(user, { status, division, page, limit, offset }) {
  const dept = await divisionFilter(user);
  const where = ['b.entity_id = ?'];
  const args = [user.entityId];
  if (dept) { where.push(`(b.department_id = ? OR ${STAND_IN})`); args.push(dept, user.sub); }
  if (ACCURATE_DIVISIONS.includes(division)) {
    where.push('b.department_id IN (SELECT id FROM departments WHERE entity_id = ? AND code = ?)');
    args.push(user.entityId, division);
  }
  if (['pending', 'applied', 'rejected', 'withdrawn'].includes(status)) { where.push('b.status = ?'); args.push(status); }
  const [rows] = await pool.query(`${BATCH_SELECT} WHERE ${where.join(' AND ')} ORDER BY b.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  const [[count]] = await pool.query(`SELECT COUNT(*) AS n FROM sales_accurate_batches b WHERE ${where.join(' AND ')}`, args);
  return { items: rows.map(batchDto), page, limit, total: int(count.n) };
}

async function getBatch(user, id) {
  const dept = await divisionFilter(user);
  const [[row]] = await pool.query(
    `${BATCH_SELECT} WHERE b.id = ? AND b.entity_id = ?${dept ? ` AND (b.department_id = ? OR ${STAND_IN})` : ''} LIMIT 1`,
    dept ? [id, user.entityId, dept, user.sub] : [id, user.entityId],
  );
  if (!row) throw httpError(404, 'NOT_FOUND', 'Batch data Accurate tidak ditemukan');
  return batchDto(row);
}

async function listItems(user, id, { recordType, action, page, limit, offset, q }) {
  await getBatch(user, id);
  const where = ['batch_id = ?'];
  const args = [id];
  if (RECORD_TYPES[recordType]) { where.push('record_type = ?'); args.push(recordType); }
  if (ACTIONS.includes(action)) { where.push('action = ?'); args.push(action); }
  if (q) { where.push('(external_key LIKE ? OR label LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const [rows] = await pool.query(
    `SELECT * FROM sales_accurate_batch_items WHERE ${where.join(' AND ')} ORDER BY record_type, action, external_key LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );
  const [[count]] = await pool.query(`SELECT COUNT(*) AS n FROM sales_accurate_batch_items WHERE ${where.join(' AND ')}`, args);
  return {
    items: rows.map((r) => ({
      id: r.id, recordType: r.record_type, action: r.action, externalKey: r.external_key, label: r.label,
      amount: r.amount == null ? null : money(r.amount), before: parse(r.before_data), after: parse(r.after_data),
    })),
    page, limit, total: int(count.n),
  };
}

module.exports = {
  REQUEST_TYPE, SUBJECT_TYPE, RECORD_TYPES, SALES_TYPE_NAMES, WAREHOUSE_TYPE_NAMES, PROCUREMENT_TYPE_NAMES, FINANCE_TYPE_NAMES, COLUMNS, MASTER_TYPES, unlistedDataKeys,
  stageChanges, applyBatch, contentHash, ensureDecider, ensureOwnerDecider, HEAD_ONLY_DIVISIONS, FALLBACK_DECIDER_ROLE, FALLBACK_DECIDER_BY_DIVISION, DEFAULT_FALLBACK_DECIDER,
  assertCanDecide, canUserDecide, applyApprovalDecision, afterDecision,
  listBatches, getBatch, listItems, divisionFilter, deciderIds, noticeText, notifyDeciders,
};
