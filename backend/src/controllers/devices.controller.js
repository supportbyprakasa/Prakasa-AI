const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = ['d.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('d.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.departmentId) { where.push('d.department_id = ?'); args.push(req.query.departmentId); }
    if (req.query.deviceType) { where.push('d.device_type = ?'); args.push(req.query.deviceType); }
    if (req.query.status) { where.push('d.status = ?'); args.push(req.query.status); }
    if (req.query.assigneeId) { where.push('d.current_assignee_id = ?'); args.push(req.query.assigneeId); }
    if (req.query.q) {
      where.push('(d.asset_code LIKE ? OR d.brand LIKE ? OR d.model LIKE ? OR d.serial_number LIKE ?)');
      args.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
    }

    const [rows] = await pool.query(
      `SELECT d.id, d.entity_id AS entityId, d.department_id AS departmentId,
              d.asset_code AS assetCode, d.device_type AS deviceType,
              d.brand, d.model, d.serial_number AS serialNumber,
              d.status, d.condition_state AS conditionState,
              d.current_assignee_id AS currentAssigneeId, u.name AS assigneeName,
              d.warranty_end AS warrantyEnd, d.current_location AS currentLocation,
              d.created_at AS createdAt
         FROM devices d
         LEFT JOIN users u ON u.id = d.current_assignee_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.id DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM devices d WHERE ${where.join(' AND ')}`, args
    );
    return ok(res, rows, { page, limit, total });
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT d.*, u.name AS assigneeName FROM devices d
         LEFT JOIN users u ON u.id = d.current_assignee_id
        WHERE d.id=? AND d.deleted_at IS NULL`, [id]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Device tidak ditemukan', 404);

    const [assignments] = await pool.query(
      `SELECT a.id, a.assigned_to AS assignedTo, u.name AS assignedToName,
              a.assigned_by AS assignedBy, a.assigned_at AS assignedAt,
              a.expected_return_date AS expectedReturnDate,
              a.actual_return_date AS actualReturnDate,
              a.status, a.location, a.purpose
         FROM device_assignments a
         LEFT JOIN users u ON u.id = a.assigned_to
        WHERE a.device_id=? ORDER BY a.id DESC LIMIT 20`, [id]
    );
    const [maintenance] = await pool.query(
      `SELECT id, maintenance_date AS maintenanceDate, maintenance_type AS maintenanceType,
              description, performed_by AS performedBy, cost, next_maintenance_date AS nextMaintenanceDate
         FROM device_maintenance_logs WHERE device_id=? ORDER BY id DESC LIMIT 20`, [id]
    );
    const [repairs] = await pool.query(
      `SELECT id, reported_date AS reportedDate, issue_description AS issueDescription,
              severity, vendor_name AS vendorName, status, cost,
              sent_date AS sentDate, returned_date AS returnedDate, resolution
         FROM device_repair_logs WHERE device_id=? ORDER BY id DESC LIMIT 20`, [id]
    );
    const [warranties] = await pool.query(
      `SELECT id, warranty_type AS warrantyType, start_date AS startDate,
              end_date AS endDate, provider, claim_number AS claimNumber, notes
         FROM device_warranty_logs WHERE device_id=? ORDER BY end_date DESC`, [id]
    );

    return ok(res, { ...rows[0], assignments, maintenance, repairs, warranties });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const {
      entityId, departmentId, assetCode, deviceType, brand, model,
      serialNumber, imei, macAddress, purchaseDate, purchasePrice,
      currency = 'IDR', supplier, invoiceDocumentId,
      warrantyStart, warrantyEnd, warrantyType = 'manufacturer',
      conditionState = 'good', currentLocation, notes,
    } = req.body;

    const [r] = await pool.query(
      `INSERT INTO devices
       (entity_id, department_id, asset_code, device_type, brand, model,
        serial_number, imei, mac_address, purchase_date, purchase_price,
        currency, supplier, invoice_document_id, warranty_start, warranty_end,
        warranty_type, status, condition_state, current_location, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'available', ?, ?, ?, ?)`,
      [entityId, departmentId || null, assetCode, deviceType,
       brand || null, model || null, serialNumber || null, imei || null,
       macAddress || null, purchaseDate || null, purchasePrice || null,
       currency, supplier || null, invoiceDocumentId || null,
       warrantyStart || null, warrantyEnd || null, warrantyType,
       conditionState, currentLocation || null, notes || null, req.user.sub]
    );

    // Buat warranty log kalau ada tanggal
    if (warrantyStart && warrantyEnd) {
      await pool.query(
        `INSERT INTO device_warranty_logs (device_id, warranty_type, start_date, end_date, provider)
         VALUES (?, ?, ?, ?, ?)`,
        [r.insertId, warrantyType, warrantyStart, warrantyEnd, supplier || null]
      );
    }

    await log({
      entityId, userId: req.user.sub,
      action: 'device.create', subjectType: 'device', subjectId: r.insertId,
      metadata: { assetCode, deviceType },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 'CONFLICT', 'Asset code sudah dipakai', 409);
    next(e);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const fields = ['brand', 'model', 'serialNumber', 'imei', 'macAddress',
      'purchaseDate', 'purchasePrice', 'currency', 'supplier', 'warrantyStart',
      'warrantyEnd', 'warrantyType', 'conditionState', 'currentLocation', 'notes'];
    const map = {
      brand: 'brand', model: 'model', serialNumber: 'serial_number',
      imei: 'imei', macAddress: 'mac_address', purchaseDate: 'purchase_date',
      purchasePrice: 'purchase_price', currency: 'currency', supplier: 'supplier',
      warrantyStart: 'warranty_start', warrantyEnd: 'warranty_end',
      warrantyType: 'warranty_type', conditionState: 'condition_state',
      currentLocation: 'current_location', notes: 'notes',
    };
    const updates = [];
    const args = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${map[f]}=?`);
        args.push(req.body[f]);
      }
    }
    if (!updates.length) return fail(res, 'VALIDATION_ERROR', 'Tidak ada field yang diubah', 400);
    args.push(id);
    const [r] = await pool.query(
      `UPDATE devices SET ${updates.join(', ')} WHERE id=? AND deleted_at IS NULL`, args
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Device tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'device.update', subjectType: 'device', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE devices SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Device tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'device.delete', subjectType: 'device', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function warrantyDue(req, res, next) {
  try {
    const days = Math.min(365, parseInt(req.query.days) || 60);
    const where = ['d.deleted_at IS NULL', 'd.warranty_end IS NOT NULL'];
    const args = [];
    if (req.query.entityId) { where.push('d.entity_id = ?'); args.push(req.query.entityId); }
    const [rows] = await pool.query(
      `SELECT d.id, d.entity_id AS entityId, d.asset_code AS assetCode,
              d.device_type AS deviceType, d.brand, d.model,
              d.serial_number AS serialNumber, d.warranty_end AS warrantyEnd,
              DATEDIFF(d.warranty_end, CURDATE()) AS daysLeft,
              d.current_assignee_id AS currentAssigneeId, u.name AS assigneeName
         FROM devices d LEFT JOIN users u ON u.id = d.current_assignee_id
        WHERE ${where.join(' AND ')}
          AND d.warranty_end <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
          AND d.warranty_end >= CURDATE()
        ORDER BY d.warranty_end ASC`, [...args, days]
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

module.exports = { list, detail, create, update, remove, warrantyDue };
