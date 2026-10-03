// Layanan GA — Peminjaman ruang dan kendaraan, and the resources themselves
// (docs/rancangan-people-culture-g2.md §3.2, decisions 16–20).
//
// Clash rule (decision 19, D9): every write that can take a slot runs in one
// transaction that first locks the resource row (SELECT … FOR UPDATE), so all
// writers of one room/vehicle are serialised; the overlap check then reads the
// latest committed bookings (a locking read, never an older snapshot).
// Half-open intervals: a booking ending at 10.00 and one starting at 10.00 do
// not clash. Blocking: confirmed, in_use (until returned — at least until
// now), and pending_approval whose start is still in the future.
//
// Rooms are confirmed at once when free; vehicles wait for the requester's
// manager / division Head (approval engine + resolver).

const pool = require('../db/pool');
const rules = require('./gaRules');
const shared = require('./gaShared.service');
const { insertWithNumber } = require('./nextNumber');
const { log: logOutside } = require('./activityLog.service');

const { GaError, notFound, forbidden, versionConflict } = shared;
const { toApiTime } = rules;

const BLOCKING_SQL = `(b.status IN ('confirmed', 'in_use')
    OR (b.status = 'pending_approval' AND b.starts_at > UTC_TIMESTAMP()))`;
const EFFECTIVE_END_SQL = "CASE WHEN b.status = 'in_use' THEN GREATEST(b.ends_at, UTC_TIMESTAMP()) ELSE b.ends_at END";
const ACTIVE_STATUSES = ['pending_approval', 'confirmed', 'in_use', 'returned'];

const BOOKING_SELECT = `
  SELECT b.*, g.name AS resource_name, g.plate_number, g.location_id, l.name AS location_name,
         d.name AS department_name, ru.name AS requester_name,
         COALESCE(du.name, dp.full_name) AS driver_name, ar.status AS approval_status
    FROM ga_bookings b
    JOIN ga_resources g ON g.entity_id = b.entity_id AND g.id = b.resource_id
    JOIN org_locations l ON l.entity_id = g.entity_id AND l.id = g.location_id
    LEFT JOIN departments d ON d.id = b.department_id
    LEFT JOIN users ru ON ru.id = b.requester_user_id
    LEFT JOIN people_directory dp ON dp.entity_id = b.entity_id AND dp.id = b.driver_person_id
    LEFT JOIN users du ON du.id = dp.user_id
    LEFT JOIN approval_requests ar ON ar.id = b.approval_request_id`;

// ------------------------------------------------------------------ resources

function resourceDto(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    kindLabel: rules.RESOURCE_KIND_LABELS[row.kind],
    name: row.name,
    locationId: Number(row.location_id),
    locationName: row.location_name || null,
    capacity: row.capacity != null ? Number(row.capacity) : null,
    plateNumber: row.plate_number || null,
    isActive: Boolean(row.is_active),
    notes: row.notes || null,
    version: Number(row.version),
  };
}

async function listResources(user, query = {}) {
  const where = ['g.entity_id = ?'];
  const args = [user.entityId];
  if (rules.RESOURCE_KINDS.includes(query.kind)) { where.push('g.kind = ?'); args.push(query.kind); }
  if (Number(query.locationId) > 0) { where.push('g.location_id = ?'); args.push(Number(query.locationId)); }
  // Inactive resources only for those who manage them.
  const wantAll = (query.active === 'all' || query.active === '0') && shared.canManageResources(user);
  if (!wantAll) where.push('g.is_active = 1');
  else if (query.active === '0') where.push('g.is_active = 0');
  const [rows] = await pool.query(
    `SELECT g.*, l.name AS location_name FROM ga_resources g
       JOIN org_locations l ON l.entity_id = g.entity_id AND l.id = g.location_id
      WHERE ${where.join(' AND ')} ORDER BY g.kind, l.name, g.name LIMIT 500`,
    args,
  );
  return rows.map(resourceDto);
}

function cleanPlate(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  return text || null;
}

function translateDuplicate(error) {
  if (error?.code !== 'ER_DUP_ENTRY') return error;
  if (/plate/.test(error.sqlMessage || '')) return new GaError('PLATE_DUPLICATE', 'Nomor polisi itu sudah terdaftar', 409);
  return new GaError('NAME_DUPLICATE', 'Nama itu sudah dipakai untuk jenis yang sama', 409);
}

async function createResource(user, body) {
  if (!shared.canManageResources(user)) throw forbidden();
  if (body.kind === 'vehicle') throw new GaError('VEHICLES_IN_TRACKCAR', rules.VEHICLES_IN_TRACKCAR, 409);
  const plate = body.kind === 'vehicle' ? cleanPlate(body.plateNumber) : null;
  if (body.kind === 'vehicle' && !plate) throw new GaError('VALIDATION_ERROR', 'Nomor polisi wajib untuk kendaraan');
  const id = await shared.transaction(async (conn) => {
    await shared.assertLocation(conn, user.entityId, body.locationId);
    try {
      const [created] = await conn.query(
        `INSERT INTO ga_resources (entity_id, location_id, kind, name, capacity, plate_number, notes, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [user.entityId, body.locationId, body.kind, body.name.trim(), body.kind === 'room' ? (body.capacity ?? null) : null,
          plate, body.notes ? String(body.notes).trim() || null : null, user.sub, user.sub],
      );
      await shared.log(conn, {
        entityId: user.entityId, userId: user.sub, action: 'ga.resource.create', subjectType: 'ga_resource', subjectId: created.insertId,
        metadata: { kind: body.kind, name: body.name.trim() },
      });
      return created.insertId;
    } catch (error) { throw translateDuplicate(error); }
  });
  return getResource(user, id);
}

async function getResource(user, id) {
  const [[row]] = await pool.query(
    `SELECT g.*, l.name AS location_name FROM ga_resources g
       JOIN org_locations l ON l.entity_id = g.entity_id AND l.id = g.location_id
      WHERE g.id = ? AND g.entity_id = ? LIMIT 1`,
    [id, user.entityId],
  );
  if (!row || (!row.is_active && !shared.canManageResources(user))) throw notFound('Ruang atau kendaraan');
  return resourceDto(row);
}

async function updateResource(user, id, body) {
  if (!shared.canManageResources(user)) throw forbidden();
  await shared.transaction(async (conn) => {
    // Same lock as a booking: deactivation cannot race a new booking.
    const [[row]] = await conn.query('SELECT * FROM ga_resources WHERE id = ? AND entity_id = ? LIMIT 1 FOR UPDATE', [id, user.entityId]);
    if (!row) throw notFound('Ruang atau kendaraan');
    if (Number(body.version) !== Number(row.version)) throw versionConflict();
    const patch = {};
    if (body.name !== undefined) patch.name = body.name.trim();
    if (body.locationId !== undefined) {
      await shared.assertLocation(conn, user.entityId, body.locationId);
      patch.location_id = body.locationId;
    }
    if (body.capacity !== undefined) {
      if (row.kind !== 'room' && body.capacity != null) throw new GaError('VALIDATION_ERROR', 'Kapasitas hanya untuk ruang');
      patch.capacity = body.capacity;
    }
    if (body.plateNumber !== undefined) {
      if (row.kind !== 'vehicle') throw new GaError('VALIDATION_ERROR', 'Nomor polisi hanya untuk kendaraan');
      const plate = cleanPlate(body.plateNumber);
      if (!plate) throw new GaError('VALIDATION_ERROR', 'Nomor polisi wajib untuk kendaraan');
      patch.plate_number = plate;
    }
    if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() || null : null;
    if (body.isActive !== undefined) {
      if (!body.isActive && row.is_active) {
        const [holding] = await conn.query(
          `SELECT booking_number, status, starts_at, ends_at FROM ga_bookings
            WHERE entity_id = ? AND resource_id = ?
              AND (status = 'in_use' OR (status IN ('confirmed', 'pending_approval') AND ends_at > UTC_TIMESTAMP()))
            ORDER BY starts_at LIMIT 20`,
          [user.entityId, row.id],
        );
        if (holding.length) {
          throw new GaError('RESOURCE_HAS_BOOKINGS', `Masih ada ${holding.length} peminjaman berjalan atau terjadwal. Batalkan atau selesaikan dulu.`, 409, {
            bookings: holding.map((b) => ({ bookingNumber: b.booking_number, status: b.status, startsAt: toApiTime(b.starts_at), endsAt: toApiTime(b.ends_at) })),
          });
        }
      }
      patch.is_active = body.isActive ? 1 : 0;
    }
    const keys = Object.keys(patch);
    if (!keys.length) return;
    try {
      await conn.query(
        `UPDATE ga_resources SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_by = ?, version = version + 1 WHERE id = ?`,
        [...keys.map((k) => patch[k]), user.sub, row.id],
      );
    } catch (error) { throw translateDuplicate(error); }
    await shared.log(conn, {
      entityId: user.entityId, userId: user.sub, action: 'ga.resource.update', subjectType: 'ga_resource', subjectId: row.id,
      metadata: { changed: keys },
    });
  });
  return getResource(user, id);
}

// ------------------------------------------------------------------ bookings: read

function bookingDto(row, extra = {}) {
  return {
    id: Number(row.id),
    bookingNumber: row.booking_number,
    resourceId: Number(row.resource_id),
    resourceKind: row.resource_kind,
    resourceName: row.resource_name || null,
    plateNumber: row.plate_number || null,
    locationId: row.location_id != null ? Number(row.location_id) : null,
    locationName: row.location_name || null,
    departmentId: row.department_id != null ? Number(row.department_id) : null,
    departmentName: row.department_name || null,
    requester: { id: Number(row.requester_user_id), name: row.requester_name || null },
    startsAt: toApiTime(row.starts_at),
    endsAt: toApiTime(row.ends_at),
    purpose: row.purpose,
    destination: row.destination || null,
    needsDriver: Boolean(row.needs_driver),
    driverPersonId: row.driver_person_id ? Number(row.driver_person_id) : null,
    driverName: row.driver_name || null,
    status: row.status,
    approvalRequestId: row.approval_request_id ? Number(row.approval_request_id) : null,
    approvalStatus: row.approval_status || null,
    approverBasis: row.approver_basis || null,
    decisionNote: row.decision_note || null,
    checkedOutAt: toApiTime(row.checked_out_at),
    returnedAt: toApiTime(row.returned_at),
    returnNote: row.return_note || null,
    cancelReason: row.cancel_reason || null,
    late: row.status === 'in_use' && new Date(row.ends_at).getTime() < Date.now(),
    version: Number(row.version),
    createdAt: toApiTime(row.created_at),
    masked: false,
    ...extra,
  };
}

// What someone outside GA sees of another person's booking (S12): the slot and
// the division only — never who, why, or where to.
function maskedDto(row) {
  return {
    id: null,
    masked: true,
    resourceId: Number(row.resource_id),
    resourceKind: row.resource_kind,
    startsAt: toApiTime(row.starts_at),
    endsAt: toApiTime(row.ends_at),
    departmentName: row.department_name || null,
  };
}

async function canReadBooking(user, row) {
  if (!row) return false;
  if (Number(row.requester_user_id) === Number(user.sub)) return true;
  if (shared.canProcess(user)) return true;
  if (shared.managementReads(user, row.department_id)) return true;
  return row.status === 'pending_approval' && shared.userCanDecide(pool, {
    approvalRequestId: row.approval_request_id, user, requesterUserId: row.requester_user_id, createdBy: row.created_by,
  });
}

async function getBooking(user, id) {
  const [[row]] = await pool.query(`${BOOKING_SELECT} WHERE b.id = ? AND b.entity_id = ? LIMIT 1`, [id, user.entityId]);
  if (!row || !(await canReadBooking(user, row))) throw notFound('Peminjaman');
  const logs = await shared.history(user.entityId, rules.SUBJECT_BOOKING, row.id);
  const mine = Number(row.requester_user_id) === Number(user.sub);
  const processor = shared.canProcess(user);
  const notStarted = new Date(row.starts_at).getTime() > Date.now();
  const canDecide = row.status === 'pending_approval' && notStarted && await shared.userCanDecide(pool, {
    approvalRequestId: row.approval_request_id, user, requesterUserId: row.requester_user_id, createdBy: row.created_by,
  });
  const vehicle = row.resource_kind === 'vehicle';
  return bookingDto(row, {
    history: logs.map((l) => ({ id: Number(l.id), action: l.action, userName: l.user_name || null, at: toApiTime(l.created_at) })),
    can: {
      cancel: (['pending_approval', 'confirmed'].includes(row.status) && ((mine && notStarted) || processor)),
      checkout: processor && vehicle && row.status === 'confirmed',
      return: processor && vehicle && row.status === 'in_use',
      decide: Boolean(canDecide),
    },
  });
}

/**
 * Bookings of a period (max 31 days) for the agenda. People who do not
 * process GA see their own bookings in full and everyone else's masked.
 */
async function listBookings(user, query = {}) {
  const processor = shared.canProcess(user);
  const where = ['b.entity_id = ?'];
  const args = [user.entityId];
  const mineOnly = query.mine === '1' || query.mine === true;
  if (mineOnly) {
    where.push('b.requester_user_id = ?');
    args.push(user.sub);
  } else {
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      throw new GaError('VALIDATION_ERROR', 'Tentukan rentang waktu (from, to)');
    }
    if (to.getTime() - from.getTime() > rules.BOOKING_LIST_MAX_DAYS * rules.DAY_MS) {
      throw new GaError('RANGE_TOO_LONG', `Rentang paling panjang ${rules.BOOKING_LIST_MAX_DAYS} hari`);
    }
    where.push('b.starts_at < ? AND ? < GREATEST(b.ends_at, IF(b.status = \'in_use\', UTC_TIMESTAMP(), b.ends_at))');
    args.push(to, from);
    where.push(`b.status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')})`);
    args.push(...ACTIVE_STATUSES);
  }
  if (Number(query.resourceId) > 0) { where.push('b.resource_id = ?'); args.push(Number(query.resourceId)); }
  if (rules.RESOURCE_KINDS.includes(query.kind)) { where.push('b.resource_kind = ?'); args.push(query.kind); }
  const [rows] = await pool.query(
    `${BOOKING_SELECT} WHERE ${where.join(' AND ')} ORDER BY b.starts_at ${mineOnly ? 'DESC' : 'ASC'}, b.id LIMIT 500`,
    args,
  );
  return rows.map((row) => (processor || Number(row.requester_user_id) === Number(user.sub) ? bookingDto(row) : maskedDto(row)));
}

// ------------------------------------------------------------------ bookings: write

async function lockResource(conn, entityId, resourceId) {
  const [[row]] = await conn.query(
    'SELECT * FROM ga_resources WHERE id = ? AND entity_id = ? LIMIT 1 FOR UPDATE',
    [resourceId, entityId],
  );
  return row || null;
}

/** First booking holding [start, end) on the resource (locking read), or null. */
async function findClash(conn, { entityId, resourceId, startsAt, endsAt, excludeId = 0 }) {
  const [[clash]] = await conn.query(
    `SELECT b.id, b.booking_number, b.starts_at, b.ends_at, b.status, b.department_id
       FROM ga_bookings b
      WHERE b.entity_id = ? AND b.resource_id = ? AND b.id <> ?
        AND ${BLOCKING_SQL}
        AND b.starts_at < ? AND ? < ${EFFECTIVE_END_SQL}
      ORDER BY b.starts_at LIMIT 1
      FOR SHARE`,
    [entityId, resourceId, excludeId, endsAt, startsAt],
  );
  if (!clash) return null;
  const [[dept]] = clash.department_id
    ? await conn.query('SELECT name FROM departments WHERE id = ?', [clash.department_id])
    : [[null]];
  return { ...clash, department_name: dept?.name || null };
}

async function driverWarnings(conn, { entityId, driverPersonId, startsAt, endsAt, excludeId = 0 }) {
  if (!driverPersonId) return [];
  const [rows] = await conn.query(
    `SELECT b.booking_number, b.starts_at, b.ends_at FROM ga_bookings b
      WHERE b.entity_id = ? AND b.driver_person_id = ? AND b.id <> ?
        AND ${BLOCKING_SQL}
        AND b.starts_at < ? AND ? < ${EFFECTIVE_END_SQL}
      ORDER BY b.starts_at LIMIT 5`,
    [entityId, driverPersonId, excludeId, endsAt, startsAt],
  );
  return rows.map((r) => ({
    code: 'DRIVER_BUSY',
    message: `Sopir juga dijadwalkan di ${r.booking_number} (${toApiTime(r.starts_at)} – ${toApiTime(r.ends_at)})`,
  }));
}

async function createBooking(user, body, { conn: callerConn = null, now = new Date() } = {}) {
  const run = async (conn) => {
    const account = await shared.accountOf(conn, user);
    // Serialises every write for this resource (decision 19).
    const resource = await lockResource(conn, user.entityId, body.resourceId);
    if (!resource) throw notFound('Ruang atau kendaraan');
    if (!resource.is_active) throw new GaError('RESOURCE_INACTIVE', `${resource.name} sedang tidak bisa dipinjam`, 409);
    if (resource.kind === 'vehicle') throw new GaError('VEHICLES_IN_TRACKCAR', rules.VEHICLES_IN_TRACKCAR, 409);
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    const problem = rules.bookingWindowProblem({ kind: resource.kind, startsAt, endsAt, now });
    if (problem) throw new GaError(problem.code, problem.message);
    const vehicle = resource.kind === 'vehicle';
    if (!vehicle && (body.destination || body.needsDriver || body.driverPersonId)) {
      throw new GaError('VALIDATION_ERROR', 'Tujuan dan sopir hanya untuk kendaraan');
    }
    if (body.driverPersonId) {
      const [[driver]] = await conn.query(
        "SELECT id FROM people_directory WHERE id = ? AND entity_id = ? AND status = 'active' AND kind <> 'excluded' LIMIT 1",
        [body.driverPersonId, user.entityId],
      );
      if (!driver) throw new GaError('DRIVER_INVALID', 'Sopir tidak ditemukan di direktori');
    }

    const clash = await findClash(conn, { entityId: user.entityId, resourceId: resource.id, startsAt, endsAt });
    if (clash) {
      throw new GaError('BOOKING_CONFLICT', `${resource.name} sudah terpakai pada jam itu`, 409, {
        clash: { startsAt: toApiTime(clash.starts_at), endsAt: toApiTime(clash.ends_at), departmentName: clash.department_name },
      });
    }
    const warnings = await driverWarnings(conn, { entityId: user.entityId, driverPersonId: body.driverPersonId, startsAt, endsAt });

    const status = vehicle ? 'pending_approval' : 'confirmed';
    const { number, result: [created] } = await insertWithNumber(
      conn, { table: 'ga_bookings', column: 'booking_number', prefix: 'PJM', entityId: user.entityId, day: rules.wibDay(now) },
      (number) => conn.query(
        `INSERT INTO ga_bookings
           (entity_id, department_id, booking_number, resource_id, resource_kind, requester_user_id, starts_at, ends_at,
            purpose, destination, needs_driver, driver_person_id, status, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [user.entityId, account.department_id || null, number, resource.id, resource.kind, user.sub, startsAt, endsAt,
          body.purpose.trim(), vehicle ? (body.destination ? body.destination.trim() || null : null) : null,
          vehicle && body.needsDriver ? 1 : 0, vehicle ? (body.driverPersonId || null) : null, status, user.sub, user.sub],
      ),
    );
    const id = created.insertId;
    let approval = null;
    if (vehicle) {
      approval = await shared.openApproval(conn, {
        entityId: user.entityId,
        account,
        requesterUserId: user.sub,
        subjectType: rules.SUBJECT_BOOKING,
        subjectId: id,
        requestType: rules.VEHICLE_REQUEST_TYPE,
        title: `Peminjaman kendaraan ${number} — ${resource.name}`.slice(0, 255),
        description: `${toApiTime(startsAt)} – ${toApiTime(endsAt)} · ${body.purpose.trim()}`.slice(0, 500),
      });
      await conn.query('UPDATE ga_bookings SET approval_request_id = ?, approver_basis = ? WHERE id = ?', [approval.approvalRequestId, approval.basis, id]);
    }
    await shared.log(conn, {
      entityId: user.entityId, userId: user.sub, action: 'ga.booking.create', subjectType: rules.SUBJECT_BOOKING, subjectId: id,
      metadata: { number, resourceId: Number(resource.id), status, approverBasis: approval?.basis || null },
    });
    return { id, number, approval, resourceName: resource.name, warnings };
  };

  let outcome;
  try {
    outcome = callerConn ? await run(callerConn) : await shared.transaction(run);
  } catch (error) {
    if (shared.isLockTimeout(error)) {
      throw new GaError('BOOKING_BUSY', 'Ruang atau kendaraan ini sedang dipesan orang lain. Coba lagi sebentar.', 409);
    }
    throw error;
  }
  if (outcome.approval && !callerConn) {
    const users = await shared.activeStepUsers(user.entityId, outcome.approval.approvalRequestId, [user.sub]);
    await shared.notifyUsers(users, {
      entityId: user.entityId, title: 'Peminjaman kendaraan menunggu persetujuan Anda', body: `${outcome.number} · ${outcome.resourceName}`,
      event: 'ga.approval_requested', subjectType: rules.SUBJECT_BOOKING, subjectId: outcome.id, actionUrl: `/ga/bookings/${outcome.id}`,
    });
  }
  if (callerConn) return { id: outcome.id, bookingNumber: outcome.number, warnings: outcome.warnings };
  return { ...(await getBooking(user, outcome.id)), warnings: outcome.warnings };
}

async function lockBooking(conn, entityId, id) {
  const [[row]] = await conn.query('SELECT * FROM ga_bookings WHERE id = ? AND entity_id = ? LIMIT 1 FOR UPDATE', [id, entityId]);
  return row || null;
}

async function bumpBooking(conn, id, version, patch) {
  const keys = Object.keys(patch);
  const [result] = await conn.query(
    `UPDATE ga_bookings SET ${keys.map((k) => `${k} = ?`).join(', ')}, version = version + 1 WHERE id = ? AND version = ?`,
    [...keys.map((k) => patch[k]), id, version],
  );
  if (!result.affectedRows) throw versionConflict();
}

async function cancelBooking(user, id, { reason }) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new GaError('VALIDATION_ERROR', 'Tulis alasan pembatalan');
  const row = await shared.transaction(async (conn) => {
    const [[peek]] = await conn.query('SELECT resource_id FROM ga_bookings WHERE id = ? AND entity_id = ? LIMIT 1', [id, user.entityId]);
    if (!peek) throw notFound('Peminjaman');
    await lockResource(conn, user.entityId, peek.resource_id);
    const booking = await lockBooking(conn, user.entityId, id);
    if (!booking) throw notFound('Peminjaman');
    const mine = Number(booking.requester_user_id) === Number(user.sub);
    const processor = shared.canProcess(user);
    if (!mine && !processor) {
      if (await canReadBooking(user, booking)) throw forbidden('Hanya peminjam atau People & Culture yang bisa membatalkan');
      throw notFound('Peminjaman');
    }
    if (!['pending_approval', 'confirmed'].includes(booking.status)) {
      throw new GaError('INVALID_STATUS', booking.status === 'in_use' ? 'Kendaraan sedang dipakai; terima kembali dulu' : 'Peminjaman ini sudah selesai', 409);
    }
    if (!processor && new Date(booking.starts_at).getTime() <= Date.now()) {
      throw new GaError('BOOKING_STARTED', 'Peminjaman sudah dimulai; hubungi People & Culture untuk membatalkan', 409);
    }
    if (booking.status === 'pending_approval') {
      await shared.withdrawApproval(conn, booking.approval_request_id, user.sub, `Dibatalkan: ${cleanReason}`);
    }
    await bumpBooking(conn, booking.id, booking.version, {
      status: 'cancelled', cancel_reason: cleanReason.slice(0, 255), cancelled_by: user.sub, cancelled_at: new Date(), updated_by: user.sub,
    });
    await shared.log(conn, {
      entityId: user.entityId, userId: user.sub, action: 'ga.booking.cancel', subjectType: rules.SUBJECT_BOOKING, subjectId: booking.id,
      metadata: { from: booking.status, reason: cleanReason.slice(0, 255) },
    });
    return booking;
  });
  if (Number(row.requester_user_id) !== Number(user.sub)) {
    await shared.notifyUsers([row.requester_user_id], {
      entityId: user.entityId, title: 'Peminjaman dibatalkan', body: `${row.booking_number} — ${cleanReason.slice(0, 200)}`,
      event: 'ga.booking_status', subjectType: rules.SUBJECT_BOOKING, subjectId: row.id, actionUrl: `/ga/bookings/${row.id}`,
    });
  }
  return getBooking(user, id);
}

async function checkout(user, id) {
  if (!shared.canProcess(user)) throw forbidden();
  await shared.transaction(async (conn) => {
    const [[peek]] = await conn.query('SELECT resource_id FROM ga_bookings WHERE id = ? AND entity_id = ? LIMIT 1', [id, user.entityId]);
    if (!peek) throw notFound('Peminjaman');
    await lockResource(conn, user.entityId, peek.resource_id);
    const booking = await lockBooking(conn, user.entityId, id);
    if (!booking) throw notFound('Peminjaman');
    if (booking.resource_kind !== 'vehicle') throw new GaError('VALIDATION_ERROR', 'Serah terima kunci hanya untuk kendaraan');
    if (booking.status !== 'confirmed') throw new GaError('INVALID_STATUS', 'Hanya peminjaman terkonfirmasi yang bisa diserahkan', 409);
    const [[out]] = await conn.query(
      "SELECT booking_number FROM ga_bookings WHERE entity_id = ? AND resource_id = ? AND status = 'in_use' AND id <> ? LIMIT 1",
      [user.entityId, booking.resource_id, booking.id],
    );
    if (out) throw new GaError('VEHICLE_NOT_RETURNED', `Kendaraan belum dikembalikan dari ${out.booking_number}`, 409);
    await bumpBooking(conn, booking.id, booking.version, { status: 'in_use', checked_out_at: new Date(), checked_out_by: user.sub, updated_by: user.sub });
    await shared.log(conn, {
      entityId: user.entityId, userId: user.sub, action: 'ga.booking.checkout', subjectType: rules.SUBJECT_BOOKING, subjectId: booking.id,
    });
  });
  return getBooking(user, id);
}

async function returnVehicle(user, id, { note }) {
  if (!shared.canProcess(user)) throw forbidden();
  const cleanNote = String(note || '').trim();
  await shared.transaction(async (conn) => {
    const booking = await lockBooking(conn, user.entityId, id);
    if (!booking) throw notFound('Peminjaman');
    if (booking.resource_kind !== 'vehicle') throw new GaError('VALIDATION_ERROR', 'Terima kembali hanya untuk kendaraan');
    if (booking.status !== 'in_use') throw new GaError('INVALID_STATUS', 'Kendaraan ini tidak sedang dipakai', 409);
    await bumpBooking(conn, booking.id, booking.version, {
      status: 'returned', returned_at: new Date(), returned_by: user.sub, return_note: cleanNote ? cleanNote.slice(0, 255) : null, updated_by: user.sub,
    });
    await shared.log(conn, {
      entityId: user.entityId, userId: user.sub, action: 'ga.booking.return', subjectType: rules.SUBJECT_BOOKING, subjectId: booking.id,
      metadata: cleanNote ? { note: cleanNote.slice(0, 255) } : null,
    });
  });
  return getBooking(user, id);
}

// ------------------------------------------------------------------ approval hooks
// (registered in approvalSubjectLifecycle.service.js for subject ga_booking)

async function lockForDecision(approval, conn) {
  const booking = await lockBooking(conn, approval.entity_id, approval.subject_id);
  if (!booking) throw notFound('Peminjaman');
  if (booking.status !== 'pending_approval' || Number(booking.approval_request_id) !== Number(approval.id)) {
    throw new GaError('STALE_APPROVAL', 'Approval ini bukan approval aktif peminjaman tersebut', 409);
  }
  return booking;
}

async function assertCanDecide({ approval, user, action, note, conn }) {
  const booking = await lockForDecision(approval, conn);
  const denial = await shared.decisionDenial(conn, { approval, user, requesterUserId: booking.requester_user_id, createdBy: booking.created_by });
  if (denial) {
    // Outside the decision's transaction (which rolls back on this error), so the denial stays logged.
    await logOutside({
      entityId: approval.entity_id, userId: user.sub, action: 'ga.booking.decision_denied', subjectType: rules.SUBJECT_BOOKING,
      subjectId: booking.id, metadata: { approvalRequestId: approval.id, action, code: denial.code },
    });
    throw denial;
  }
  if (action === 'request_revision') {
    throw new GaError('REVISION_NOT_SUPPORTED', 'Tolak dengan catatan; pengaju bisa mengajukan ulang', 409);
  }
  if (action !== 'approve' && action !== 'reject') throw new GaError('VALIDATION_ERROR', 'Peminjaman hanya bisa disetujui atau ditolak');
  if (new Date(booking.starts_at).getTime() <= Date.now()) {
    throw new GaError('BOOKING_STARTED', 'Jam mulai peminjaman sudah lewat, jadi tidak bisa diputuskan lagi', 409);
  }
  if (action === 'reject' && !String(note || '').trim()) throw new GaError('VALIDATION_ERROR', 'Tulis alasan penolakan');
}

async function canUserDecide({ approval, user, conn }) {
  const [[booking]] = await conn.query(
    'SELECT status, approval_request_id, requester_user_id, created_by, starts_at FROM ga_bookings WHERE id = ? AND entity_id = ? LIMIT 1',
    [approval.subject_id, approval.entity_id],
  );
  if (!booking || booking.status !== 'pending_approval' || Number(booking.approval_request_id) !== Number(approval.id)) return false;
  if (new Date(booking.starts_at).getTime() <= Date.now()) return false;
  return !(await shared.decisionDenial(conn, { approval, user, requesterUserId: booking.requester_user_id, createdBy: booking.created_by }));
}

async function applyApprovalDecision({ approval, result, actorUserId, note = null, conn }) {
  if (result?.status !== 'approved' && result?.status !== 'rejected') return { changed: false };
  const booking = await lockForDecision(approval, conn);
  const status = result.status === 'approved' ? 'confirmed' : 'rejected';
  await bumpBooking(conn, booking.id, booking.version, {
    status, decision_note: note ? String(note).trim().slice(0, 500) || null : null, updated_by: actorUserId,
  });
  await shared.log(conn, {
    entityId: booking.entity_id, userId: actorUserId, action: `ga.booking.${status}`, subjectType: rules.SUBJECT_BOOKING,
    subjectId: booking.id, metadata: { approvalRequestId: approval.id },
  });
  return {
    changed: true, kind: 'booking', status, id: Number(booking.id), entityId: Number(booking.entity_id),
    requesterUserId: Number(booking.requester_user_id), number: booking.booking_number, note: note || null,
  };
}

async function afterDecision(outcome) {
  if (!outcome?.changed) return;
  await shared.notifyUsers([outcome.requesterUserId], {
    entityId: outcome.entityId,
    title: outcome.status === 'confirmed' ? 'Peminjaman kendaraan disetujui' : 'Peminjaman kendaraan ditolak',
    body: `${outcome.number}${outcome.note ? ` — ${String(outcome.note).slice(0, 200)}` : ''}`,
    event: 'ga.booking_status', subjectType: rules.SUBJECT_BOOKING, subjectId: outcome.id, actionUrl: `/ga/bookings/${outcome.id}`,
  });
}

module.exports = {
  listResources,
  getResource,
  createResource,
  updateResource,
  listBookings,
  getBooking,
  createBooking,
  cancelBooking,
  checkout,
  returnVehicle,
  findClash,
  assertCanDecide,
  canUserDecide,
  applyApprovalDecision,
  afterDecision,
  bookingDto,
  maskedDto,
};
