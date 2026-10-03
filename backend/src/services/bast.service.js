const pool = require('../db/pool');
const docs = require('./docTemplates.service');
const { logWith } = require('./activityLog.service');
const { DEVICE_TYPE_LABELS } = require('../config/itAssets');
const { PHONE_KIND_LABELS } = require('../config/itInfra');

const { DocTemplateError } = docs;

// Berita acara serah terima (BAST) for devices and company numbers — IT and
// GA working together in People & Culture (owner, 1 Oct 2026). The handling
// staff (petugas) names their team (IT or GA); the other team's PIC (People &
// Culture → PIC setting) acknowledges by default ("Mengetahui"). The document
// is made from the built-in template into People & Culture's Shared Drive
// folder with the division's kop, and linked to the assignment or number.

const TEAMS = { it: 'IT', ga: 'GA' };
const dash = (v) => (v === null || v === undefined || String(v).trim() === '' ? '-' : String(v).trim());

async function personOfUser(db, entityId, userId) {
  if (!userId) return null;
  const [[row]] = await db.query(
    `SELECT u.name, p.position, COALESCE(pd.name, ud.name) AS department_name
       FROM users u
       LEFT JOIN people_directory p ON p.entity_id = u.entity_id AND p.user_id = u.id
       LEFT JOIN departments pd ON pd.id = p.department_id
       LEFT JOIN departments ud ON ud.id = u.department_id
      WHERE u.id = ? AND u.entity_id = ? LIMIT 1`,
    [userId, entityId],
  );
  return row ? { name: row.name, position: row.position || '', departmentName: row.department_name || '' } : null;
}

async function personById(db, entityId, personId) {
  if (!personId) return null;
  const [[row]] = await db.query(
    `SELECT COALESCE(u.name, p.full_name) AS name, p.position, d.name AS department_name
       FROM people_directory p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN departments d ON d.id = p.department_id
      WHERE p.id = ? AND p.entity_id = ? LIMIT 1`,
    [personId, entityId],
  );
  return row ? { name: row.name, position: row.position || '', departmentName: row.department_name || '' } : null;
}

async function readPic(db, entityId) {
  const [[row]] = await db.query("SELECT value FROM settings WHERE entity_id = ? AND `key` = 'people_culture.pic' LIMIT 1", [entityId]);
  let value = row?.value;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { value = null; } }
  return { it: Number(value?.itUserId) || null, ga: Number(value?.gaUserId) || null };
}

/** Staff, team and acknowledger values shared by every BAST. */
async function partyValues(db, user, input) {
  const team = TEAMS[input.team] ? input.team : 'it';
  const me = await personOfUser(db, user.entityId, user.sub);
  let acknowledgerId = input.acknowledgerUserId || null;
  if (!acknowledgerId) {
    const pic = await readPic(db, user.entityId);
    const other = team === 'it' ? pic.ga : pic.it;
    acknowledgerId = other && other !== Number(user.sub) ? other : null;
  }
  const ack = await personOfUser(db, user.entityId, acknowledgerId);
  if (input.acknowledgerUserId && !ack) throw new DocTemplateError('ACKNOWLEDGER_INVALID', 'Pengguna yang mengetahui tidak ditemukan', 400, { field: 'acknowledgerUserId' });
  return {
    petugas_nama: me?.name || '',
    petugas_jabatan: me?.position || `Tim ${TEAMS[team]}`,
    petugas_tim: TEAMS[team],
    mengetahui_nama: ack?.name || '..............................',
    mengetahui_jabatan: ack?.position || '',
  };
}

async function templateFor(key, user) {
  const row = await docs.templateByKey(pool, user.entityId, key);
  if (!row || !row.drive_template_file_id) {
    throw new DocTemplateError('TEMPLATE_NOT_READY', 'Template BAST belum disiapkan. Buka Dokumen → Template dokumen, lalu pilih "Siapkan template BAST".', 409);
  }
  return row;
}

// ------------------------------------------------------------ devices
async function assignmentRow(db, entityId, assignmentId) {
  const [[row]] = await db.query(
    `SELECT a.id, a.entity_id, a.device_id, a.assigned_to, a.person_id, a.holder_label, a.location, a.status,
            d.device_type, d.brand, d.model, d.serial_number, d.asset_code, d.ram_gb, d.storage_gb, d.os_version, d.imei,
            loc.name AS location_name
       FROM device_assignments a
       JOIN devices d ON d.id = a.device_id AND d.entity_id = a.entity_id AND d.deleted_at IS NULL
       LEFT JOIN org_locations loc ON loc.entity_id = d.entity_id AND loc.id = d.location_id
      WHERE a.id = ? AND a.entity_id = ? LIMIT 1`,
    [assignmentId, entityId],
  );
  if (!row) throw new DocTemplateError('NOT_FOUND', 'Serah terima perangkat tidak ditemukan', 404);
  return row;
}

function specification(r) {
  return [
    r.ram_gb ? `RAM ${Number(r.ram_gb)} GB` : null,
    r.storage_gb ? `Penyimpanan ${Number(r.storage_gb)} GB` : null,
    r.os_version ? r.os_version : null,
  ].filter(Boolean).join(', ');
}

async function deviceValues(db, user, assignmentId, input) {
  const a = await assignmentRow(db, user.entityId, assignmentId);
  const holder = (a.person_id ? await personById(db, user.entityId, a.person_id) : null)
    || (a.assigned_to ? await personOfUser(db, user.entityId, a.assigned_to) : null)
    || { name: a.holder_label || '', position: '', departmentName: '' };
  return {
    assignment: a,
    values: {
      ...(await partyValues(db, user, input)),
      karyawan_nama: dash(holder.name),
      karyawan_jabatan: holder.position || '',
      karyawan_divisi: dash(holder.departmentName),
      lokasi: dash(input.location || a.location_name || a.location),
      jenis_perangkat: dash(DEVICE_TYPE_LABELS[a.device_type] || a.device_type),
      merek_model: dash([a.brand, a.model].filter(Boolean).join(' ')),
      nomor_seri: dash(a.serial_number),
      kode_aset: dash(a.asset_code),
      spesifikasi: dash(specification(a)),
      imei: dash(a.imei),
      kelengkapan: dash(input.accessories),
      kondisi: dash(input.condition),
      catatan: dash(input.notes),
    },
  };
}

const CONDITIONS = new Set(['excellent', 'good', 'fair', 'poor', 'broken']);

/** POST /it/assignments/:id/bast — BAST serah terima or pengembalian for a device assignment. */
async function makeDeviceBast(user, assignmentId, input) {
  const kind = input.kind === 'return' ? 'return' : 'handover';
  const template = await templateFor(kind === 'return' ? 'bast_device_return' : 'bast_device_handover', user);
  const { assignment, values } = await deviceValues(pool, user, assignmentId, input);
  const doc = await docs.generate(user, {
    templateRow: template,
    values,
    title: `${kind === 'return' ? 'BAST pengembalian' : 'BAST serah terima'} ${values.merek_model !== '-' ? values.merek_model : values.jenis_perangkat} — ${values.karyawan_nama}`,
    subjectType: 'device_assignment',
    subjectId: Number(assignment.id),
  });
  // Link it to the assignment, like an uploaded handover/return document.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (kind === 'return') {
      const condition = CONDITIONS.has(input.conditionCode) ? input.conditionCode : null;
      const [ins] = await conn.query(
        `INSERT INTO device_return_documents (assignment_id, drive_file_id, web_view_link, condition_on_return)
         VALUES (?, ?, ?, ?)`,
        [assignment.id, doc.driveFileId, doc.webViewLink, condition],
      );
      await conn.query('UPDATE device_assignments SET return_document_id = ? WHERE id = ? AND entity_id = ?', [ins.insertId, assignment.id, user.entityId]);
    } else {
      const [ins] = await conn.query(
        'INSERT INTO device_handover_documents (assignment_id, drive_file_id, web_view_link) VALUES (?, ?, ?)',
        [assignment.id, doc.driveFileId, doc.webViewLink],
      );
      await conn.query('UPDATE device_assignments SET handover_document_id = ? WHERE id = ? AND entity_id = ?', [ins.insertId, assignment.id, user.entityId]);
    }
    await logWith(conn, {
      entityId: user.entityId, userId: user.sub, action: kind === 'return' ? 'device_return.bast' : 'device_handover.bast',
      subjectType: 'device_assignment', subjectId: Number(assignment.id),
      metadata: { deviceId: Number(assignment.device_id), number: doc.number, team: values.petugas_tim, driveFileId: doc.driveFileId },
    });
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return doc;
}

// ------------------------------------------------------------ company numbers
async function phoneValues(db, user, lineId, input) {
  const [[line]] = await db.query(
    `SELECT p.id, p.kind, p.number, p.extension, p.provider, p.plan_name, p.person_id, p.holder_label,
            d.brand AS device_brand, d.model AS device_model, d.asset_code AS device_asset_code, loc.name AS location_name
       FROM it_phone_lines p
       LEFT JOIN devices d ON d.entity_id = p.entity_id AND d.id = p.device_id
       LEFT JOIN org_locations loc ON loc.entity_id = p.entity_id AND loc.id = p.location_id
      WHERE p.id = ? AND p.entity_id = ? LIMIT 1`,
    [lineId, user.entityId],
  );
  if (!line) throw new DocTemplateError('NOT_FOUND', 'Nomor perusahaan tidak ditemukan', 404);
  const holder = (line.person_id ? await personById(db, user.entityId, line.person_id) : null)
    || { name: line.holder_label || '', position: '', departmentName: '' };
  // A number already back as spare has no holder any more: the form sends the name.
  const name = input.holderName || holder.name;
  if (!String(name || '').trim()) {
    throw new DocTemplateError('HOLDER_REQUIRED', 'Isi nama karyawan pemegang nomor', 400, { field: 'holderName' });
  }
  return {
    line,
    values: {
      ...(await partyValues(db, user, input)),
      karyawan_nama: String(name).trim(),
      karyawan_jabatan: input.holderPosition ?? holder.position ?? '',
      karyawan_divisi: dash(input.holderDivision ?? holder.departmentName),
      lokasi: dash(input.location || line.location_name),
      nomor_hp: line.number || (line.extension ? `Ekstensi ${line.extension}` : '-'),
      jenis_nomor: dash(PHONE_KIND_LABELS[line.kind] || line.kind),
      operator: dash(line.provider),
      paket: dash(line.plan_name),
      perangkat: dash([line.device_brand, line.device_model].filter(Boolean).join(' ') || line.device_asset_code),
      kelengkapan: dash(input.accessories),
      kondisi: dash(input.condition),
      catatan: dash(input.notes),
    },
  };
}

/** POST /it/infrastructure/phone-lines/:id/bast — BAST serah terima or pengembalian for a company number. */
async function makePhoneBast(user, lineId, input) {
  const kind = input.kind === 'return' ? 'return' : 'handover';
  const template = await templateFor(kind === 'return' ? 'bast_phone_return' : 'bast_phone_handover', user);
  const { line, values } = await phoneValues(pool, user, lineId, input);
  return docs.generate(user, {
    templateRow: template,
    values,
    title: `${kind === 'return' ? 'BAST pengembalian nomor' : 'BAST serah terima nomor'} ${values.nomor_hp} — ${values.karyawan_nama}`,
    subjectType: 'it_phone_line',
    subjectId: Number(line.id),
  });
}

module.exports = { makeDeviceBast, makePhoneBast, deviceValues, phoneValues, partyValues, TEAMS };
