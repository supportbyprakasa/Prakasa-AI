const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const lifecycle = require('../services/deviceLifecycle.service');

async function inTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await fn(conn);
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw e;
  } finally { conn.release(); }
}

async function createMaintenance(req, res, next) {
  try {
    const { id } = req.params; // device id
    const {
      maintenanceDate, maintenanceType, description, performedBy,
      cost, nextMaintenanceDate, documentId,
    } = req.body;
    const [d] = await pool.query(`SELECT entity_id AS entityId FROM devices WHERE id=? AND entity_id=? AND deleted_at IS NULL`, [id, req.user.entityId]);
    if (!d[0]) return fail(res, 'NOT_FOUND', 'Device tidak ditemukan', 404);

    const [r] = await pool.query(
      `INSERT INTO device_maintenance_logs
       (entity_id, device_id, maintenance_date, maintenance_type, description,
        performed_by, cost, next_maintenance_date, document_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d[0].entityId, id, maintenanceDate, maintenanceType, description || null,
       performedBy || null, cost || null, nextMaintenanceDate || null,
       documentId || null, req.user.sub]
    );
    await log({
      entityId: d[0].entityId, userId: req.user.sub,
      action: 'device.maintenance.create', subjectType: 'device', subjectId: Number(id),
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

async function createRepair(req, res, next) {
  try {
    const { id } = req.params;
    const {
      reportedDate, issueDescription, severity, vendorName,
      sentDate, documentId,
    } = req.body;
    const [d] = await pool.query(`SELECT entity_id AS entityId FROM devices WHERE id=? AND entity_id=? AND deleted_at IS NULL`, [id, req.user.entityId]);
    if (!d[0]) return fail(res, 'NOT_FOUND', 'Device tidak ditemukan', 404);

    const [r] = await pool.query(
      `INSERT INTO device_repair_logs
       (entity_id, device_id, reported_date, reported_by, issue_description,
        severity, vendor_name, sent_date, document_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d[0].entityId, id, reportedDate, req.user.sub, issueDescription,
       severity || 'medium', vendorName || null, sentDate || null, documentId || null]
    );
    // Filing a repair sends the device to the vendor (Perbaikan); if it was
    // Aktif, the holder's assignment closes (rule 14: one status code path).
    await inTransaction(async (conn) => {
      const [[dev]] = await conn.query(
        'SELECT id, status FROM devices WHERE id=? AND entity_id=? AND deleted_at IS NULL FOR UPDATE', [id, req.user.entityId]
      );
      await lifecycle.moveStatus(conn, req.user.entityId, dev, 'repair', { notes: 'Dikirim perbaikan' });
    });

    await log({
      entityId: d[0].entityId, userId: req.user.sub,
      action: 'device.repair.create', subjectType: 'device', subjectId: Number(id),
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

async function updateRepair(req, res, next) {
  try {
    const { id } = req.params; // repair id
    const { status, returnedDate, cost, resolution } = req.body;
    const [r] = await pool.query(
      `UPDATE device_repair_logs
          SET status=COALESCE(?, status),
              returned_date=COALESCE(?, returned_date),
              cost=COALESCE(?, cost),
              resolution=COALESCE(?, resolution)
        WHERE id=? AND entity_id=?`,
      [status || null, returnedDate || null, cost ?? null, resolution || null, id, req.user.entityId]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Repair log tidak ditemukan', 404);
    if (status === 'completed' || status === 'unrepairable') {
      const newStatus = status === 'completed' ? 'available' : 'retired';
      await inTransaction(async (conn) => {
        const [[dev]] = await conn.query(
          `SELECT d.id, d.status FROM devices d
             JOIN device_repair_logs rl ON rl.device_id = d.id AND rl.entity_id = d.entity_id
            WHERE rl.id=? AND d.entity_id=? AND d.deleted_at IS NULL FOR UPDATE`, [id, req.user.entityId]
        );
        await lifecycle.moveStatus(conn, req.user.entityId, dev, newStatus);
      });
    }
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'device.repair.update', subjectType: 'device_repair_log', subjectId: Number(id),
      metadata: { status },
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function createWarranty(req, res, next) {
  try {
    const { id } = req.params;
    const { warrantyType, startDate, endDate, provider, claimNumber, notes } = req.body;
    const [d] = await pool.query(`SELECT entity_id AS entityId FROM devices WHERE id=? AND entity_id=? AND deleted_at IS NULL`, [id, req.user.entityId]);
    if (!d[0]) return fail(res, 'NOT_FOUND', 'Device tidak ditemukan', 404);

    const [r] = await pool.query(
      `INSERT INTO device_warranty_logs
       (device_id, warranty_type, start_date, end_date, provider, claim_number, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, warrantyType, startDate, endDate, provider || null, claimNumber || null, notes || null]
    );
    // update cache di tabel devices
    await pool.query(
      `UPDATE devices SET warranty_start=?, warranty_end=?, warranty_type=?
        WHERE id=? AND entity_id=?`, [startDate, endDate, warrantyType, id, req.user.entityId]
    );
    await log({
      entityId: d[0].entityId, userId: req.user.sub,
      action: 'device.warranty.create', subjectType: 'device', subjectId: Number(id),
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

module.exports = { createMaintenance, createRepair, updateRepair, createWarranty };
