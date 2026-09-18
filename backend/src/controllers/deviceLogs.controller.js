const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function createMaintenance(req, res, next) {
  try {
    const { id } = req.params; // device id
    const {
      maintenanceDate, maintenanceType, description, performedBy,
      cost, nextMaintenanceDate, documentId,
    } = req.body;
    const [d] = await pool.query(`SELECT entity_id AS entityId FROM devices WHERE id=?`, [id]);
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
    const [d] = await pool.query(`SELECT entity_id AS entityId FROM devices WHERE id=?`, [id]);
    if (!d[0]) return fail(res, 'NOT_FOUND', 'Device tidak ditemukan', 404);

    const [r] = await pool.query(
      `INSERT INTO device_repair_logs
       (entity_id, device_id, reported_date, reported_by, issue_description,
        severity, vendor_name, sent_date, document_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d[0].entityId, id, reportedDate, req.user.sub, issueDescription,
       severity || 'medium', vendorName || null, sentDate || null, documentId || null]
    );
    await pool.query(`UPDATE devices SET status='repair' WHERE id=?`, [id]);

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
        WHERE id=?`,
      [status || null, returnedDate || null, cost ?? null, resolution || null, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Repair log tidak ditemukan', 404);
    if (status === 'completed' || status === 'unrepairable') {
      const [rl] = await pool.query(`SELECT device_id AS deviceId FROM device_repair_logs WHERE id=?`, [id]);
      const newStatus = status === 'completed' ? 'available' : 'retired';
      await pool.query(`UPDATE devices SET status=? WHERE id=?`, [newStatus, rl[0].deviceId]);
    }
    await log({
      entityId: null, userId: req.user.sub,
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
    const [d] = await pool.query(`SELECT entity_id AS entityId FROM devices WHERE id=?`, [id]);
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
        WHERE id=?`, [startDate, endDate, warrantyType, id]
    );
    await log({
      entityId: d[0].entityId, userId: req.user.sub,
      action: 'device.warranty.create', subjectType: 'device', subjectId: Number(id),
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

module.exports = { createMaintenance, createRepair, updateRepair, createWarranty };
