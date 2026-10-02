const { logWith } = require('./activityLog.service');
const {
  DEVICE_STATUSES, DEVICE_STATUS_LABELS, FINAL_STATUSES, ASSIGNABLE_FROM,
} = require('../config/itAssets');

// People & Culture wave 1, rules 14/15 — one code path for a device's status and
// holder. The holder is always an active device_assignments row (an app user,
// a directory person without an account, or a team label); the devices row
// only caches it (current_assignee_id / holder_person_id / holder_label).
// Every function runs on the caller's connection inside its transaction, with
// the device row already locked (SELECT … FOR UPDATE).

class DeviceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const WIB_TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
const label = (s) => DEVICE_STATUS_LABELS[s] || s;

/** The holder named in a request body: exactly one of assignedTo / personId / holderLabel. */
function holderFromBody(body = {}) {
  const given = [
    body.assignedTo != null ? { userId: Number(body.assignedTo) } : null,
    body.personId != null ? { personId: Number(body.personId) } : null,
    body.holderLabel != null && String(body.holderLabel).trim() !== '' ? { label: String(body.holderLabel).replace(/\s+/g, ' ').trim() } : null,
  ].filter(Boolean);
  if (given.length > 1) throw new DeviceError('HOLDER_AMBIGUOUS', 'Pilih satu pemegang saja: akun, orang di direktori, atau label tim', 400);
  return given[0] || null;
}

/**
 * Checks a holder against the entity and returns it in its stored form. A
 * directory person who has an app account is stored as that account
 * (assigned_to), so devices.current_assignee_id keeps working for app users.
 */
async function resolveHolder(conn, entityId, holder) {
  if (!holder) return null;
  if (holder.label) {
    if (holder.label.length > 120) throw new DeviceError('HOLDER_LABEL_TOO_LONG', 'Label pemegang maksimal 120 karakter', 400);
    return { label: holder.label, name: holder.label, departmentId: null };
  }
  if (holder.userId) {
    const [[u]] = await conn.query(
      `SELECT id, name, department_id FROM users
        WHERE id = ? AND entity_id = ? AND deleted_at IS NULL AND status = 'active' LIMIT 1`,
      [holder.userId, entityId],
    );
    if (!u) throw new DeviceError('HOLDER_NOT_FOUND', 'Pengguna tidak ditemukan di perusahaan ini', 404);
    return { userId: Number(u.id), name: u.name, departmentId: u.department_id != null ? Number(u.department_id) : null };
  }
  const [[p]] = await conn.query(
    `SELECT p.id, p.user_id, p.kind, p.status, COALESCE(u.name, p.full_name) AS name,
            COALESCE(u.department_id, p.department_id) AS department_id,
            u.status AS account_status, u.deleted_at AS account_deleted
       FROM people_directory p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ? AND p.entity_id = ? LIMIT 1`,
    [holder.personId, entityId],
  );
  if (!p || p.kind === 'excluded') throw new DeviceError('HOLDER_NOT_FOUND', 'Orang tidak ditemukan di direktori perusahaan ini', 404);
  if (p.status !== 'active' || (p.user_id && (p.account_status !== 'active' || p.account_deleted))) {
    throw new DeviceError('HOLDER_RESIGNED', 'Orang ini sudah resign — perangkat tidak bisa diserahkan kepadanya', 409);
  }
  const departmentId = p.department_id != null ? Number(p.department_id) : null;
  return p.user_id
    ? { userId: Number(p.user_id), name: p.name, departmentId }
    : { personId: Number(p.id), name: p.name, departmentId };
}

async function setHolderCache(conn, entityId, deviceId, holder) {
  await conn.query(
    'UPDATE devices SET current_assignee_id = ?, holder_person_id = ?, holder_label = ? WHERE id = ? AND entity_id = ?',
    [holder?.userId || null, holder?.personId || null, holder?.label || null, deviceId, entityId],
  );
}

/** The active assignment of a device, if any (locked). */
async function activeAssignment(conn, entityId, deviceId) {
  const [[a]] = await conn.query(
    `SELECT id, assigned_to, person_id, holder_label FROM device_assignments
      WHERE device_id = ? AND entity_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [deviceId, entityId],
  );
  return a || null;
}

/** Closes the device's active assignment(s) as returned today; clears the cache. */
async function closeActiveAssignment(conn, entityId, deviceId, { notes = null } = {}) {
  const [r] = await conn.query(
    `UPDATE device_assignments
        SET status = 'returned', actual_return_date = ${WIB_TODAY}, notes = COALESCE(?, notes)
      WHERE device_id = ? AND entity_id = ? AND status = 'active'`,
    [notes, deviceId, entityId],
  );
  await setHolderCache(conn, entityId, deviceId, null);
  return r.affectedRows || 0;
}

/** Writes a status, stamping status_changed_at only when it really changes (rule 14). */
async function writeStatus(conn, entityId, deviceId, status, extra = {}) {
  const sets = ['status_changed_at = IF(status <=> ?, status_changed_at, CURRENT_TIMESTAMP)', 'status = ?'];
  const args = [status, status];
  for (const [column, value] of Object.entries(extra)) { sets.push(`${column} = ?`); args.push(value); }
  await conn.query(`UPDATE devices SET ${sets.join(', ')} WHERE id = ? AND entity_id = ?`, [...args, deviceId, entityId]);
}

/**
 * Hands a locked device to a holder: 409 only while an ACTIVE assignment
 * exists. Creates the assignment row, sets status Aktif and the holder cache.
 */
async function openAssignment(conn, {
  entityId, device, holder, actorId, departmentId = null, expectedReturnDate = null, location = null,
  purpose = null, assignedAt = null,
}) {
  if (FINAL_STATUSES.includes(device.status) || !ASSIGNABLE_FROM.includes(device.status)) {
    throw new DeviceError('DEVICE_NOT_ASSIGNABLE', `Perangkat berstatus ${label(device.status)} tidak bisa diserahkan`, 409);
  }
  if (await activeAssignment(conn, entityId, device.id)) {
    throw new DeviceError('CONFLICT', 'Perangkat sedang dipegang orang lain. Kembalikan dulu sebelum diserahkan lagi.', 409);
  }
  const resolved = holder.name !== undefined ? holder : await resolveHolder(conn, entityId, holder);
  const [a] = await conn.query(
    `INSERT INTO device_assignments
       (entity_id, department_id, device_id, assigned_to, person_id, holder_label, assigned_by,
        assigned_at, expected_return_date, location, purpose, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, 'active')`,
    [entityId, departmentId ?? resolved.departmentId ?? null, device.id,
      resolved.userId || null, resolved.personId || null, resolved.label || null, actorId || null,
      assignedAt, expectedReturnDate || null, location || null, purpose || null],
  );
  await writeStatus(conn, entityId, device.id, 'assigned', location !== null && location !== undefined ? { current_location: location } : {});
  await setHolderCache(conn, entityId, device.id, resolved);
  return { assignmentId: Number(a.insertId), holder: resolved };
}

/**
 * IT sets a status directly (rule 14): 'assigned' only with a holder; leaving
 * 'assigned' closes the active assignment; a disposed device stays disposed.
 */
async function changeStatus(conn, { entityId, device, status, holder = null, actorId, note = null }) {
  if (!DEVICE_STATUSES.includes(status)) throw new DeviceError('STATUS_INVALID', 'Status perangkat tidak dikenal', 400);
  if (FINAL_STATUSES.includes(device.status)) {
    throw new DeviceError('DEVICE_FINAL', `Perangkat sudah ${label(device.status)}; statusnya tidak bisa diubah lagi`, 409);
  }
  if (device.status === status) {
    if (status === 'assigned') throw new DeviceError('ALREADY_ASSIGNED', 'Perangkat sudah Aktif. Kembalikan dulu untuk mengganti pemegang.', 409);
    throw new DeviceError('NO_CHANGE', `Perangkat sudah berstatus ${label(status)}`, 400);
  }
  let assignment = null;
  let closed = 0;
  if (status === 'assigned') {
    if (!holder) throw new DeviceError('HOLDER_REQUIRED', 'Status Aktif butuh pemegang: pilih akun, orang di direktori, atau label tim', 400);
    assignment = await openAssignment(conn, { entityId, device, holder, actorId, purpose: note });
  } else {
    if (holder) throw new DeviceError('HOLDER_NOT_ALLOWED', `Pemegang hanya untuk status Aktif, bukan ${label(status)}`, 400);
    closed = await closeActiveAssignment(conn, entityId, device.id, { notes: note });
    await writeStatus(conn, entityId, device.id, status);
  }
  await logWith(conn, {
    entityId, userId: actorId || null, action: 'device.status', subjectType: 'device', subjectId: Number(device.id),
    metadata: { from: device.status, to: status, assignmentId: assignment?.assignmentId || null, closedAssignments: closed, note: note || null },
  });
  return { id: Number(device.id), from: device.status, status, assignmentId: assignment?.assignmentId || null, closedAssignments: closed };
}

/**
 * A status change that another record implies (a repair filed or closed): no
 * error when nothing changes or the device is already disposed; leaving Aktif
 * still closes the active assignment.
 */
async function moveStatus(conn, entityId, device, status, { notes = null } = {}) {
  if (!device || device.status === status || FINAL_STATUSES.includes(device.status)) return { changed: false };
  if (device.status === 'assigned') await closeActiveAssignment(conn, entityId, device.id, { notes });
  await writeStatus(conn, entityId, device.id, status);
  return { changed: true, from: device.status, to: status };
}

/**
 * Returns a device from one ACTIVE assignment (locked here): the assignment is
 * closed today (WIB); the device goes back to Cadangan, or Rusak when it comes
 * back in poor/broken condition (damaged at IT, not yet at a vendor); the
 * holder cache is cleared. The one return path for the IT page and the
 * offboarding checklist (wave 2, §2.1.3). → null when no such active assignment.
 */
async function returnAssignment(conn, { entityId, assignmentId, conditionOnReturn = null, notes = null, actorId = null }) {
  const [[a]] = await conn.query(
    "SELECT * FROM device_assignments WHERE id=? AND entity_id=? AND status='active' FOR UPDATE",
    [assignmentId, entityId],
  );
  if (!a) return null;
  await conn.query(
    `SELECT id FROM devices WHERE id = ? AND entity_id = ? FOR UPDATE`,
    [a.device_id, entityId],
  );
  await conn.query(
    `UPDATE device_assignments
        SET status = 'returned', actual_return_date = ${WIB_TODAY}, notes = ?
      WHERE id = ? AND entity_id = ?`,
    [notes || null, assignmentId, entityId],
  );
  const newStatus = ['poor', 'broken'].includes(conditionOnReturn) ? 'damaged' : 'available';
  // The recorded condition stays when none is given.
  await writeStatus(conn, entityId, a.device_id, newStatus, {
    ...(conditionOnReturn ? { condition_state: conditionOnReturn } : {}),
    current_location: null,
  });
  await setHolderCache(conn, entityId, a.device_id, null);
  await logWith(conn, {
    entityId, userId: actorId || null,
    action: 'device.return', subjectType: 'device_assignment', subjectId: Number(assignmentId),
    metadata: { deviceId: a.device_id, conditionOnReturn, newStatus },
  });
  return { id: Number(assignmentId), deviceId: Number(a.device_id), newStatus };
}

module.exports = {
  DeviceError,
  returnAssignment,
  moveStatus,
  holderFromBody,
  resolveHolder,
  setHolderCache,
  activeAssignment,
  closeActiveAssignment,
  writeStatus,
  openAssignment,
  changeStatus,
};
