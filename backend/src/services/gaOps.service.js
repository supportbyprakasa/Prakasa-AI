const { logWith } = require('./activityLog.service');
const {
  MAINTENANCE_CATEGORY_LABELS, MAINTENANCE_RESULT_LABELS, MAINTENANCE_STATUS_LABELS,
  CONTRACT_KIND_LABELS, CONTRACT_STATUS_LABELS, UTILITY_LABELS, UTILITY_UNITS,
  MAINTENANCE_SOON_DAYS, BILL_SOON_DAYS,
} = require('../config/gaOps');

// Operasional GA (migration 114): office operations run by GA inside People &
// Culture — scheduled upkeep with its history, service/lease contracts, and
// utility bills. Same rules as the IT registers (itRegisters.service.js):
//   - the entity is always the caller's; a row of another entity reads as
//     not found;
//   - department_id is the entity's People & Culture division;
//   - every write and its activity log run on the caller's connection, inside
//     its transaction; the log never carries an amount of money;
//   - every PATCH carries `version` (409 VERSION_CONFLICT when it moved on);
//   - nothing is deleted: items and contracts end in a status; upkeep logs
//     are append-only. Payment itself stays in Finance.

const TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
const wibToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (isoDay, days) => {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
};

class GaOpsError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
const notFound = (what) => new GaOpsError('NOT_FOUND', `${what} tidak ditemukan`, 404);
const versionConflict = () => new GaOpsError(
  'VERSION_CONFLICT', 'Data ini sudah diubah orang lain. Muat ulang, lalu ulangi perubahan Anda.', 409,
);

// ------------------------------------------------------------ value helpers
const clean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || null;
};
const cleanNotes = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s || null;
};
const int = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const isoDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const iso = (v) => (v ? new Date(v).toISOString() : null);
const money = (v) => (v === null || v === undefined ? null : Number(v));
const flag = (v) => Number(v) === 1;

// ------------------------------------------------------------ time rules (SQL)
// Shared with the management provider, so the page and the escalations agree.
const MAINTENANCE_OVERDUE = (a) => `(${a}.status = 'active' AND ${a}.next_due_on < ${TODAY})`;
const MAINTENANCE_DUE_SOON = (a) => `(${a}.status = 'active' AND ${a}.next_due_on BETWEEN ${TODAY} AND ${TODAY} + INTERVAL ${MAINTENANCE_SOON_DAYS} DAY)`;
const CONTRACT_DECISION_ON = (a) => `(${a}.end_on - INTERVAL ${a}.notice_days DAY)`;
const CONTRACT_ENDING = (a) => `(${a}.status = 'active' AND ${a}.end_on IS NOT NULL AND ${TODAY} >= ${CONTRACT_DECISION_ON(a)})`;
const BILL_OVERDUE = (a) => `(${a}.paid_on IS NULL AND ${a}.due_on IS NOT NULL AND ${a}.due_on < ${TODAY})`;
const BILL_DUE_SOON = (a) => `(${a}.paid_on IS NULL AND ${a}.due_on IS NOT NULL AND ${a}.due_on BETWEEN ${TODAY} AND ${TODAY} + INTERVAL ${BILL_SOON_DAYS} DAY)`;

// ------------------------------------------------------------ lookups
async function peopleCultureDepartmentId(db, entityId) {
  const [[row]] = await db.query(
    "SELECT id FROM departments WHERE entity_id = ? AND code = 'people_culture' AND deleted_at IS NULL LIMIT 1",
    [entityId],
  );
  if (!row) throw new GaOpsError('NO_PC_DIVISION', 'Divisi People & Culture perusahaan ini belum ada', 409);
  return Number(row.id);
}

async function assertLocation(db, entityId, locationId, { allowInactiveId = null } = {}) {
  if (locationId === null || locationId === undefined) return;
  const [[row]] = await db.query('SELECT id, is_active FROM org_locations WHERE id = ? AND entity_id = ? LIMIT 1', [locationId, entityId]);
  if (!row) throw new GaOpsError('LOCATION_INVALID', 'Lokasi tidak ditemukan di perusahaan ini', 400, { field: 'locationId' });
  if (Number(row.is_active) !== 1 && Number(allowInactiveId) !== Number(locationId)) {
    throw new GaOpsError('LOCATION_INACTIVE', 'Lokasi ini sudah nonaktif', 400, { field: 'locationId' });
  }
}

// ------------------------------------------------------------ registers
// field → { col, kind }; `secret` fields (money) never reach a log.
const REGISTERS = {
  maintenance: {
    table: 'ga_maintenance_items',
    alias: 'm',
    subject: 'ga_maintenance_item',
    label: 'Jadwal perawatan',
    statusCol: true,
    fields: {
      locationId: { col: 'location_id', kind: 'location' },
      category: { col: 'category', kind: 'enum' },
      name: { col: 'name', kind: 'text' },
      vendorName: { col: 'vendor_name', kind: 'text' },
      intervalDays: { col: 'interval_days', kind: 'int' },
      lastDoneOn: { col: 'last_done_on', kind: 'date' },
      nextDueOn: { col: 'next_due_on', kind: 'date' },
      status: { col: 'status', kind: 'enum' },
      notes: { col: 'notes', kind: 'notes' },
    },
    required: ['locationId', 'category', 'name', 'intervalDays'],
    defaults: { status: 'active' },
  },
  contracts: {
    table: 'ga_contracts',
    alias: 'c',
    subject: 'ga_contract',
    label: 'Kontrak',
    statusCol: true,
    fields: {
      locationId: { col: 'location_id', kind: 'location' },
      kind: { col: 'kind', kind: 'enum' },
      vendorName: { col: 'vendor_name', kind: 'text' },
      description: { col: 'description', kind: 'text' },
      startOn: { col: 'start_on', kind: 'date' },
      endOn: { col: 'end_on', kind: 'date' },
      noticeDays: { col: 'notice_days', kind: 'int' },
      monthlyCost: { col: 'monthly_cost', kind: 'money', secret: true },
      status: { col: 'status', kind: 'enum' },
      notes: { col: 'notes', kind: 'notes' },
    },
    required: ['kind', 'vendorName'],
    defaults: { status: 'active', noticeDays: 60 },
  },
  bills: {
    table: 'ga_utility_bills',
    alias: 'b',
    subject: 'ga_utility_bill',
    label: 'Tagihan utilitas',
    statusCol: false,
    fields: {
      locationId: { col: 'location_id', kind: 'location' },
      utility: { col: 'utility', kind: 'enum' },
      customerNumber: { col: 'customer_number', kind: 'text' },
      period: { col: 'period', kind: 'text' },
      amount: { col: 'amount', kind: 'money', secret: true },
      usageAmount: { col: 'usage_amount', kind: 'money' },
      dueOn: { col: 'due_on', kind: 'date' },
      paidOn: { col: 'paid_on', kind: 'date' },
      notes: { col: 'notes', kind: 'notes' },
    },
    required: ['locationId', 'utility', 'period', 'amount'],
    defaults: {},
  },
};

function storeValue(spec, value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  switch (spec.kind) {
    case 'text': return clean(value);
    case 'notes': return cleanNotes(value);
    case 'money': return Number(value);
    case 'int': case 'location': return Number(value);
    case 'date': return isoDate(value);
    default: return value;
  }
}

function comparable(spec, value) {
  if (value === null || value === undefined) return null;
  if (spec.kind === 'date') return isoDate(value);
  if (['int', 'location', 'money'].includes(spec.kind)) return Number(value);
  return value;
}

function safeForLog(def, obj) {
  return Object.fromEntries(Object.entries(obj).filter(([field]) => !def.fields[field]?.secret));
}

// Rules a row must keep after any write (merged = the whole row as body values).
async function checkRules(db, entityId, key, values, merged, current = null) {
  if (values.locationId !== undefined) {
    if (values.locationId === null && key !== 'contracts') {
      throw new GaOpsError('LOCATION_REQUIRED', 'Pilih lokasi', 400, { field: 'locationId' });
    }
    await assertLocation(db, entityId, values.locationId, { allowInactiveId: current?.locationId });
  }
  const today = wibToday();
  if (key === 'maintenance') {
    const days = Number(merged.intervalDays);
    if (!Number.isInteger(days) || days < 1 || days > 1830) {
      throw new GaOpsError('INTERVAL_INVALID', 'Interval perawatan 1–1830 hari', 400, { field: 'intervalDays' });
    }
    if (merged.lastDoneOn && merged.lastDoneOn > today) {
      throw new GaOpsError('DATE_IN_FUTURE', 'Tanggal perawatan terakhir tidak boleh di masa depan', 400, { field: 'lastDoneOn' });
    }
  }
  if (key === 'contracts' && merged.startOn && merged.endOn && merged.endOn < merged.startOn) {
    throw new GaOpsError('CONTRACT_INVALID', 'Akhir kontrak tidak boleh sebelum awal kontrak', 400, { field: 'endOn' });
  }
  if (key === 'bills') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(merged.period || ''))) {
      throw new GaOpsError('PERIOD_INVALID', 'Periode tagihan berbentuk TTTT-BB, misalnya 2026-09', 400, { field: 'period' });
    }
    if (merged.paidOn && merged.paidOn > today) {
      throw new GaOpsError('DATE_IN_FUTURE', 'Tanggal bayar tidak boleh di masa depan', 400, { field: 'paidOn' });
    }
  }
}

function duplicateError(key) {
  if (key === 'bills') {
    return new GaOpsError('BILL_EXISTS', 'Tagihan untuk lokasi, jenis, nomor pelanggan, dan periode ini sudah ada', 409, { field: 'period' });
  }
  return new GaOpsError('DUPLICATE', 'Data yang sama sudah ada', 409);
}

async function guardedWrite(key, fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GaOpsError) throw e;
    if (e.code === 'ER_DUP_ENTRY') throw duplicateError(key);
    if (e.code === 'ER_NO_REFERENCED_ROW_2' || e.code === 'ER_NO_REFERENCED_ROW') {
      throw new GaOpsError('REFERENCE_INVALID', 'Data terkait tidak ditemukan di perusahaan ini', 400);
    }
    if (e.code === 'ER_CHECK_CONSTRAINT_VIOLATED') throw new GaOpsError('CHECK_FAILED', 'Isian tidak memenuhi aturan', 400);
    throw e;
  }
}

// ------------------------------------------------------------ reads
const LOCATION_JOIN = (a) => `LEFT JOIN org_locations loc ON loc.entity_id = ${a}.entity_id AND loc.id = ${a}.location_id`;

const SELECTS = {
  maintenance: `SELECT m.*, loc.name AS location_name,
                       ${MAINTENANCE_OVERDUE('m')} AS overdue, ${MAINTENANCE_DUE_SOON('m')} AS due_soon,
                       (SELECT COUNT(*) FROM ga_maintenance_logs g WHERE g.entity_id = m.entity_id AND g.item_id = m.id) AS log_count
                  FROM ga_maintenance_items m ${LOCATION_JOIN('m')}
                 WHERE m.entity_id = ?`,
  contracts: `SELECT c.*, loc.name AS location_name,
                     DATE_FORMAT(${CONTRACT_DECISION_ON('c')}, '%Y-%m-%d') AS decision_on,
                     ${CONTRACT_ENDING('c')} AS ending,
                     (c.status = 'active' AND c.end_on IS NOT NULL AND c.end_on < ${TODAY}) AS lapsed
                FROM ga_contracts c ${LOCATION_JOIN('c')}
               WHERE c.entity_id = ?`,
  bills: `SELECT b.*, loc.name AS location_name,
                 ${BILL_OVERDUE('b')} AS overdue, ${BILL_DUE_SOON('b')} AS due_soon
            FROM ga_utility_bills b ${LOCATION_JOIN('b')}
           WHERE b.entity_id = ?`,
};
const ORDER = {
  maintenance: "ORDER BY FIELD(m.status, 'active', 'retired'), m.next_due_on ASC, m.id ASC",
  contracts: "ORDER BY FIELD(c.status, 'active', 'ended'), c.end_on IS NULL, c.end_on ASC, c.id ASC",
  bills: 'ORDER BY b.period DESC, loc.name ASC, b.utility ASC, b.id ASC',
};

const base = (r) => ({
  id: Number(r.id),
  departmentId: int(r.department_id),
  locationId: int(r.location_id),
  locationName: r.location_name || null,
  notes: r.notes || null,
  version: Number(r.version),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const SHAPES = {
  maintenance: (r) => ({
    ...base(r),
    category: r.category,
    categoryLabel: MAINTENANCE_CATEGORY_LABELS[r.category] || r.category,
    name: r.name,
    vendorName: r.vendor_name || null,
    intervalDays: Number(r.interval_days),
    lastDoneOn: isoDate(r.last_done_on),
    nextDueOn: isoDate(r.next_due_on),
    overdue: flag(r.overdue),
    dueSoon: flag(r.due_soon),
    logCount: Number(r.log_count || 0),
    status: r.status,
    statusLabel: MAINTENANCE_STATUS_LABELS[r.status] || r.status,
  }),
  contracts: (r) => ({
    ...base(r),
    kind: r.kind,
    kindLabel: CONTRACT_KIND_LABELS[r.kind] || r.kind,
    vendorName: r.vendor_name,
    description: r.description || null,
    startOn: isoDate(r.start_on),
    endOn: isoDate(r.end_on),
    noticeDays: Number(r.notice_days),
    decisionOn: r.decision_on || null,
    ending: flag(r.ending),
    lapsed: flag(r.lapsed),
    monthlyCost: money(r.monthly_cost),
    status: r.status,
    statusLabel: CONTRACT_STATUS_LABELS[r.status] || r.status,
  }),
  bills: (r) => ({
    ...base(r),
    utility: r.utility,
    utilityLabel: UTILITY_LABELS[r.utility] || r.utility,
    unit: UTILITY_UNITS[r.utility] || '',
    customerNumber: r.customer_number || null,
    period: r.period,
    amount: money(r.amount),
    usageAmount: money(r.usage_amount),
    dueOn: isoDate(r.due_on),
    paidOn: isoDate(r.paid_on),
    overdue: flag(r.overdue),
    dueSoon: flag(r.due_soon),
    status: r.paid_on ? 'paid' : (flag(r.overdue) ? 'overdue' : 'unpaid'),
  }),
};

/** Every row of one register of the entity (registers are small). */
async function listRows(db, entityId, key) {
  const [rows] = await db.query(`${SELECTS[key]} ${ORDER[key]} LIMIT 2000`, [entityId]);
  return rows.map(SHAPES[key]);
}

async function getRow(db, entityId, key, id) {
  const def = REGISTERS[key];
  const [[row]] = await db.query(`${SELECTS[key]} AND ${def.alias}.id = ? LIMIT 1`, [entityId, id]);
  return row ? SHAPES[key](row) : null;
}

/** Counts for the page header and tabs. */
async function summary(db, entityId) {
  const [[row]] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM ga_maintenance_items m WHERE m.entity_id = ? AND m.status = 'active') AS maintenance,
       (SELECT COUNT(*) FROM ga_maintenance_items m WHERE m.entity_id = ? AND ${MAINTENANCE_OVERDUE('m')}) AS maintenance_overdue,
       (SELECT COUNT(*) FROM ga_maintenance_items m WHERE m.entity_id = ? AND ${MAINTENANCE_DUE_SOON('m')}) AS maintenance_soon,
       (SELECT COUNT(*) FROM ga_contracts c WHERE c.entity_id = ? AND c.status = 'active') AS contracts,
       (SELECT COUNT(*) FROM ga_contracts c WHERE c.entity_id = ? AND ${CONTRACT_ENDING('c')}) AS contracts_ending,
       (SELECT COUNT(*) FROM ga_utility_bills b WHERE b.entity_id = ? AND b.paid_on IS NULL) AS bills_unpaid,
       (SELECT COUNT(*) FROM ga_utility_bills b WHERE b.entity_id = ? AND ${BILL_OVERDUE('b')}) AS bills_overdue`,
    Array(7).fill(entityId),
  );
  const n = (k) => Number(row?.[k] || 0);
  return {
    maintenance: n('maintenance'),
    maintenanceOverdue: n('maintenance_overdue'),
    maintenanceDueSoon: n('maintenance_soon'),
    contracts: n('contracts'),
    contractsEnding: n('contracts_ending'),
    billsUnpaid: n('bills_unpaid'),
    billsOverdue: n('bills_overdue'),
  };
}

/**
 * The page's reads for one signed-in user (Prakasa AI read tools): the same
 * rule as GET /ga/ops/* — ga.ops.view, always the user's own entity. `key`
 * null gives the header counts, else every row of that register.
 */
async function readFor(user, key = null, db = null) {
  if (!(user?.permissions || []).includes('ga.ops.view')) {
    throw new GaOpsError('FORBIDDEN', 'Anda tidak punya akses ke Operasional GA', 403);
  }
  // eslint-disable-next-line global-require
  const conn = db || require('../db/pool');
  if (key === null) return summary(conn, user.entityId);
  if (!REGISTERS[key]) throw notFound('Daftar');
  return listRows(conn, user.entityId, key);
}

// ------------------------------------------------------------ writes
async function lockRow(conn, entityId, key, id) {
  const def = REGISTERS[key];
  const [[row]] = await conn.query(`SELECT * FROM ${def.table} WHERE id = ? AND entity_id = ? FOR UPDATE`, [id, entityId]);
  if (!row) throw notFound(def.label);
  return row;
}

function bodyOf(def, row) {
  const out = {};
  for (const [field, spec] of Object.entries(def.fields)) out[field] = comparable(spec, row[spec.col]);
  return out;
}

/** POST — a new row. Returns the new id. */
async function createRow(conn, { entityId, userId, key, body }) {
  const def = REGISTERS[key];
  return guardedWrite(key, async () => {
    const values = { ...def.defaults };
    for (const field of Object.keys(def.fields)) if (body[field] !== undefined) values[field] = body[field];
    for (const field of def.required) {
      if (values[field] === undefined || values[field] === null || values[field] === '') {
        throw new GaOpsError('VALIDATION_ERROR', 'Lengkapi isian wajib', 400, { field });
      }
    }
    const stored = {};
    for (const [field, value] of Object.entries(values)) {
      const spec = def.fields[field];
      if (spec) stored[field] = storeValue(spec, value);
    }
    // A schedule without a next date starts from the last upkeep, or from today.
    if (key === 'maintenance' && !stored.nextDueOn) {
      stored.nextDueOn = addDays(stored.lastDoneOn || wibToday(), stored.intervalDays);
    }
    await checkRules(conn, entityId, key, stored, stored);
    const departmentId = await peopleCultureDepartmentId(conn, entityId);
    const cols = ['entity_id', 'department_id', 'created_by', 'updated_by'];
    const args = [entityId, departmentId, userId, userId];
    for (const [field, value] of Object.entries(stored)) {
      cols.push(def.fields[field].col);
      args.push(value);
    }
    const [ins] = await conn.query(
      `INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      args,
    );
    const id = Number(ins.insertId);
    await logWith(conn, {
      entityId, userId, action: `${def.subject}.create`, subjectType: def.subject, subjectId: id,
      metadata: { after: safeForLog(def, stored) },
    });
    return id;
  });
}

/** PATCH — changes some fields of a row at the version the caller saw. */
async function updateRow(conn, { entityId, userId, key, id, body }) {
  const def = REGISTERS[key];
  return guardedWrite(key, async () => {
    const row = await lockRow(conn, entityId, key, id);
    if (Number(row.version) !== Number(body.version)) throw versionConflict();
    const current = bodyOf(def, row);
    const before = {};
    const after = {};
    for (const field of Object.keys(def.fields)) {
      if (body[field] === undefined) continue;
      const value = comparable(def.fields[field], storeValue(def.fields[field], body[field]));
      if (value !== current[field]) { before[field] = current[field]; after[field] = value; }
    }
    if (key === 'maintenance' && after.nextDueOn === null) {
      throw new GaOpsError('VALIDATION_ERROR', 'Isi tanggal perawatan berikutnya', 400, { field: 'nextDueOn' });
    }
    if (!Object.keys(after).length) return { id: Number(id), changed: [], version: Number(row.version) };
    await checkRules(conn, entityId, key, after, { ...current, ...after }, current);
    const sets = Object.keys(after).map((field) => `${def.fields[field].col} = ?`);
    const args = Object.keys(after).map((field) => after[field]);
    if (def.statusCol && after.status !== undefined) sets.push('status_changed_at = CURRENT_TIMESTAMP');
    sets.push('updated_by = ?', 'version = version + 1');
    args.push(userId, id, entityId, row.version);
    const [upd] = await conn.query(
      `UPDATE ${def.table} SET ${sets.join(', ')} WHERE id = ? AND entity_id = ? AND version = ?`,
      args,
    );
    if (!upd.affectedRows) throw versionConflict();
    await logWith(conn, {
      entityId, userId, action: `${def.subject}.update`, subjectType: def.subject, subjectId: Number(id),
      metadata: { fields: Object.keys(after), before: safeForLog(def, before), after: safeForLog(def, after) },
    });
    return { id: Number(id), changed: Object.keys(after), version: Number(row.version) + 1 };
  });
}

// ------------------------------------------------------------ upkeep history
async function listMaintenanceLogs(db, entityId, itemId) {
  const [[item]] = await db.query('SELECT id FROM ga_maintenance_items WHERE id = ? AND entity_id = ? LIMIT 1', [itemId, entityId]);
  if (!item) throw notFound('Jadwal perawatan');
  const [rows] = await db.query(
    `SELECT g.id, g.done_on, g.due_on, g.result, g.cost, g.note, g.created_at, u.name AS done_by_name
       FROM ga_maintenance_logs g LEFT JOIN users u ON u.id = g.done_by
      WHERE g.entity_id = ? AND g.item_id = ?
      ORDER BY g.done_on DESC, g.id DESC LIMIT 200`,
    [entityId, itemId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    doneOn: isoDate(r.done_on),
    dueOn: isoDate(r.due_on),
    onTime: !r.due_on || isoDate(r.done_on) <= isoDate(r.due_on),
    result: r.result,
    resultLabel: MAINTENANCE_RESULT_LABELS[r.result] || r.result,
    cost: money(r.cost),
    note: r.note || null,
    doneByName: r.done_by_name || null,
    createdAt: iso(r.created_at),
  }));
}

/**
 * POST /ops/maintenance/:id/logs — record upkeep done and, in the same
 * transaction, move the schedule: last_done_on = that day and next_due_on =
 * that day + interval (only when this is not older than the last upkeep).
 */
async function addMaintenanceLog(conn, { entityId, userId, itemId, doneOn, result = 'ok', cost = null, note = null }) {
  return guardedWrite('maintenance', async () => {
    const item = await lockRow(conn, entityId, 'maintenance', itemId);
    if (item.status !== 'active') throw new GaOpsError('ITEM_RETIRED', 'Jadwal perawatan ini sudah tidak dipakai', 409);
    const day = isoDate(doneOn);
    if (day > wibToday()) throw new GaOpsError('DATE_IN_FUTURE', 'Tanggal perawatan tidak boleh di masa depan', 400, { field: 'doneOn' });
    const dueOn = isoDate(item.next_due_on);
    const [ins] = await conn.query(
      `INSERT INTO ga_maintenance_logs (entity_id, item_id, done_on, due_on, result, cost, note, done_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, itemId, day, dueOn, result, cost === null || cost === undefined || cost === '' ? null : Number(cost), cleanNotes(note), userId],
    );
    const last = isoDate(item.last_done_on);
    const isLatest = !last || day >= last;
    const next = isLatest ? addDays(day, item.interval_days) : dueOn;
    await conn.query(
      `UPDATE ga_maintenance_items SET last_done_on = ?, next_due_on = ?, updated_by = ?, version = version + 1
        WHERE id = ? AND entity_id = ?`,
      [isLatest ? day : last, next, userId, itemId, entityId],
    );
    await logWith(conn, {
      entityId, userId, action: 'ga_maintenance_item.done', subjectType: 'ga_maintenance_item', subjectId: Number(itemId),
      metadata: { logId: Number(ins.insertId), doneOn: day, dueOn, result, nextDueOn: next },
    });
    return { id: Number(ins.insertId), itemId: Number(itemId), nextDueOn: next };
  });
}

module.exports = {
  REGISTERS, GaOpsError, listRows, getRow, summary, readFor, createRow, updateRow, listMaintenanceLogs, addMaintenanceLog,
  MAINTENANCE_OVERDUE, MAINTENANCE_DUE_SOON, CONTRACT_DECISION_ON, CONTRACT_ENDING, BILL_OVERDUE, BILL_DUE_SOON,
  addDays,
};
