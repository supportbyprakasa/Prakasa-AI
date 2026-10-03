const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const lifecycle = require('../services/deviceLifecycle.service');
const {
  HOLDER_JOINS, HOLDER_NAME, HOLDER_KIND, HOLDER_RESIGNED,
} = require('../services/deviceHolderSql');
const {
  DEVICE_TYPE_LABELS, DEVICE_STATUS_LABELS, DEVICE_STATUSES, DEVICE_TYPES, PROBLEMATIC_STATUSES,
  REPORT_TYPE_LABELS, REPORT_STATUS_LABELS,
} = require('../config/itAssets');

// Every device belongs to the signed-in user's company (entity): the entity
// never comes from the request, and a device of another entity reads as not found.

const WIB_TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
const int = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Serial numbers are compared trimmed and uppercased (rule 16). */
const normalizeSerial = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim().toUpperCase();
  return s || null;
};
const trimOrNull = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || null;
};

/** The entity's People & Culture division — IT lives there (rule 17). */
async function peopleCultureDepartmentId(db, entityId) {
  const [[row]] = await db.query(
    "SELECT id FROM departments WHERE entity_id = ? AND code = 'people_culture' AND deleted_at IS NULL LIMIT 1",
    [entityId],
  );
  return row ? Number(row.id) : null;
}

async function checkLocation(db, entityId, locationId) {
  if (locationId === null || locationId === undefined) return true;
  const [[row]] = await db.query('SELECT id FROM org_locations WHERE id = ? AND entity_id = ? LIMIT 1', [locationId, entityId]);
  return Boolean(row);
}

const listOf = (value, allowed) => String(value || '')
  .split(',').map((v) => v.trim()).filter((v) => allowed.includes(v));

// Filters shared by the list, its status counts and the export. `withStatus`
// false leaves the status filter out (the chips count every status).
function deviceFilters(req, { withStatus = true } = {}) {
  const q = req.query || {};
  const where = ['d.entity_id = ?', 'd.deleted_at IS NULL'];
  const args = [req.user.entityId];
  if (q.departmentId) { where.push('d.department_id = ?'); args.push(Number(q.departmentId)); }
  const types = listOf(q.deviceType, DEVICE_TYPES);
  if (types.length) { where.push(`d.device_type IN (${types.map(() => '?').join(',')})`); args.push(...types); }
  if (withStatus) {
    const statuses = listOf(q.status, DEVICE_STATUSES);
    if (statuses.length) { where.push(`d.status IN (${statuses.map(() => '?').join(',')})`); args.push(...statuses); }
  }
  if (q.locationId === 'none') where.push('d.location_id IS NULL');
  else if (q.locationId) { where.push('d.location_id = ?'); args.push(Number(q.locationId)); }
  if (q.assigneeId) { where.push('d.current_assignee_id = ?'); args.push(Number(q.assigneeId)); }
  if (q.personId) { where.push('(d.holder_person_id = ? OR hp.id = ?)'); args.push(Number(q.personId), Number(q.personId)); }
  if (q.holderKind === 'user') where.push('d.current_assignee_id IS NOT NULL');
  if (q.holderKind === 'person') where.push('d.holder_person_id IS NOT NULL');
  if (q.holderKind === 'label') where.push('d.holder_label IS NOT NULL');
  if (q.holderKind === 'none') where.push('d.current_assignee_id IS NULL AND d.holder_person_id IS NULL AND d.holder_label IS NULL');
  if (q.problematic === '1' || q.problematic === 'true') where.push(`d.status IN (${PROBLEMATIC_STATUSES.map((s) => `'${s}'`).join(', ')})`);
  if (q.noAssetCode === '1' || q.noAssetCode === 'true') where.push("(d.asset_code IS NULL OR TRIM(d.asset_code) = '')");
  if (q.resignedHolder === '1' || q.resignedHolder === 'true') where.push(HOLDER_RESIGNED);
  if (q.warrantyDays) {
    const days = Math.min(365, Math.max(0, parseInt(q.warrantyDays, 10) || 0));
    where.push(`d.warranty_end BETWEEN ${WIB_TODAY} AND DATE_ADD(${WIB_TODAY}, INTERVAL ? DAY)`);
    args.push(days);
  }
  if (q.q) {
    const like = `%${String(q.q).trim()}%`;
    where.push(`(d.asset_code LIKE ? OR d.brand LIKE ? OR d.model LIKE ? OR d.serial_number LIKE ? OR ${HOLDER_NAME} LIKE ? OR d.notes LIKE ?)`);
    args.push(like, like, like, like, like, like);
  }
  return { sql: where.join(' AND '), args };
}

const DEVICE_COLUMNS = `
  d.id, d.entity_id, d.department_id, d.asset_code, d.device_type, d.brand, d.model, d.serial_number,
  d.ram_gb, d.storage_gb, d.os_version, d.purchase_year, d.purchase_date, d.status, d.status_changed_at,
  d.condition_state, d.current_assignee_id, d.holder_person_id, d.holder_label,
  d.location_id, loc.name AS location_name, d.current_location, d.warranty_end, d.notes, d.created_at,
  ${HOLDER_KIND} AS holder_kind, ${HOLDER_NAME} AS holder_name, hp.id AS holder_row_id,
  ${HOLDER_RESIGNED} AS holder_resigned,
  (SELECT MAX(aa.id) FROM device_assignments aa WHERE aa.device_id = d.id AND aa.status = 'active') AS active_assignment_id`;

const DEVICE_FROM = `FROM devices d
  LEFT JOIN org_locations loc ON loc.id = d.location_id
  ${HOLDER_JOINS}`;

const iso = (v) => (v ? new Date(v).toISOString() : null);
const isoDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

function shapeDevice(r) {
  return {
    id: Number(r.id),
    entityId: Number(r.entity_id),
    departmentId: int(r.department_id),
    assetCode: r.asset_code || null,
    deviceType: r.device_type,
    deviceTypeLabel: DEVICE_TYPE_LABELS[r.device_type] || r.device_type,
    brand: r.brand || null,
    model: r.model || null,
    serialNumber: r.serial_number || null,
    ramGb: int(r.ram_gb),
    storageGb: int(r.storage_gb),
    osVersion: r.os_version || null,
    purchaseYear: int(r.purchase_year),
    purchaseDate: isoDate(r.purchase_date),
    status: r.status,
    statusLabel: DEVICE_STATUS_LABELS[r.status] || r.status,
    statusChangedAt: iso(r.status_changed_at),
    conditionState: r.condition_state,
    holder: r.holder_kind ? {
      kind: r.holder_kind,
      userId: int(r.current_assignee_id),
      personId: int(r.holder_person_id),
      personKey: r.holder_row_id != null ? `p${r.holder_row_id}` : (r.current_assignee_id != null ? `u${r.current_assignee_id}` : null),
      label: r.holder_label || null,
      name: r.holder_name || null,
      resigned: Number(r.holder_resigned) === 1,
    } : null,
    // Kept for the existing pages: the app account holding the device.
    // The open assignment, so a list row can offer "Kembalikan" directly.
    activeAssignmentId: int(r.active_assignment_id),
    currentAssigneeId: int(r.current_assignee_id),
    assigneeName: r.holder_kind === 'user' ? r.holder_name : null,
    locationId: int(r.location_id),
    locationName: r.location_name || null,
    currentLocation: r.current_location || null,
    warrantyEnd: isoDate(r.warranty_end),
    notes: r.notes || null,
    createdAt: iso(r.created_at),
  };
}

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const f = deviceFilters(req);
    const [rows] = await pool.query(
      `SELECT ${DEVICE_COLUMNS} ${DEVICE_FROM} WHERE ${f.sql} ORDER BY d.id DESC LIMIT ? OFFSET ?`,
      [...f.args, limit, offset],
    );
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${DEVICE_FROM} WHERE ${f.sql}`, f.args);
    // Chip counts per status, under every other filter.
    const c = deviceFilters(req, { withStatus: false });
    const [countRows] = await pool.query(
      `SELECT d.status, COUNT(*) AS n ${DEVICE_FROM} WHERE ${c.sql} GROUP BY d.status`, c.args,
    );
    const statusCounts = Object.fromEntries(DEVICE_STATUSES.map((s) => [s, 0]));
    for (const row of countRows || []) if (row && row.status in statusCounts) statusCounts[row.status] = Number(row.n) || 0;
    return ok(res, rows.map(shapeDevice), { page, limit, total: Number(total) || 0, statusCounts });
  } catch (e) { next(e); }
}

// The report's column order (rule 19), so an export reads like — and imports
// back as — the owner's "Device Inventory"; the app's extra fields follow.
const EXPORT_COLUMNS = [
  'No', 'Device Type', 'Brand / Model', 'Serial Number', 'Asset No.', 'Purchase Year', 'User Name',
  'Location', 'Company', 'Status', 'Notes', 'RAM (GB)', 'SSD (GB)', 'OS', 'Garansi s.d.',
];

async function exportRows(req, res, next) {
  try {
    const f = deviceFilters(req);
    const [rows] = await pool.query(
      `SELECT ${DEVICE_COLUMNS} ${DEVICE_FROM} WHERE ${f.sql} ORDER BY d.device_type ASC, d.id ASC LIMIT 5000`,
      f.args,
    );
    const { entityReportCode } = require('../services/itAssetImport.service');
    const code = await entityReportCode(pool, req.user.entityId);
    const matrix = rows.map((r, i) => {
      const d = shapeDevice(r);
      return [
        i + 1,
        REPORT_TYPE_LABELS[d.deviceType] || d.deviceType,
        [d.brand, d.model].filter(Boolean).join(' ') || null,
        d.serialNumber,
        d.assetCode,
        d.purchaseYear,
        d.holder?.name || null,
        d.locationName,
        code,
        REPORT_STATUS_LABELS[d.status] || d.status,
        d.notes,
        d.ramGb,
        d.storageGb,
        d.osVersion,
        d.warrantyEnd,
      ];
    });
    return ok(res, { sheetName: 'Device Inventory', columns: EXPORT_COLUMNS, rows: matrix }, { total: matrix.length });
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT ${DEVICE_COLUMNS}, d.imei, d.mac_address, d.purchase_price, d.currency, d.supplier,
              d.invoice_document_id, d.warranty_start, d.warranty_type, d.created_by, d.updated_at
         ${DEVICE_FROM}
        WHERE d.id = ? AND d.entity_id = ? AND d.deleted_at IS NULL`, [id, req.user.entityId],
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Device tidak ditemukan', 404);
    const r = rows[0];
    const device = {
      ...shapeDevice(r),
      imei: r.imei || null,
      macAddress: r.mac_address || null,
      purchasePrice: r.purchase_price != null ? Number(r.purchase_price) : null,
      currency: r.currency || null,
      supplier: r.supplier || null,
      invoiceDocumentId: int(r.invoice_document_id),
      warrantyStart: isoDate(r.warranty_start),
      warrantyType: r.warranty_type || null,
      updatedAt: iso(r.updated_at),
    };

    const [assignments] = await pool.query(
      `SELECT a.id, a.assigned_to AS assignedTo, a.person_id AS personId, a.holder_label AS holderLabel,
              COALESCE(u.name, pu.name, p.full_name, a.holder_label) AS holderName,
              u.name AS assignedToName,
              a.assigned_by AS assignedBy, a.assigned_at AS assignedAt,
              a.expected_return_date AS expectedReturnDate,
              a.actual_return_date AS actualReturnDate,
              a.status, a.location, a.purpose
         FROM device_assignments a
         LEFT JOIN users u ON u.id = a.assigned_to
         LEFT JOIN people_directory p ON p.id = a.person_id AND p.entity_id = a.entity_id
         LEFT JOIN users pu ON pu.id = p.user_id
        WHERE a.device_id=? AND a.entity_id=? ORDER BY a.id DESC LIMIT 20`, [id, req.user.entityId],
    );
    const [maintenance] = await pool.query(
      `SELECT id, maintenance_date AS maintenanceDate, maintenance_type AS maintenanceType,
              description, performed_by AS performedBy, cost, next_maintenance_date AS nextMaintenanceDate
         FROM device_maintenance_logs WHERE device_id=? ORDER BY id DESC LIMIT 20`, [id],
    );
    const [repairs] = await pool.query(
      `SELECT id, reported_date AS reportedDate, issue_description AS issueDescription,
              severity, vendor_name AS vendorName, status, cost,
              sent_date AS sentDate, returned_date AS returnedDate, resolution
         FROM device_repair_logs WHERE device_id=? ORDER BY id DESC LIMIT 20`, [id],
    );
    const [warranties] = await pool.query(
      `SELECT id, warranty_type AS warrantyType, start_date AS startDate,
              end_date AS endDate, provider, claim_number AS claimNumber, notes
         FROM device_warranty_logs WHERE device_id=? ORDER BY end_date DESC`, [id],
    );

    return ok(res, {
      ...device,
      assignments: (assignments || []).map((a) => ({
        ...a,
        holderKind: a.assignedTo != null ? 'user' : (a.personId != null ? 'person' : 'label'),
      })),
      maintenance,
      repairs,
      warranties,
    });
  } catch (e) { next(e); }
}

// Asset numbers may repeat (rule 16): the answer says so instead of refusing.
async function assetCodeWarnings(entityId, assetCode) {
  const code = trimOrNull(assetCode);
  if (!code) return [];
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS n FROM devices WHERE entity_id = ? AND asset_code = ? AND deleted_at IS NULL',
    [entityId, code],
  );
  const n = Number(row?.n || 0);
  return n > 1 ? [{ code: 'ASSET_CODE_SHARED', message: `Nomor aset ${code} dipakai ${n} perangkat` }] : [];
}

function serialTaken(res) {
  return fail(res, 'SERIAL_TAKEN', 'Nomor seri sudah dipakai perangkat lain di perusahaan ini', 409);
}

async function create(req, res, next) {
  try {
    const entityId = req.user.entityId;
    const {
      departmentId, assetCode, deviceType, brand, model,
      serialNumber, imei, macAddress, purchaseDate, purchasePrice,
      currency = 'IDR', supplier, invoiceDocumentId,
      warrantyStart, warrantyEnd, warrantyType = 'manufacturer',
      conditionState = 'good', currentLocation, notes,
      ramGb, storageGb, osVersion, purchaseYear, locationId,
    } = req.body;

    if (!(await checkLocation(pool, entityId, locationId))) {
      return fail(res, 'LOCATION_INVALID', 'Lokasi tidak ditemukan di perusahaan ini', 400);
    }
    // A new device belongs to the entity's People & Culture division unless told otherwise (rule 17).
    const department = departmentId || await peopleCultureDepartmentId(pool, entityId);

    const [r] = await pool.query(
      `INSERT INTO devices
       (entity_id, department_id, asset_code, device_type, brand, model,
        serial_number, ram_gb, storage_gb, os_version, imei, mac_address, purchase_date, purchase_year, purchase_price,
        currency, supplier, invoice_document_id, warranty_start, warranty_end,
        warranty_type, status, status_changed_at, condition_state, current_location, location_id, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'available', CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)`,
      [entityId, department || null, trimOrNull(assetCode), deviceType,
        trimOrNull(brand), trimOrNull(model), normalizeSerial(serialNumber),
        ramGb ?? null, storageGb ?? null, trimOrNull(osVersion),
        imei || null, macAddress || null, purchaseDate || null, purchaseYear ?? null, purchasePrice || null,
        currency, supplier || null, invoiceDocumentId || null,
        warrantyStart || null, warrantyEnd || null, warrantyType,
        conditionState, currentLocation || null, locationId ?? null, notes || null, req.user.sub],
    );

    // Buat warranty log kalau ada tanggal
    if (warrantyStart && warrantyEnd) {
      await pool.query(
        `INSERT INTO device_warranty_logs (device_id, warranty_type, start_date, end_date, provider)
         VALUES (?, ?, ?, ?, ?)`,
        [r.insertId, warrantyType, warrantyStart, warrantyEnd, supplier || null],
      );
    }

    await log({
      entityId, userId: req.user.sub,
      action: 'device.create', subjectType: 'device', subjectId: r.insertId,
      metadata: { assetCode: trimOrNull(assetCode), deviceType, serialNumber: normalizeSerial(serialNumber) },
    });
    return ok(res, { id: r.insertId, warnings: await assetCodeWarnings(entityId, assetCode) }, undefined, 201);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return serialTaken(res);
    next(e);
  }
}

// Field → column; status is not here: it changes only through PATCH /devices/:id/status.
const UPDATE_MAP = {
  assetCode: 'asset_code', deviceType: 'device_type',
  brand: 'brand', model: 'model', serialNumber: 'serial_number',
  ramGb: 'ram_gb', storageGb: 'storage_gb', osVersion: 'os_version', purchaseYear: 'purchase_year',
  locationId: 'location_id',
  imei: 'imei', macAddress: 'mac_address', purchaseDate: 'purchase_date',
  purchasePrice: 'purchase_price', currency: 'currency', supplier: 'supplier',
  warrantyStart: 'warranty_start', warrantyEnd: 'warranty_end',
  warrantyType: 'warranty_type', conditionState: 'condition_state',
  currentLocation: 'current_location', notes: 'notes',
};

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const updates = [];
    const args = [];
    for (const [field, column] of Object.entries(UPDATE_MAP)) {
      if (req.body[field] === undefined) continue;
      let value = req.body[field];
      if (field === 'serialNumber') value = normalizeSerial(value);
      else if (['assetCode', 'brand', 'model', 'osVersion'].includes(field)) value = trimOrNull(value);
      updates.push(`${column}=?`);
      args.push(value);
    }
    if (!updates.length) return fail(res, 'VALIDATION_ERROR', 'Tidak ada field yang diubah', 400);
    if (req.body.locationId !== undefined && !(await checkLocation(pool, req.user.entityId, req.body.locationId))) {
      return fail(res, 'LOCATION_INVALID', 'Lokasi tidak ditemukan di perusahaan ini', 400);
    }
    args.push(id, req.user.entityId);
    const [r] = await pool.query(
      `UPDATE devices SET ${updates.join(', ')} WHERE id=? AND entity_id=? AND deleted_at IS NULL`, args,
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Device tidak ditemukan', 404);
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'device.update', subjectType: 'device', subjectId: Number(id),
      metadata: { fields: Object.keys(UPDATE_MAP).filter((f) => req.body[f] !== undefined) },
    });
    const warnings = req.body.assetCode !== undefined ? await assetCodeWarnings(req.user.entityId, req.body.assetCode) : [];
    return ok(res, { id: Number(id), warnings });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return serialTaken(res);
    next(e);
  }
}

/** PATCH /it/devices/:id/status — IT sets Aktif/Cadangan/Rusak/Tidak aktif/… (rule 14). */
async function setStatus(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.user.entityId;
    const holder = lifecycle.holderFromBody(req.body);
    await conn.beginTransaction();
    const [[device]] = await conn.query(
      'SELECT id, entity_id, status, asset_code, device_type FROM devices WHERE id = ? AND entity_id = ? AND deleted_at IS NULL FOR UPDATE',
      [req.params.id, entityId],
    );
    if (!device) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'Device tidak ditemukan', 404); }
    const out = await lifecycle.changeStatus(conn, {
      entityId, device, status: req.body.status, holder, actorId: req.user.sub, note: req.body.note || null,
    });
    await conn.commit();
    return ok(res, { ...out, statusLabel: DEVICE_STATUS_LABELS[out.status] });
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (e instanceof lifecycle.DeviceError) return fail(res, e.code, e.message, e.status);
    next(e);
  } finally { conn.release(); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE devices SET deleted_at=NOW() WHERE id=? AND entity_id=? AND deleted_at IS NULL`, [id, req.user.entityId],
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Device tidak ditemukan', 404);
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'device.delete', subjectType: 'device', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function warrantyDue(req, res, next) {
  try {
    const days = Math.min(365, parseInt(req.query.days, 10) || 60);
    const where = ['d.entity_id = ?', 'd.deleted_at IS NULL', 'd.warranty_end IS NOT NULL'];
    const args = [req.user.entityId];
    const [rows] = await pool.query(
      `SELECT d.id, d.entity_id AS entityId, d.asset_code AS assetCode,
              d.device_type AS deviceType, d.brand, d.model,
              d.serial_number AS serialNumber, d.warranty_end AS warrantyEnd,
              DATEDIFF(d.warranty_end, ${WIB_TODAY}) AS daysLeft,
              d.current_assignee_id AS currentAssigneeId, ${HOLDER_NAME} AS assigneeName
         FROM devices d ${HOLDER_JOINS}
        WHERE ${where.join(' AND ')}
          AND d.warranty_end <= DATE_ADD(${WIB_TODAY}, INTERVAL ? DAY)
          AND d.warranty_end >= ${WIB_TODAY}
        ORDER BY d.warranty_end ASC`, [...args, days],
    );
    return ok(res, rows.map((r) => ({ ...r, daysLeft: r.daysLeft != null ? Number(r.daysLeft) : null })));
  } catch (e) { next(e); }
}

module.exports = {
  list, exportRows, detail, create, update, setStatus, remove, warrantyDue,
  normalizeSerial, peopleCultureDepartmentId, shapeDevice, EXPORT_COLUMNS,
};
