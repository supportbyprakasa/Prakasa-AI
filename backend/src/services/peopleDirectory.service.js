const pool = require('../db/pool');
const { logWith } = require('./activityLog.service');
const { checkWorkEmail, normalizeEmail } = require('./workEmail');
const { todayWib } = require('../utils/wibTime');
const {
  PERSON_KIND_LABELS, PERSON_STATUS_LABELS, RESIGN_SOURCE_LABELS,
} = require('../config/itAssets');

// People & Culture wave 1, row 1.1 — the directory of one entity.
//
// A directory entry is either an app account of the entity (users) with an
// optional people_directory row, or a people_directory row without an account.
// For an account the row never copies name, email or division (rule 6): they are
// always read from users. Every write runs in a transaction with its activity
// log written on the same connection (rule 4); every read and write is bound to
// the caller's entity, never one from the request.

class DirectoryError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

const WIB_TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
const int = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const trimOrNull = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || null;
};
/** Name matching key — the same LOWER(TRIM()) as the generated column name_key. */
const nameKey = (v) => (trimOrNull(v) || '').toLowerCase();

const isoDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

// Directory keys: 'p<id>' = a people_directory row, 'u<id>' = an app account
// without a row yet. The list hands both out; detail/update accept both.
function parseKey(key) {
  const m = String(key || '').match(/^([pu])(\d{1,10})$/);
  if (!m) return null;
  return m[1] === 'p' ? { personId: Number(m[2]) } : { userId: Number(m[2]) };
}
const keyOf = (row) => (row.person_id != null ? `p${row.person_id}` : `u${row.user_id}`);

// ------------------------------------------------------------------ SQL

// Every entry of the entity: its app accounts (active ones, plus any account
// People & Culture already has a row for) and the rows without an account. Two
// placeholders, both the entity.
const DIRECTORY_SQL = `
  SELECT p.id AS person_id, u.id AS user_id, u.name AS full_name, u.email AS work_email, u.department_id,
         COALESCE(p.kind, 'employee') AS kind, p.excluded_reason, p.position, p.manager_id, p.work_phone,
         p.location_id,
         CASE WHEN p.status = 'resigned' OR u.status <> 'active' OR u.deleted_at IS NOT NULL
              THEN 'resigned' ELSE 'active' END AS status,
         p.resigned_on, p.resigned_on_source, p.notes,
         CASE WHEN u.deleted_at IS NOT NULL THEN 'deleted' ELSE u.status END AS account_status,
         (p.id IS NOT NULL) AS reviewed, p.updated_at, p.starts_on
    FROM users u
    LEFT JOIN people_directory p ON p.entity_id = u.entity_id AND p.user_id = u.id
   WHERE u.entity_id = ? AND ((u.deleted_at IS NULL AND u.status = 'active') OR p.id IS NOT NULL)
  UNION ALL
  SELECT p.id, NULL, p.full_name, p.work_email, p.department_id,
         p.kind, p.excluded_reason, p.position, p.manager_id, p.work_phone,
         p.location_id, p.status, p.resigned_on, p.resigned_on_source, p.notes,
         NULL, 1, p.updated_at, p.starts_on
    FROM people_directory p
   WHERE p.entity_id = ? AND p.user_id IS NULL`;

// Date-aware status (wave 2, decision 13): a person whose last day is today or
// later still works here ("Hari terakhir …"); a person whose join date is still
// ahead is listed ("Bergabung …") but not counted as an employee yet.
const ACTIVE_NOW = `(dir.status = 'active' OR (dir.status = 'resigned' AND dir.resigned_on >= ${WIB_TODAY}))`;
const STARTED = `(dir.starts_on IS NULL OR dir.starts_on <= ${WIB_TODAY})`;

/** Whether a resigned row is still before or on its last day (WIB). */
function lastDayAhead(row) {
  const d = isoDate(row.resigned_on);
  return row.status === 'resigned' && Boolean(d) && d >= todayWib();
}

const ENTRY_SELECT = `
  SELECT dir.*, dep.name AS department_name, loc.name AS location_name,
         COALESCE(mu.name, m.full_name) AS manager_name, m.user_id AS manager_user_id
    FROM (${DIRECTORY_SQL}) dir
    LEFT JOIN departments dep ON dep.id = dir.department_id
    LEFT JOIN org_locations loc ON loc.id = dir.location_id
    LEFT JOIN people_directory m ON m.id = dir.manager_id
    LEFT JOIN users mu ON mu.id = m.user_id`;

// ------------------------------------------------------------------ shaping

/** Work contact for everyone; kind, exclusion, resign details and notes for People & Culture only (rule 11). */
function shapeEntry(row, canManage) {
  const entry = {
    key: keyOf(row),
    personId: int(row.person_id),
    userId: int(row.user_id),
    name: row.full_name,
    position: row.position || null,
    departmentId: int(row.department_id),
    departmentName: row.department_name || null,
    managerId: int(row.manager_id),
    managerKey: row.manager_id != null ? `p${row.manager_id}` : null,
    managerName: row.manager_name || null,
    workEmail: row.work_email || null,
    workPhone: row.work_phone || null,
    locationId: int(row.location_id),
    locationName: row.location_name || null,
    hasAccount: row.user_id != null,
    groupStaff: row.kind === 'group_staff',
    status: row.status,
    statusLabel: PERSON_STATUS_LABELS[row.status] || row.status,
    // Badges for everyone: "Bergabung 12 Okt" / "Hari terakhir 15 Okt" (wave 2).
    startsOn: (() => { const d = isoDate(row.starts_on); return d && d > todayWib() ? d : null; })(),
    lastDay: lastDayAhead(row) ? isoDate(row.resigned_on) : null,
  };
  if (!canManage) return entry;
  return {
    ...entry,
    kind: row.kind,
    kindLabel: PERSON_KIND_LABELS[row.kind] || row.kind,
    excludedReason: row.excluded_reason || null,
    resignedOn: isoDate(row.resigned_on),
    resignedOnSource: row.resigned_on_source || (row.status === 'resigned' && row.user_id != null ? 'account' : null),
    resignedOnSourceLabel: RESIGN_SOURCE_LABELS[row.resigned_on_source
      || (row.status === 'resigned' && row.user_id != null ? 'account' : '')] || null,
    notes: row.notes || null,
    reviewed: Number(row.reviewed) === 1,
    accountStatus: row.account_status || null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

// ------------------------------------------------------------------ list

function listFilters(query, canManage) {
  const where = [];
  const args = [];
  const q = trimOrNull(query.q);
  if (q) {
    where.push('(dir.full_name LIKE ? OR dir.work_email LIKE ? OR dir.position LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  // Everyone sees active people; the resign list is People & Culture's.
  const status = canManage ? String(query.status || 'active') : 'active';
  // "Aktif" keeps a person until their last day; "Resign" is everyone after it.
  if (status === 'active') { where.push(`(dir.status = ? OR (dir.status = 'resigned' AND dir.resigned_on >= ${WIB_TODAY}))`); args.push(status); }
  if (status === 'resigned') { where.push(`dir.status = ? AND NOT (dir.resigned_on >= ${WIB_TODAY} AND dir.resigned_on IS NOT NULL)`); args.push(status); }
  // Excluded entries are hidden from everyone but People & Culture (rule 7).
  const kind = canManage ? String(query.kind || '') : '';
  if (['employee', 'group_staff', 'excluded'].includes(kind)) { where.push('dir.kind = ?'); args.push(kind); } else if (!canManage || kind !== 'all') where.push("dir.kind <> 'excluded'");
  if (query.departmentId) { where.push('dir.department_id = ?'); args.push(Number(query.departmentId)); }
  if (query.locationId) { where.push('dir.location_id = ?'); args.push(Number(query.locationId)); }
  if (query.managerId) { where.push('dir.manager_id = ?'); args.push(Number(query.managerId)); }
  if (query.hasAccount === 'yes') where.push('dir.user_id IS NOT NULL');
  if (query.hasAccount === 'no') where.push('dir.user_id IS NULL');
  if (canManage && query.reviewed === 'no') where.push('dir.user_id IS NOT NULL AND dir.person_id IS NULL');
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

async function list(entityId, query = {}, { canManage = false } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(query.limit, 10) || 50));
  const f = listFilters(query, canManage);
  const [rows] = await pool.query(
    `${ENTRY_SELECT} ${f.sql} ORDER BY dir.full_name ASC, dir.person_id ASC, dir.user_id ASC LIMIT ? OFFSET ?`,
    [entityId, entityId, ...f.args, limit, (page - 1) * limit],
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM (${DIRECTORY_SQL}) dir ${f.sql}`,
    [entityId, entityId, ...f.args],
  );
  return { rows: rows.map((r) => shapeEntry(r, canManage)), meta: { page, limit, total: Number(total) } };
}

/**
 * Headcount as the dashboard shows it (rule 7): active kind='employee' (an
 * account without a row counts as an employee), plus how many active accounts
 * People & Culture has not reviewed yet. Excluded and group staff never count.
 */
async function summary(entityId, db = pool) {
  const [[row]] = await db.query(
    `SELECT SUM(${ACTIVE_NOW} AND dir.kind = 'employee' AND ${STARTED}) AS headcount,
            SUM(${ACTIVE_NOW} AND dir.kind = 'employee' AND NOT ${STARTED}) AS upcoming,
            SUM(dir.status = 'resigned' AND dir.kind <> 'excluded' AND dir.resigned_on >= ${WIB_TODAY}) AS leaving,
            SUM(dir.status = 'active' AND dir.user_id IS NOT NULL AND dir.person_id IS NULL) AS unreviewed,
            SUM(dir.status = 'active' AND dir.kind = 'group_staff') AS group_staff,
            SUM(dir.status = 'active' AND dir.kind = 'employee' AND dir.user_id IS NULL) AS without_account,
            SUM(NOT ${ACTIVE_NOW} AND dir.kind <> 'excluded') AS resigned,
            SUM(dir.kind = 'excluded') AS excluded
       FROM (${DIRECTORY_SQL}) dir`,
    [entityId, entityId],
  );
  const n = (v) => Number(v || 0);
  return {
    headcount: n(row?.headcount),
    unreviewedAccounts: n(row?.unreviewed),
    groupStaff: n(row?.group_staff),
    withoutAccount: n(row?.without_account),
    resigned: n(row?.resigned),
    excluded: n(row?.excluded),
    upcoming: n(row?.upcoming),
    leaving: n(row?.leaving),
  };
}

async function loadEntry(db, entityId, key, { canManage = true } = {}) {
  const parsed = parseKey(key);
  if (!parsed) return null;
  const cond = parsed.personId != null ? 'dir.person_id = ?' : 'dir.user_id = ? AND dir.person_id IS NULL';
  const [[row]] = await db.query(
    `${ENTRY_SELECT} WHERE ${cond} LIMIT 1`,
    [entityId, entityId, parsed.personId ?? parsed.userId],
  );
  if (!row) return null;
  if (!canManage && (row.kind === 'excluded' || (row.status !== 'active' && !lastDayAhead(row)))) return null;
  return row;
}

async function detail(entityId, key, { canManage = false } = {}) {
  const row = await loadEntry(pool, entityId, key, { canManage });
  if (!row) return null;
  const entry = shapeEntry(row, canManage);
  let reports = [];
  if (row.person_id != null) {
    const [rows] = await pool.query(
      `${ENTRY_SELECT} WHERE dir.manager_id = ? AND ${ACTIVE_NOW} AND dir.kind <> 'excluded'
        ORDER BY dir.full_name ASC LIMIT 200`,
      [entityId, entityId, row.person_id],
    );
    reports = rows.map((r) => {
      const s = shapeEntry(r, false);
      return { key: s.key, name: s.name, position: s.position, departmentName: s.departmentName, hasAccount: s.hasAccount };
    });
  }
  return { ...entry, directReports: reports };
}

// ------------------------------------------------------------------ org chart

/** Active, not excluded people (one department or all) as a forest by manager. */
async function orgChart(entityId, { departmentId = null } = {}) {
  const args = [entityId, entityId];
  let where = `WHERE ${ACTIVE_NOW} AND dir.kind <> 'excluded'`;
  if (departmentId) { where += ' AND dir.department_id = ?'; args.push(Number(departmentId)); }
  const [rows] = await pool.query(`${ENTRY_SELECT} ${where} ORDER BY dir.full_name ASC LIMIT 2000`, args);
  const nodes = rows.map((r) => {
    const s = shapeEntry(r, false);
    return {
      key: s.key, personId: s.personId, userId: s.userId, name: s.name, position: s.position,
      departmentId: s.departmentId, departmentName: s.departmentName, managerKey: s.managerKey,
      managerName: s.managerName, hasAccount: s.hasAccount, groupStaff: s.groupStaff, childKeys: [],
    };
  });
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const roots = [];
  for (const node of nodes) {
    const parent = node.managerKey ? byKey.get(node.managerKey) : null;
    if (parent) parent.childKeys.push(node.key);
    else {
      // The manager is outside this view (another division, resigned, excluded) — the node is a root.
      node.managerOutside = Boolean(node.managerKey);
      roots.push(node.key);
    }
  }
  return { nodes, roots };
}

// ------------------------------------------------------------------ account link

/**
 * The one matching function for an app account (rule 8). Returns the id of the
 * account's directory row: its existing row, else a row without an account that
 * carries the account's email (linked: the row's own name/email/division are
 * cleared because users holds them), else — only when `create` — a new row.
 * Runs on the caller's connection, inside its transaction.
 */
// The first row of a SELECT, or null (also when a caller's connection answers
// a statement without rows).
const firstRow = ([rows]) => (Array.isArray(rows) && rows.length ? rows[0] : null);

async function ensurePersonForUser(conn, entityId, userId, actorId, { create = true } = {}) {
  const user = firstRow(await conn.query(
    'SELECT id, email, name FROM users WHERE id = ? AND entity_id = ? LIMIT 1',
    [userId, entityId],
  ));
  if (!user || user.id == null) return null;
  const own = firstRow(await conn.query(
    'SELECT id FROM people_directory WHERE entity_id = ? AND user_id = ? LIMIT 1',
    [entityId, userId],
  ));
  if (own) return { id: Number(own.id), action: 'existing' };

  const email = normalizeEmail(user.email);
  if (email) {
    const match = firstRow(await conn.query(
      `SELECT id, full_name, work_email, department_id FROM people_directory
        WHERE entity_id = ? AND user_id IS NULL AND work_email = ? LIMIT 1 FOR UPDATE`,
      [entityId, email],
    ));
    if (match) {
      await conn.query(
        `UPDATE people_directory
            SET user_id = ?, full_name = NULL, work_email = NULL, department_id = NULL, updated_by = ?
          WHERE id = ? AND entity_id = ? AND user_id IS NULL`,
        [userId, actorId || null, match.id, entityId],
      );
      await logWith(conn, {
        entityId, userId: actorId || null, action: 'people_directory.link_account',
        subjectType: 'people_directory', subjectId: Number(match.id),
        metadata: { userId: Number(userId), by: 'email', before: { fullName: match.full_name, workEmail: match.work_email, departmentId: int(match.department_id) } },
      });
      return { id: Number(match.id), action: 'linked' };
    }
  }
  if (!create) return null;
  const [ins] = await conn.query(
    `INSERT INTO people_directory (entity_id, user_id, created_by, updated_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [entityId, userId, actorId || null, actorId || null],
  );
  const id = Number(ins.insertId);
  if (ins.affectedRows === 1) {
    await logWith(conn, {
      entityId, userId: actorId || null, action: 'people_directory.create',
      subjectType: 'people_directory', subjectId: id, metadata: { userId: Number(userId), by: 'account' },
    });
    return { id, action: 'created' };
  }
  return { id, action: 'existing' };
}

/** users.controller create / email change: attach the account to its row, never create one. */
const linkAccount = (conn, entityId, userId, actorId) => ensurePersonForUser(conn, entityId, userId, actorId, { create: false });

/**
 * An account deactivated or deleted counts as resigned (rule 10, source
 * 'account'); reactivating it undoes only a resign that came from the account.
 */
async function syncAccountStatus(conn, entityId, userId, actorId, active) {
  if (active) {
    const [r] = await conn.query(
      `UPDATE people_directory SET status = 'active', resigned_on = NULL, resigned_on_source = NULL, updated_by = ?
        WHERE entity_id = ? AND user_id = ? AND status = 'resigned' AND resigned_on_source = 'account'`,
      [actorId || null, entityId, userId],
    );
    return { changed: Boolean(r.affectedRows) };
  }
  const person = await ensurePersonForUser(conn, entityId, userId, actorId, { create: true });
  if (!person) return { changed: false };
  const [r] = await conn.query(
    `UPDATE people_directory SET status = 'resigned', resigned_on = ${WIB_TODAY}, resigned_on_source = 'account', updated_by = ?
      WHERE id = ? AND entity_id = ? AND status = 'active'`,
    [actorId || null, person.id, entityId],
  );
  if (r.affectedRows) {
    await logWith(conn, {
      entityId, userId: actorId || null, action: 'people_directory.resign',
      subjectType: 'people_directory', subjectId: person.id, metadata: { source: 'account', userId: Number(userId) },
    });
  }
  return { changed: Boolean(r.affectedRows), personId: person.id };
}

// ------------------------------------------------------------------ writes

/** Locks every directory row of the entity (and the gap after them) for a manager change. */
async function lockDirectory(conn, entityId) {
  const [rows] = await conn.query(
    'SELECT id, manager_id FROM people_directory WHERE entity_id = ? ORDER BY id FOR UPDATE',
    [entityId],
  );
  return new Map(rows.map((r) => [Number(r.id), r.manager_id != null ? Number(r.manager_id) : null]));
}

/** Would `personId` reporting to `managerId` close a loop? Walks up from the manager. */
function createsCycle(managers, personId, managerId) {
  const seen = new Set();
  let cursor = managerId;
  while (cursor != null) {
    if (cursor === personId) return true;
    if (seen.has(cursor)) return true; // an existing loop — never extend it
    seen.add(cursor);
    cursor = managers.get(cursor) ?? null;
  }
  return false;
}

async function resolveManager(conn, entityId, managerKey, actorId) {
  const parsed = parseKey(managerKey);
  if (!parsed) throw new DirectoryError('MANAGER_INVALID', 'Atasan tidak ditemukan di direktori', 400);
  let personId = parsed.personId;
  if (personId == null) {
    const [[u]] = await conn.query(
      "SELECT id FROM users WHERE id = ? AND entity_id = ? AND deleted_at IS NULL AND status = 'active' LIMIT 1",
      [parsed.userId, entityId],
    );
    if (!u) throw new DirectoryError('MANAGER_INVALID', 'Atasan tidak ditemukan di direktori', 400);
    personId = (await ensurePersonForUser(conn, entityId, parsed.userId, actorId, { create: true })).id;
  }
  const [[m]] = await conn.query(
    `SELECT p.id, p.kind, p.status, u.status AS account_status, u.deleted_at AS account_deleted
       FROM people_directory p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ? AND p.entity_id = ? LIMIT 1`,
    [personId, entityId],
  );
  if (!m) throw new DirectoryError('MANAGER_INVALID', 'Atasan tidak ditemukan di direktori', 400);
  if (m.kind === 'excluded') throw new DirectoryError('MANAGER_EXCLUDED', 'Orang yang dikecualikan tidak bisa menjadi atasan', 400);
  if (m.status !== 'active' || (m.account_status && m.account_status !== 'active') || m.account_deleted) {
    throw new DirectoryError('MANAGER_RESIGNED', 'Atasan sudah resign atau akunnya nonaktif', 400);
  }
  return Number(m.id);
}

async function checkDepartment(conn, entityId, departmentId) {
  if (departmentId == null) return null;
  const [[d]] = await conn.query(
    'SELECT id FROM departments WHERE id = ? AND entity_id = ? AND deleted_at IS NULL LIMIT 1',
    [departmentId, entityId],
  );
  if (!d) throw new DirectoryError('DEPARTMENT_INVALID', 'Divisi tidak ditemukan di perusahaan ini', 400);
  return Number(departmentId);
}

async function checkLocation(conn, entityId, locationId) {
  if (locationId == null) return null;
  const [[l]] = await conn.query(
    'SELECT id, is_active FROM org_locations WHERE id = ? AND entity_id = ? LIMIT 1',
    [locationId, entityId],
  );
  if (!l) throw new DirectoryError('LOCATION_INVALID', 'Lokasi tidak ditemukan di perusahaan ini', 400);
  if (!Number(l.is_active)) throw new DirectoryError('LOCATION_INACTIVE', 'Lokasi sudah tidak aktif', 400);
  return Number(locationId);
}

/** A work email for a person without an account: company domain, not an account's, not taken. */
async function checkNoAccountEmail(conn, entityId, value, exceptPersonId = null) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const checked = checkWorkEmail(value);
  if (!checked.ok) throw new DirectoryError(checked.code, checked.message, checked.code === 'WORK_EMAIL_DOMAINS_UNSET' ? 503 : 400);
  const [[account]] = await conn.query(
    'SELECT id, name FROM users WHERE entity_id = ? AND email = ? AND deleted_at IS NULL LIMIT 1',
    [entityId, checked.email],
  );
  if (account) {
    throw new DirectoryError('WORK_EMAIL_IS_ACCOUNT', `Email ini milik akun aplikasi "${account.name}". Buka akun tersebut di direktori.`, 409, { key: `u${account.id}` });
  }
  const [[taken]] = await conn.query(
    'SELECT id FROM people_directory WHERE entity_id = ? AND work_email = ? AND id <> ? LIMIT 1',
    [entityId, checked.email, exceptPersonId || 0],
  );
  if (taken) throw new DirectoryError('WORK_EMAIL_TAKEN', 'Email kerja ini sudah dipakai orang lain di direktori', 409, { key: `p${taken.id}` });
  return checked.email;
}

function resignDate(value) {
  const d = isoDate(value);
  if (!d || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) {
    throw new DirectoryError('RESIGN_DATE_REQUIRED', 'Tanggal resign wajib diisi (YYYY-MM-DD)', 400);
  }
  if (d < '2000-01-01') throw new DirectoryError('RESIGN_DATE_INVALID', 'Tanggal resign tidak valid', 400);
  return d;
}

const PERSON_FIELDS = {
  kind: 'kind', excludedReason: 'excluded_reason', fullName: 'full_name', position: 'position',
  departmentId: 'department_id', managerId: 'manager_id', workEmail: 'work_email', workPhone: 'work_phone',
  locationId: 'location_id', status: 'status', resignedOn: 'resigned_on', resignedOnSource: 'resigned_on_source', notes: 'notes',
};

function rowSnapshot(row) {
  const out = {};
  for (const [field, column] of Object.entries(PERSON_FIELDS)) {
    let v = row[column];
    if (column === 'resigned_on') v = isoDate(v);
    else if (['department_id', 'manager_id', 'location_id'].includes(column)) v = int(v);
    out[field] = v === undefined ? null : v;
  }
  return out;
}

/**
 * Applies the requested changes to a locked row (`current`, a people_directory
 * row). Returns the column changes; validates everything against the entity.
 */
async function planChanges(conn, entityId, actorId, current, body, managers) {
  const next = {};
  const isAccount = current.user_id != null;
  if (isAccount && (body.name !== undefined || body.workEmail !== undefined || body.departmentId !== undefined)) {
    throw new DirectoryError('ACCOUNT_FIELDS', 'Nama, email, dan divisi orang yang punya akun diubah di menu Pengguna, bukan di direktori', 400);
  }
  if (!isAccount) {
    if (body.name !== undefined) {
      const name = trimOrNull(body.name);
      if (!name) throw new DirectoryError('NAME_REQUIRED', 'Nama wajib diisi', 400);
      next.full_name = name;
    }
    if (body.workEmail !== undefined) next.work_email = await checkNoAccountEmail(conn, entityId, body.workEmail, current.id);
    if (body.departmentId !== undefined) next.department_id = await checkDepartment(conn, entityId, body.departmentId);
  }
  if (body.position !== undefined) next.position = trimOrNull(body.position);
  if (body.workPhone !== undefined) next.work_phone = trimOrNull(body.workPhone);
  if (body.notes !== undefined) next.notes = trimOrNull(body.notes);
  if (body.locationId !== undefined) next.location_id = await checkLocation(conn, entityId, body.locationId);

  if (body.managerKey !== undefined) {
    if (body.managerKey === null || body.managerKey === '') next.manager_id = null;
    else {
      const managerId = await resolveManager(conn, entityId, body.managerKey, actorId);
      if (managerId === Number(current.id)) throw new DirectoryError('MANAGER_SELF', 'Seseorang tidak bisa menjadi atasannya sendiri', 400);
      // A new manager row may have been created for an account: include it.
      if (!managers.has(managerId)) managers.set(managerId, null);
      if (createsCycle(managers, Number(current.id), managerId)) {
        throw new DirectoryError('MANAGER_CYCLE', 'Atasan ini melapor (langsung atau tidak) ke orang tersebut — struktur jadi berputar', 409);
      }
      next.manager_id = managerId;
    }
  }

  if (body.kind !== undefined) {
    next.kind = body.kind;
    if (body.kind === 'excluded') {
      const reason = trimOrNull(body.excludedReason ?? current.excluded_reason);
      if (!reason) throw new DirectoryError('EXCLUDED_REASON_REQUIRED', 'Alasan dikecualikan wajib diisi', 400);
      next.excluded_reason = reason;
    } else next.excluded_reason = null;
  } else if (body.excludedReason !== undefined && current.kind === 'excluded') {
    const reason = trimOrNull(body.excludedReason);
    if (!reason) throw new DirectoryError('EXCLUDED_REASON_REQUIRED', 'Alasan dikecualikan wajib diisi', 400);
    next.excluded_reason = reason;
  }

  if (body.status === 'resigned') {
    next.status = 'resigned';
    next.resigned_on = resignDate(body.resignedOn ?? (current.status === 'resigned' ? current.resigned_on : null));
    next.resigned_on_source = body.resignedOn !== undefined || current.status !== 'resigned' ? 'entered' : current.resigned_on_source;
  } else if (body.status === 'active') {
    next.status = 'active';
    next.resigned_on = null;
    next.resigned_on_source = null;
  } else if (body.resignedOn !== undefined) {
    if (current.status !== 'resigned') throw new DirectoryError('NOT_RESIGNED', 'Tanggal resign hanya untuk orang berstatus resign', 400);
    next.resigned_on = resignDate(body.resignedOn);
    next.resigned_on_source = 'entered';
  }
  return next;
}

function diff(current, next) {
  const before = {};
  const after = {};
  const snap = rowSnapshot(current);
  const fieldOf = Object.fromEntries(Object.entries(PERSON_FIELDS).map(([f, c]) => [c, f]));
  for (const [column, value] of Object.entries(next)) {
    const field = fieldOf[column];
    const old = snap[field];
    const neu = column === 'resigned_on' ? isoDate(value) : value;
    if ((old ?? null) !== (neu ?? null)) { before[field] = old ?? null; after[field] = neu ?? null; }
  }
  return { before, after };
}

async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (e && e.code === 'ER_DUP_ENTRY') {
      if (/work_email/.test(e.message)) throw new DirectoryError('WORK_EMAIL_TAKEN', 'Email kerja ini sudah dipakai orang lain di direktori', 409);
      if (/org_locations/.test(e.message)) throw new DirectoryError('LOCATION_EXISTS', 'Nama lokasi sudah ada', 409);
    }
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * PATCH a directory entry. `key` 'u<id>' (an account without a row yet) first
 * gets its row — that is People & Culture reviewing the account.
 */
async function update(entityId, actorId, key, body) {
  const parsed = parseKey(key);
  if (!parsed) throw new DirectoryError('NOT_FOUND', 'Orang tidak ditemukan di direktori', 404);
  return withTransaction(async (conn) => {
    const managers = await lockDirectory(conn, entityId);
    let personId = parsed.personId;
    if (personId == null) {
      const [[u]] = await conn.query(
        'SELECT id FROM users WHERE id = ? AND entity_id = ? AND deleted_at IS NULL LIMIT 1',
        [parsed.userId, entityId],
      );
      if (!u) throw new DirectoryError('NOT_FOUND', 'Orang tidak ditemukan di direktori', 404);
      personId = (await ensurePersonForUser(conn, entityId, parsed.userId, actorId, { create: true })).id;
      if (!managers.has(personId)) managers.set(personId, null);
    }
    const [[current]] = await conn.query(
      'SELECT * FROM people_directory WHERE id = ? AND entity_id = ? LIMIT 1 FOR UPDATE',
      [personId, entityId],
    );
    if (!current) throw new DirectoryError('NOT_FOUND', 'Orang tidak ditemukan di direktori', 404);
    const next = await planChanges(conn, entityId, actorId, current, body, managers);
    const { before, after } = diff(current, next);
    if (Object.keys(after).length) {
      const sets = Object.keys(next).map((c) => `${c} = ?`);
      await conn.query(
        `UPDATE people_directory SET ${sets.join(', ')}, updated_by = ? WHERE id = ? AND entity_id = ?`,
        [...Object.values(next), actorId || null, personId, entityId],
      );
      await logWith(conn, {
        entityId, userId: actorId || null, action: 'people_directory.update',
        subjectType: 'people_directory', subjectId: personId, metadata: { before, after },
      });
    }
    return { key: `p${personId}`, personId, changed: Object.keys(after) };
  });
}

/** POST a person without an app account. */
async function createPerson(entityId, actorId, body) {
  const name = trimOrNull(body.name);
  if (!name) throw new DirectoryError('NAME_REQUIRED', 'Nama wajib diisi', 400);
  return withTransaction(async (conn) => {
    const managers = await lockDirectory(conn, entityId);
    // Never silently a duplicate (rule 8): same name as an account or a row needs an explicit confirmation.
    if (!body.confirmDuplicateName) {
      const [[same]] = await conn.query(
        `SELECT 'u' AS t, u.id, u.name FROM users u
          WHERE u.entity_id = ? AND u.deleted_at IS NULL AND LOWER(TRIM(u.name)) = ?
         UNION ALL
         SELECT 'p', p.id, p.full_name FROM people_directory p
          WHERE p.entity_id = ? AND p.name_key = ?
         LIMIT 1`,
        [entityId, nameKey(name), entityId, nameKey(name)],
      );
      if (same) {
        throw new DirectoryError('NAME_EXISTS', `Nama ini sudah ada di direktori ("${same.name}"). Kirim ulang dengan konfirmasi bila memang orang yang berbeda.`, 409, { key: `${same.t}${same.id}` });
      }
    }
    const workEmail = await checkNoAccountEmail(conn, entityId, body.workEmail);
    const departmentId = await checkDepartment(conn, entityId, body.departmentId ?? null);
    const [ins] = await conn.query(
      `INSERT INTO people_directory (entity_id, full_name, work_email, department_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entityId, name, workEmail, departmentId, actorId || null, actorId || null],
    );
    const personId = Number(ins.insertId);
    managers.set(personId, null);
    const [[current]] = await conn.query('SELECT * FROM people_directory WHERE id = ? AND entity_id = ? FOR UPDATE', [personId, entityId]);
    const rest = { ...body };
    delete rest.name; delete rest.workEmail; delete rest.departmentId;
    const next = await planChanges(conn, entityId, actorId, current, rest, managers);
    if (Object.keys(next).length) {
      await conn.query(
        `UPDATE people_directory SET ${Object.keys(next).map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND entity_id = ?`,
        [...Object.values(next), personId, entityId],
      );
    }
    await logWith(conn, {
      entityId, userId: actorId || null, action: 'people_directory.create',
      subjectType: 'people_directory', subjectId: personId,
      metadata: { after: { ...rowSnapshot({ ...current, ...next }) } },
    });
    return { key: `p${personId}`, personId };
  });
}

module.exports = {
  DirectoryError,
  DIRECTORY_SQL,
  parseKey,
  keyOf,
  nameKey,
  trimOrNull,
  isoDate,
  shapeEntry,
  list,
  summary,
  detail,
  orgChart,
  ensurePersonForUser,
  linkAccount,
  syncAccountStatus,
  lockDirectory,
  createsCycle,
  update,
  createPerson,
  withTransaction,
};
