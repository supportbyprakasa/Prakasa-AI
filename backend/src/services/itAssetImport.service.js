const pool = require('../db/pool');
const { logWith } = require('./activityLog.service');
const directory = require('./peopleDirectory.service');
const lifecycle = require('./deviceLifecycle.service');
const { HOLDER_JOINS, HOLDER_NAME } = require('./deviceHolderSql');
const { ImportError, buildPlan, nameKey } = require('./itAssetImportModel');

// Import of the owner's device report (People & Culture wave 1, rule 18):
// preview reads, apply writes — in ONE transaction on the caller's connection:
// locations the user allowed, then the file's people, then the devices, whose
// holders resolve against those people. Apply recomputes the plan and refuses
// when it differs from the preview the user confirmed (fingerprint), when the
// company code is not this entity's, or when a "perbarui" tick names a row
// that has nothing to update. Existing devices and people change only for rows
// ticked "perbarui", each logged with its differences.

const WIB_TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';

/**
 * The entity's code in the group report: IT_REPORT_ENTITY_CODE when set, else
 * the initials of the entity name (Prakasa Foods Nusantara → PFN).
 */
async function entityReportCode(db, entityId, env = process.env) {
  const override = String(env.IT_REPORT_ENTITY_CODE || '').trim().toUpperCase();
  if (override) return override;
  const [[row]] = await db.query('SELECT name FROM entities WHERE id = ? LIMIT 1', [entityId]);
  return initials(row?.name);
}

function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

async function loadContext(db, entityId) {
  const [users] = await db.query(
    `SELECT id, name, email, status, department_id, (deleted_at IS NOT NULL) AS deleted
       FROM users WHERE entity_id = ?`,
    [entityId],
  );
  const [people] = await db.query(
    `SELECT p.id, p.user_id, p.full_name, p.work_email, p.position, p.status, p.kind, p.resigned_on_source,
            COALESCE(u.department_id, p.department_id) AS department_id
       FROM people_directory p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.entity_id = ?`,
    [entityId],
  );
  const [locations] = await db.query('SELECT id, name, is_active FROM org_locations WHERE entity_id = ?', [entityId]);
  const [devices] = await db.query(
    `SELECT d.id, d.serial_key, d.device_type, d.model, d.asset_code, d.purchase_year, d.location_id,
            loc.name AS location_name, d.status, d.notes, ${HOLDER_NAME} AS holder_name
       FROM devices d
       LEFT JOIN org_locations loc ON loc.id = d.location_id
       ${HOLDER_JOINS}
      WHERE d.entity_id = ? AND d.deleted_at IS NULL`,
    [entityId],
  );
  return {
    users: users.map((u) => ({ ...u, deleted: Number(u.deleted) === 1 })),
    people,
    locations,
    devices,
  };
}

async function preview(entityId, payload, { db = pool, env = process.env } = {}) {
  const entityCode = await entityReportCode(db, entityId, env);
  if (!entityCode) throw new ImportError('ENTITY_CODE_UNKNOWN', 'Kode perusahaan untuk laporan tidak bisa ditentukan', 500);
  const context = await loadContext(db, entityId);
  return buildPlan(payload, context, { entityCode, currentYear: wibYear(), env });
}

const wibYear = () => new Date(Date.now() + 7 * 3600 * 1000).getUTCFullYear();

function guessLocationKind(name) {
  if (/toko|store|outlet/i.test(name)) return 'store';
  if (/gudang|warehouse/i.test(name)) return 'warehouse';
  if (/office|kantor/i.test(name)) return 'office';
  return 'other';
}

/**
 * Applies a confirmed preview. Must run inside the caller's transaction on
 * `conn`; the caller commits (or, for the real-data gate, rolls back).
 */
async function apply(conn, { entityId, actorId, payload, env = process.env }) {
  const entityCode = await entityReportCode(conn, entityId, env);
  if (!entityCode || String(payload.companyCode || '').trim().toUpperCase() !== entityCode) {
    throw new ImportError('COMPANY_CODE_MISMATCH', `Impor hanya untuk baris perusahaan ${entityCode || '-'} (perusahaan akun Anda).`, 422);
  }

  // Lock what the plan reads, so nothing changes between plan and write.
  await directory.lockDirectory(conn, entityId);
  await conn.query('SELECT id FROM org_locations WHERE entity_id = ? FOR UPDATE', [entityId]);
  await conn.query('SELECT id FROM devices WHERE entity_id = ? FOR UPDATE', [entityId]);

  const context = await loadContext(conn, entityId);
  const plan = buildPlan(payload, context, { entityCode, currentYear: wibYear(), env });
  if (!payload.fingerprint || payload.fingerprint !== plan.fingerprint) {
    throw new ImportError('IMPORT_STALE', 'Data berubah sejak pratinjau (atau pilihan berbeda). Muat ulang pratinjau lalu konfirmasi lagi.', 409);
  }

  const updates = new Set(payload.updates || []);
  const updatable = new Set([...plan.people, ...plan.devices]
    .filter((r) => r.action === 'exists' && r.differences.length).map((r) => r.key));
  const invalid = [...updates].filter((k) => !updatable.has(k));
  if (invalid.length) {
    throw new ImportError('UPDATE_KEY_INVALID', `Baris berikut tidak punya perbedaan untuk diperbarui: ${invalid.slice(0, 10).join(', ')}`, 400);
  }

  const result = {
    locationsCreated: 0, peopleCreated: 0, peopleLinked: 0, peopleUpdated: 0,
    devicesCreated: 0, devicesUpdated: 0, assignmentsCreated: 0, unchanged: 0, skipped: 0,
  };

  // 1. Locations the user allowed.
  const locationIds = new Map();
  if (plan.createLocations) {
    for (const name of plan.newLocations) {
      const [ins] = await conn.query(
        `INSERT INTO org_locations (entity_id, name, kind, is_active, created_by, updated_by) VALUES (?, ?, ?, 1, ?, ?)`,
        [entityId, name, guessLocationKind(name), actorId || null, actorId || null],
      );
      locationIds.set(nameKey(name), Number(ins.insertId));
      result.locationsCreated += 1;
      await logWith(conn, {
        entityId, userId: actorId || null, action: 'org_location.create', subjectType: 'org_location',
        subjectId: Number(ins.insertId), metadata: { name, source: 'import' },
      });
    }
  }

  // 2. People of the file, before the devices that name them.
  const personIds = new Map();
  for (const p of plan.people) {
    if (p.action === 'skip') { result.skipped += 1; continue; }
    const resigned = p.status === 'resigned';
    if (p.action === 'new') {
      const [ins] = await conn.query(
        `INSERT INTO people_directory
           (entity_id, full_name, work_email, position, status, resigned_on, resigned_on_source, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ${resigned ? WIB_TODAY : 'NULL'}, ?, ?, ?)`,
        [entityId, p.fullName, p.workEmail, p.position, p.status, resigned ? 'import' : null, actorId || null, actorId || null],
      );
      personIds.set(p.key, Number(ins.insertId));
      result.peopleCreated += 1;
      await logWith(conn, {
        entityId, userId: actorId || null, action: 'people_directory.import_create', subjectType: 'people_directory',
        subjectId: Number(ins.insertId), metadata: { row: p.rowNumber, status: p.status, position: p.position },
      });
    } else if (p.action === 'link') {
      const person = await directory.ensurePersonForUser(conn, entityId, p.target.userId, actorId, { create: true });
      await conn.query(
        `UPDATE people_directory
            SET position = COALESCE(?, position),
                resigned_on = IF(? AND status = 'active', ${WIB_TODAY}, resigned_on),
                resigned_on_source = IF(? AND status = 'active', 'import', resigned_on_source),
                status = IF(? AND status = 'active', 'resigned', status),
                updated_by = ?
          WHERE id = ? AND entity_id = ?`,
        [p.position, resigned, resigned, resigned, actorId || null, person.id, entityId],
      );
      personIds.set(p.key, person.id);
      result.peopleLinked += 1;
      await logWith(conn, {
        entityId, userId: actorId || null, action: 'people_directory.import_link', subjectType: 'people_directory',
        subjectId: person.id, metadata: { row: p.rowNumber, userId: p.target.userId, by: p.match?.by, status: p.status },
      });
    } else if (p.action === 'exists') {
      personIds.set(p.key, p.target.personId);
      if (!updates.has(p.key)) { result.unchanged += 1; continue; }
      const sets = [];
      const args = [];
      for (const d of p.differences) {
        if (d.field === 'position') { sets.push('position = ?'); args.push(p.position); }
        if (d.field === 'status' && p.status === 'resigned') {
          sets.push(`status = 'resigned'`, `resigned_on = ${WIB_TODAY}`, `resigned_on_source = 'import'`);
        }
        if (d.field === 'status' && p.status === 'active') {
          sets.push(`status = 'active'`, 'resigned_on = NULL', 'resigned_on_source = NULL');
        }
      }
      await conn.query(
        `UPDATE people_directory SET ${sets.join(', ')}, updated_by = ? WHERE id = ? AND entity_id = ?`,
        [...args, actorId || null, p.target.personId, entityId],
      );
      result.peopleUpdated += 1;
      await logWith(conn, {
        entityId, userId: actorId || null, action: 'people_directory.import_update', subjectType: 'people_directory',
        subjectId: p.target.personId, metadata: { row: p.rowNumber, differences: p.differences },
      });
    }
  }

  // 3. Devices.
  const { peopleCultureDepartmentId } = require('../controllers/devices.controller');
  const departmentId = await peopleCultureDepartmentId(conn, entityId);
  const userDept = new Map(context.users.map((u) => [Number(u.id), u.department_id != null ? Number(u.department_id) : null]));
  const personDept = new Map(context.people.map((pr) => [Number(pr.id), pr.department_id != null ? Number(pr.department_id) : null]));
  const holderOf = (h) => {
    if (!h) return null;
    if (h.kind === 'user') return { userId: h.userId, name: h.name, departmentId: userDept.get(h.userId) ?? null };
    if (h.kind === 'person') return { personId: h.personId, name: h.name, departmentId: personDept.get(h.personId) ?? null };
    if (h.kind === 'new_person') return { personId: personIds.get(h.newPersonKey), name: h.name, departmentId: null };
    return { label: h.label, name: h.label, departmentId: null };
  };
  const locationOf = (d) => d.locationId || (d.locationNew ? locationIds.get(nameKey(d.locationText)) || null : null);

  for (const d of plan.devices) {
    if (d.action === 'skip') { result.skipped += 1; continue; }
    if (d.action === 'new') {
      const initial = d.status === 'assigned' ? 'available' : d.status;
      const [ins] = await conn.query(
        `INSERT INTO devices
           (entity_id, department_id, asset_code, device_type, brand, model, serial_number, purchase_year,
            location_id, status, status_changed_at, notes, created_by)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
        [entityId, departmentId, d.assetCode, d.deviceType, d.model, d.serialNumber, d.purchaseYear,
          locationOf(d), initial, d.notes, actorId || null],
      );
      const deviceId = Number(ins.insertId);
      result.devicesCreated += 1;
      if (d.status === 'assigned' && d.holder) {
        await lifecycle.openAssignment(conn, {
          entityId, device: { id: deviceId, status: initial }, holder: holderOf(d.holder), actorId,
          purpose: 'Impor laporan perangkat',
        });
        result.assignmentsCreated += 1;
      }
      await logWith(conn, {
        entityId, userId: actorId || null, action: 'device.import_create', subjectType: 'device', subjectId: deviceId,
        metadata: { row: d.rowNumber, serialNumber: d.serialNumber, assetCode: d.assetCode, status: d.status, holder: d.holder ? d.holder.kind : null },
      });
      continue;
    }
    // exists
    if (!updates.has(d.key)) { result.unchanged += 1; continue; }
    const fields = new Set(d.differences.map((x) => x.field));
    const sets = [];
    const args = [];
    if (fields.has('deviceType')) { sets.push('device_type = ?'); args.push(d.deviceType); }
    if (fields.has('model')) { sets.push('model = ?'); args.push(d.model); }
    if (fields.has('assetCode')) { sets.push('asset_code = ?'); args.push(d.assetCode); }
    if (fields.has('purchaseYear')) { sets.push('purchase_year = ?'); args.push(d.purchaseYear); }
    if (fields.has('location')) { sets.push('location_id = ?'); args.push(locationOf(d)); }
    if (fields.has('notes')) { sets.push('notes = ?'); args.push(d.notes); }
    if (sets.length) {
      await conn.query(`UPDATE devices SET ${sets.join(', ')} WHERE id = ? AND entity_id = ?`, [...args, d.existingDeviceId, entityId]);
    }
    if (fields.has('status') || fields.has('holder')) {
      const [[cur]] = await conn.query(
        'SELECT id, status FROM devices WHERE id = ? AND entity_id = ? FOR UPDATE', [d.existingDeviceId, entityId],
      );
      let current = cur;
      if (current.status === 'assigned') {
        await lifecycle.moveStatus(conn, entityId, current, 'available', { notes: 'Diperbarui dari impor laporan' });
        current = { ...current, status: 'available' };
      }
      if (d.status === 'assigned' && d.holder) {
        await lifecycle.openAssignment(conn, {
          entityId, device: current, holder: holderOf(d.holder), actorId, purpose: 'Impor laporan perangkat',
        });
        result.assignmentsCreated += 1;
      } else {
        await lifecycle.moveStatus(conn, entityId, current, d.status);
      }
    }
    result.devicesUpdated += 1;
    await logWith(conn, {
      entityId, userId: actorId || null, action: 'device.import_update', subjectType: 'device', subjectId: d.existingDeviceId,
      metadata: { row: d.rowNumber, differences: d.differences },
    });
  }

  await logWith(conn, {
    entityId, userId: actorId || null, action: 'it_device_import.apply', subjectType: 'entity', subjectId: Number(entityId),
    metadata: { companyCode: entityCode, fingerprint: plan.fingerprint, result, counts: plan.counts },
  });
  return { ...result, companyCode: entityCode, fingerprint: plan.fingerprint };
}

module.exports = { entityReportCode, initials, loadContext, preview, apply, guessLocationKind };
