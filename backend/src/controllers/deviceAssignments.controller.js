const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const notif = require('../services/notification.service');

async function list(req, res, next) {
  try {
    const where = ['1=1'];
    const args = [];
    if (req.query.deviceId) { where.push('a.device_id = ?'); args.push(req.query.deviceId); }
    if (req.query.assignedTo) { where.push('a.assigned_to = ?'); args.push(req.query.assignedTo); }
    if (req.query.status) { where.push('a.status = ?'); args.push(req.query.status); }

    const [rows] = await pool.query(
      `SELECT a.id, a.entity_id AS entityId, a.department_id AS departmentId,
              a.device_id AS deviceId, d.asset_code AS assetCode,
              d.device_type AS deviceType, d.brand, d.model,
              a.assigned_to AS assignedTo, u.name AS assignedToName,
              a.assigned_by AS assignedBy, a.assigned_at AS assignedAt,
              a.expected_return_date AS expectedReturnDate,
              a.actual_return_date AS actualReturnDate,
              a.status, a.location, a.purpose
         FROM device_assignments a
         JOIN devices d ON d.id = a.device_id
         LEFT JOIN users u ON u.id = a.assigned_to
        WHERE ${where.join(' AND ')}
        ORDER BY a.id DESC LIMIT 200`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

/**
 * Assign device ke user. Otomatis:
 *  - set device.status = 'assigned', current_assignee_id
 *  - buat row device_assignments
 *  - notifikasi ke assignee
 */
async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const {
      entityId, departmentId, deviceId, assignedTo,
      expectedReturnDate, location, purpose,
    } = req.body;

    await conn.beginTransaction();
    const [dRows] = await conn.query(
      `SELECT * FROM devices WHERE id=? AND deleted_at IS NULL FOR UPDATE`, [deviceId]
    );
    const dev = dRows[0];
    if (!dev) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'Device tidak ditemukan', 404); }
    if (dev.status === 'assigned' || dev.current_assignee_id) {
      await conn.rollback();
      return fail(res, 'CONFLICT', 'Device sedang dipegang user lain', 409);
    }

    const [a] = await conn.query(
      `INSERT INTO device_assignments
       (entity_id, department_id, device_id, assigned_to, assigned_by,
        expected_return_date, location, purpose, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [entityId, departmentId || null, deviceId, assignedTo, req.user.sub,
       expectedReturnDate || null, location || null, purpose || null]
    );
    await conn.query(
      `UPDATE devices SET status='assigned', current_assignee_id=?, current_location=?
        WHERE id=?`, [assignedTo, location || null, deviceId]
    );
    await conn.commit();

    await log({
      entityId, userId: req.user.sub,
      action: 'device.assign', subjectType: 'device_assignment', subjectId: a.insertId,
      metadata: { deviceId, assignedTo },
    });

    await notif.create({
      userId: assignedTo, entityId,
      title: 'Device ditugaskan ke Anda',
      body: `${dev.asset_code} (${dev.device_type})`,
      event: 'device.assigned',
      subjectType: 'device_assignment', subjectId: a.insertId,
      actionUrl: `/it/devices/${deviceId}`,
    });

    return ok(res, { id: a.insertId }, undefined, 201);
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

/**
 * Return device. Otomatis:
 *  - set device.status kembali 'available' (atau 'repair'/'maintenance' kalau kondisi jelek)
 *  - update assignment
 */
async function returnDevice(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params; // assignment id
    const { conditionOnReturn, notes } = req.body;

    await conn.beginTransaction();
    const [aRows] = await conn.query(
      `SELECT * FROM device_assignments WHERE id=? AND status='active' FOR UPDATE`, [id]
    );
    const a = aRows[0];
    if (!a) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'Assignment aktif tidak ditemukan', 404); }

    await conn.query(
      `UPDATE device_assignments
          SET status='returned', actual_return_date=CURDATE(), notes=?
        WHERE id=?`, [notes || null, id]
    );

    // kondisi menentukan status device
    let newStatus = 'available';
    if (['poor', 'broken'].includes(conditionOnReturn)) newStatus = 'repair';
    await conn.query(
      `UPDATE devices
          SET status=?, condition_state=COALESCE(?, condition_state),
              current_assignee_id=NULL, current_location=NULL
        WHERE id=?`, [newStatus, conditionOnReturn || null, a.device_id]
    );
    await conn.commit();

    await log({
      entityId: a.entity_id, userId: req.user.sub,
      action: 'device.return', subjectType: 'device_assignment', subjectId: Number(id),
      metadata: { deviceId: a.device_id, conditionOnReturn, newStatus },
    });

    return ok(res, { id: Number(id), newStatus });
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

module.exports = { list, create, returnDevice };
