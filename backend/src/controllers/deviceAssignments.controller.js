const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { logWith } = require('../services/activityLog.service');
const notif = require('../services/notification.service');
const lifecycle = require('../services/deviceLifecycle.service');

async function list(req, res, next) {
  try {
    // Always the signed-in user's company; never from the request.
    const where = ['a.entity_id = ?'];
    const args = [req.user.entityId];
    if (req.query.deviceId) { where.push('a.device_id = ?'); args.push(req.query.deviceId); }
    if (req.query.assignedTo) { where.push('a.assigned_to = ?'); args.push(req.query.assignedTo); }
    if (req.query.personId) { where.push('a.person_id = ?'); args.push(req.query.personId); }
    if (req.query.status) { where.push('a.status = ?'); args.push(req.query.status); }

    const [rows] = await pool.query(
      `SELECT a.id, a.entity_id AS entityId, a.department_id AS departmentId,
              a.device_id AS deviceId, d.asset_code AS assetCode,
              d.device_type AS deviceType, d.brand, d.model,
              a.assigned_to AS assignedTo, u.name AS assignedToName,
              a.person_id AS personId, a.holder_label AS holderLabel,
              COALESCE(u.name, pu.name, p.full_name, a.holder_label) AS holderName,
              a.assigned_by AS assignedBy, a.assigned_at AS assignedAt,
              a.expected_return_date AS expectedReturnDate,
              a.actual_return_date AS actualReturnDate,
              a.status, a.location, a.purpose
         FROM device_assignments a
         JOIN devices d ON d.id = a.device_id AND d.entity_id = a.entity_id
         LEFT JOIN users u ON u.id = a.assigned_to
         LEFT JOIN people_directory p ON p.id = a.person_id AND p.entity_id = a.entity_id
         LEFT JOIN users pu ON pu.id = p.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.id DESC LIMIT 200`, args,
    );
    return ok(res, rows.map((r) => ({
      ...r,
      holderKind: r.assignedTo != null ? 'user' : (r.personId != null ? 'person' : 'label'),
    })));
  } catch (e) { next(e); }
}

/**
 * Hands a device to a holder — an app account (assignedTo), a directory person
 * without an account (personId) or a team label (holderLabel), exactly one.
 * 409 only while the device has an ACTIVE assignment. Sets the device Aktif,
 * caches the holder, and notifies the holder when it is an app account.
 */
async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.user.entityId;
    const { departmentId, deviceId, expectedReturnDate, location, purpose } = req.body;
    const holder = lifecycle.holderFromBody(req.body);
    if (!holder) return fail(res, 'HOLDER_REQUIRED', 'Pilih pemegang: akun, orang di direktori, atau label tim', 400);

    await conn.beginTransaction();
    const [dRows] = await conn.query(
      `SELECT * FROM devices WHERE id=? AND entity_id=? AND deleted_at IS NULL FOR UPDATE`, [deviceId, entityId],
    );
    const dev = dRows[0];
    if (!dev) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'Device tidak ditemukan', 404); }

    const out = await lifecycle.openAssignment(conn, {
      entityId, device: dev, holder, actorId: req.user.sub,
      departmentId: departmentId || null, expectedReturnDate, location, purpose,
    });
    await logWith(conn, {
      entityId, userId: req.user.sub,
      action: 'device.assign', subjectType: 'device_assignment', subjectId: out.assignmentId,
      metadata: { deviceId, assignedTo: out.holder.userId || null, personId: out.holder.personId || null, holderLabel: out.holder.label || null },
    });
    await conn.commit();

    if (out.holder.userId) {
      await notif.create({
        userId: out.holder.userId, entityId,
        title: 'Device ditugaskan ke Anda',
        body: `${dev.asset_code || dev.serial_number || dev.model || ''} (${dev.device_type})`.trim(),
        event: 'device.assigned',
        subjectType: 'device_assignment', subjectId: out.assignmentId,
        actionUrl: `/it/devices/${deviceId}`,
      });
    }

    return ok(res, { id: out.assignmentId }, undefined, 201);
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (e instanceof lifecycle.DeviceError) return fail(res, e.code, e.message, e.status);
    next(e);
  } finally { conn.release(); }
}

/**
 * Return device. Otomatis:
 *  - set device.status kembali 'available' (Cadangan), atau 'damaged' (Rusak)
 *    kalau kondisinya kurang/rusak — rusak di tangan IT, belum di vendor
 *  - tutup assignment dan kosongkan pemegang di perangkat
 */
async function returnDevice(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params; // assignment id
    const { conditionOnReturn, notes } = req.body;

    await conn.beginTransaction();
    const out = await lifecycle.returnAssignment(conn, {
      entityId: req.user.entityId, assignmentId: id, conditionOnReturn, notes, actorId: req.user.sub,
    });
    if (!out) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'Assignment aktif tidak ditemukan', 404); }
    await conn.commit();
    const { newStatus } = out;

    return ok(res, { id: Number(id), newStatus });
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    next(e);
  } finally { conn.release(); }
}

module.exports = { list, create, returnDevice };
