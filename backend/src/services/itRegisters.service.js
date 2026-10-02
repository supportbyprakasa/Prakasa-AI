const net = require('node:net');
const { logWith } = require('./activityLog.service');
const {
  NETWORK_TYPE_LABELS, NETWORK_STATUS_LABELS, ISP_STATUS_LABELS, CCTV_RECORDER_LABELS, CCTV_STATUS_LABELS,
  BACKUP_FREQUENCY_LABELS, BACKUP_STORAGE_LABELS, BACKUP_RESULT_LABELS, BACKUP_STATUS_LABELS,
  PHONE_KIND_LABELS, PHONE_STATUS_LABELS, VENDOR_KIND_LABELS,
  CHECK_DAYS, FIRST_CHECK_GRACE_DAYS, GWS_REVIEW_DAYS, ISP_CONTRACT_WINDOW_DAYS,
} = require('../config/itInfra');

// IT infrastructure registers (People & Culture wave 2, row 2.3 —
// docs/rancangan-people-culture-g2.md §4.1–4.2): network devices, ISP links,
// CCTV systems, backup jobs with their checks, Google Workspace reviews and
// company phone lines.
//
// Rules every function here keeps:
//   - the entity is always the caller's (passed in, never read from a body);
//     a row of another entity reads as not found;
//   - department_id is the entity's People & Culture division (wave-1 rule 17);
//   - every write and its activity log run on the caller's connection, inside
//     its transaction; the log never carries an IP address or a cost;
//   - every PATCH carries `version` (409 VERSION_CONFLICT when it moved on) and
//     a status change sets status_changed_at;
//   - nothing is deleted: a row ends in a status; reviews and backup checks are
//     append-only.

const WIB_TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
const wibToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

class RegisterError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
const notFound = (what) => new RegisterError('NOT_FOUND', `${what} tidak ditemukan`, 404);
const versionConflict = () => new RegisterError(
  'VERSION_CONFLICT', 'Data ini sudah diubah orang lain. Muat ulang, lalu ulangi perubahan Anda.', 409,
);

// ------------------------------------------------------------ value helpers
const clean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || null;
};
// Notes keep their line breaks; other spaces are tidied.
const cleanNotes = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s || null;
};
const int = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const bool = (v) => (v === null || v === undefined ? null : Number(v) === 1);
const isoDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const iso = (v) => (v ? new Date(v).toISOString() : null);
const money = (v) => (v === null || v === undefined ? null : Number(v));

/** IPv4 or IPv6, trimmed; null when empty. Throws on anything else. */
function normalizeIp(value) {
  const s = clean(value);
  if (!s) return null;
  if (!net.isIP(s)) throw new RegisterError('IP_INVALID', 'Alamat IP tidak valid (contoh: 192.168.1.1)', 400, { field: 'ipAddress' });
  return s;
}

/**
 * A company number in +<country><number> form: "0812-3456-7890",
 * "62 812 3456 7890" and "+62 812 3456 7890" are the same +6281234567890.
 * Returns null for empty, throws for something that is not a phone number.
 */
function normalizePhone(value) {
  const raw = clean(value);
  if (!raw) return null;
  let digits = raw.replace(/[\s\-.()/]/g, '');
  if (!/^\+?\d+$/.test(digits)) throw new RegisterError('NUMBER_INVALID', 'Nomor hanya boleh berisi angka (boleh diawali +)', 400, { field: 'number' });
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (!digits.startsWith('62')) digits = `62${digits}`;
  if (digits.length < 8 || digits.length > 15) throw new RegisterError('NUMBER_INVALID', 'Panjang nomor tidak wajar', 400, { field: 'number' });
  return `+${digits}`;
}

function normalizeExtension(value) {
  const s = clean(value);
  if (!s) return null;
  if (!/^\d{1,10}$/.test(s)) throw new RegisterError('EXTENSION_INVALID', 'Ekstensi hanya berisi angka (maks. 10 digit)', 400, { field: 'extension' });
  return s;
}

// ------------------------------------------------------------ lookups
/** The entity's People & Culture division — every register row belongs there. */
async function peopleCultureDepartmentId(db, entityId) {
  const [[row]] = await db.query(
    "SELECT id FROM departments WHERE entity_id = ? AND code = 'people_culture' AND deleted_at IS NULL LIMIT 1",
    [entityId],
  );
  if (!row) throw new RegisterError('NO_PC_DIVISION', 'Divisi People & Culture perusahaan ini belum ada', 409);
  return Number(row.id);
}

async function assertLocation(db, entityId, locationId, { allowInactiveId = null } = {}) {
  if (locationId === null || locationId === undefined) return;
  const [[row]] = await db.query('SELECT id, is_active FROM org_locations WHERE id = ? AND entity_id = ? LIMIT 1', [locationId, entityId]);
  if (!row) throw new RegisterError('LOCATION_INVALID', 'Lokasi tidak ditemukan di perusahaan ini', 400, { field: 'locationId' });
  if (Number(row.is_active) !== 1 && Number(allowInactiveId) !== Number(locationId)) {
    throw new RegisterError('LOCATION_INACTIVE', 'Lokasi ini sudah nonaktif', 400, { field: 'locationId' });
  }
}

async function assertRow(db, entityId, table, id, message, field, extra = '') {
  if (id === null || id === undefined) return null;
  const [[row]] = await db.query(`SELECT * FROM ${table} WHERE id = ? AND entity_id = ?${extra} LIMIT 1`, [id, entityId]);
  if (!row) throw new RegisterError('REFERENCE_INVALID', message, 400, { field });
  return row;
}

// ------------------------------------------------------------ registers
// field → { col, kind } where kind tells how the body value is stored.
// `secret: true` columns (IP address, costs) never appear in a log.
const REGISTERS = {
  network: {
    table: 'it_network_devices',
    subject: 'it_network_device',
    label: 'Perangkat jaringan',
    fields: {
      locationId: { col: 'location_id', kind: 'location' },
      deviceType: { col: 'device_type', kind: 'enum' },
      brandModel: { col: 'brand_model', kind: 'text' },
      serialNumber: { col: 'serial_number', kind: 'text' },
      ipAddress: { col: 'ip_address', kind: 'ip', secret: true },
      installedYear: { col: 'installed_year', kind: 'int' },
      ispLinkId: { col: 'isp_link_id', kind: 'ref' },
      firmwareUpdatedOn: { col: 'firmware_updated_on', kind: 'date' },
      status: { col: 'status', kind: 'status' },
      notes: { col: 'notes', kind: 'notes' },
    },
    required: ['locationId', 'deviceType', 'brandModel'],
    defaults: { status: 'active' },
  },
  isp: {
    table: 'it_isp_links',
    subject: 'it_isp_link',
    label: 'ISP',
    fields: {
      locationId: { col: 'location_id', kind: 'location' },
      vendorId: { col: 'vendor_id', kind: 'ref' },
      providerName: { col: 'provider_name', kind: 'text' },
      customerNumber: { col: 'customer_number', kind: 'text' },
      bandwidthMbps: { col: 'bandwidth_mbps', kind: 'int' },
      publicIpDedicated: { col: 'public_ip_dedicated', kind: 'bool' },
      isBackup: { col: 'is_backup', kind: 'bool' },
      contractStart: { col: 'contract_start', kind: 'date' },
      contractEnd: { col: 'contract_end', kind: 'date' },
      monthlyCost: { col: 'monthly_cost', kind: 'money', secret: true },
      status: { col: 'status', kind: 'status' },
      notes: { col: 'notes', kind: 'notes' },
    },
    required: ['locationId', 'providerName'],
    defaults: { status: 'active', publicIpDedicated: false, isBackup: false },
  },
  cctv: {
    table: 'it_cctv_systems',
    subject: 'it_cctv_system',
    label: 'Sistem CCTV',
    fields: {
      locationId: { col: 'location_id', kind: 'location' },
      cameraCount: { col: 'camera_count', kind: 'int' },
      cameraModel: { col: 'camera_model', kind: 'text' },
      recorderType: { col: 'recorder_type', kind: 'enum' },
      recorderDeviceId: { col: 'recorder_device_id', kind: 'ref' },
      serialNumber: { col: 'serial_number', kind: 'text' },
      remoteAccess: { col: 'remote_access', kind: 'bool' },
      sameNetworkAsPc: { col: 'same_network_as_pc', kind: 'bool' },
      status: { col: 'status', kind: 'status' },
      camerasOffline: { col: 'cameras_offline', kind: 'int' },
      notes: { col: 'notes', kind: 'notes' },
    },
    required: ['locationId', 'cameraCount', 'recorderType'],
    defaults: { status: 'online', camerasOffline: 0, remoteAccess: false },
  },
  backup: {
    table: 'it_backup_jobs',
    subject: 'it_backup_job',
    label: 'Backup',
    fields: {
      locationId: { col: 'location_id', kind: 'location' },
      dataScope: { col: 'data_scope', kind: 'text' },
      method: { col: 'method', kind: 'text' },
      frequency: { col: 'frequency', kind: 'enum' },
      storageLocation: { col: 'storage_location', kind: 'enum' },
      retention: { col: 'retention', kind: 'text' },
      status: { col: 'status', kind: 'status' },
      notes: { col: 'notes', kind: 'notes' },
    },
    required: ['dataScope', 'method', 'frequency', 'storageLocation'],
    defaults: { status: 'active' },
  },
  phone: {
    table: 'it_phone_lines',
    subject: 'it_phone_line',
    label: 'Nomor perusahaan',
    fields: {
      locationId: { col: 'location_id', kind: 'location' },
      kind: { col: 'kind', kind: 'enum' },
      number: { col: 'number', kind: 'phone' },
      extension: { col: 'extension', kind: 'extension' },
      deviceId: { col: 'device_id', kind: 'ref' },
      provider: { col: 'provider', kind: 'text' },
      planName: { col: 'plan_name', kind: 'text' },
      startedOn: { col: 'started_on', kind: 'date' },
      monthlyCost: { col: 'monthly_cost', kind: 'money', secret: true },
      status: { col: 'status', kind: 'status' },
      notes: { col: 'notes', kind: 'notes' },
    },
    required: ['locationId', 'kind'],
    defaults: { status: 'spare' },
  },
};

function storeValue(spec, value) {
  if (value === undefined) return undefined;
  switch (spec.kind) {
    case 'text': return clean(value);
    case 'notes': return cleanNotes(value);
    case 'ip': return normalizeIp(value);
    case 'phone': return normalizePhone(value);
    case 'extension': return normalizeExtension(value);
    case 'bool': return value === null ? null : (value ? 1 : 0);
    case 'money': return value === null ? null : Number(value);
    case 'int': case 'ref': case 'location': return value === null ? null : Number(value);
    default: return value === null ? null : value;
  }
}

// The stored value as the log and the diff compare it.
function comparable(spec, value) {
  if (value === null || value === undefined) return null;
  if (spec.kind === 'date') return isoDate(value);
  if (spec.kind === 'bool') return Number(value) === 1 ? 1 : 0;
  if (['int', 'ref', 'location', 'money'].includes(spec.kind)) return Number(value);
  return value;
}

// An IP address written inside free text (notes) never reaches a log either.
const IPV4_RE = /\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?\b/g;
const IPV6_RE = /\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}\b/gi;
const redactIp = (value) => (typeof value === 'string' ? value.replace(IPV4_RE, '[IP]').replace(IPV6_RE, '[IP]') : value);

// Values for the log: secret fields (IP, cost) are named, never valued.
function safeForLog(def, obj) {
  return Object.fromEntries(Object.entries(obj)
    .filter(([field]) => !def.fields[field]?.secret)
    .map(([field, value]) => [field, redactIp(value)]));
}

// Before/after for the log.
function logChanges(def, before, after) {
  return { fields: Object.keys(after), before: safeForLog(def, before), after: safeForLog(def, after) };
}

// ------------------------------------------------------------ reference rules
async function checkReferences(db, entityId, key, values, current = null) {
  const merged = { ...(current || {}), ...values };
  if (values.locationId !== undefined) {
    if (values.locationId === null && key !== 'backup') {
      throw new RegisterError('LOCATION_REQUIRED', 'Pilih lokasi', 400, { field: 'locationId' });
    }
    await assertLocation(db, entityId, values.locationId, { allowInactiveId: current?.locationId });
  }
  if (key === 'network' && values.ispLinkId !== undefined && values.ispLinkId !== null) {
    await assertRow(db, entityId, 'it_isp_links', values.ispLinkId, 'ISP tidak ditemukan di perusahaan ini', 'ispLinkId');
  }
  if (key === 'isp' && values.vendorId !== undefined && values.vendorId !== null) {
    await assertRow(db, entityId, 'software_vendors', values.vendorId, 'Vendor ISP tidak ditemukan di perusahaan ini', 'vendorId', " AND deleted_at IS NULL AND vendor_kind = 'isp'");
  }
  if (key === 'cctv') {
    if (values.recorderDeviceId !== undefined && values.recorderDeviceId !== null) {
      await assertRow(db, entityId, 'it_network_devices', values.recorderDeviceId, 'Perekam (NVR/DVR) tidak ditemukan di perusahaan ini', 'recorderDeviceId');
    }
    const count = Number(merged.cameraCount);
    const offline = Number(merged.camerasOffline || 0);
    if (Number.isFinite(count) && offline > count) {
      throw new RegisterError('CAMERAS_OFFLINE_INVALID', 'Kamera offline tidak boleh lebih dari jumlah kamera', 400, { field: 'camerasOffline' });
    }
  }
  if (key === 'isp' && merged.contractStart && merged.contractEnd && isoDate(merged.contractEnd) < isoDate(merged.contractStart)) {
    throw new RegisterError('CONTRACT_INVALID', 'Akhir kontrak tidak boleh sebelum awal kontrak', 400, { field: 'contractEnd' });
  }
  if (key === 'phone') {
    if (values.deviceId !== undefined && values.deviceId !== null) {
      await assertRow(db, entityId, 'devices', values.deviceId, 'Perangkat tidak ditemukan di perusahaan ini', 'deviceId', ' AND deleted_at IS NULL');
    }
    if (!merged.number && !merged.extension) {
      throw new RegisterError('NUMBER_REQUIRED', merged.kind === 'ip_phone' ? 'Isi ekstensi atau nomor' : 'Isi nomor HP perusahaan', 400, { field: merged.kind === 'ip_phone' ? 'extension' : 'number' });
    }
    if (merged.kind === 'mobile' && !merged.number) {
      throw new RegisterError('NUMBER_REQUIRED', 'Isi nomor HP perusahaan', 400, { field: 'number' });
    }
  }
}

function duplicateError(key, e) {
  const msg = String(e.sqlMessage || e.message || '');
  if (key === 'network' && /serial/.test(msg)) return new RegisterError('SERIAL_TAKEN', 'Nomor seri sudah dipakai perangkat jaringan lain di perusahaan ini', 409, { field: 'serialNumber' });
  if (key === 'phone' && /extension/.test(msg)) return new RegisterError('EXTENSION_TAKEN', 'Ekstensi ini sudah dipakai nomor lain yang belum berhenti', 409, { field: 'extension' });
  if (key === 'phone') return new RegisterError('NUMBER_TAKEN', 'Nomor ini sudah tercatat dan belum berhenti', 409, { field: 'number' });
  return new RegisterError('DUPLICATE', 'Data yang sama sudah ada', 409);
}

// A foreign key refused by the database (a row of another entity slipped past
// the service checks) reads as an invalid reference, never as a 500.
function referenceError(e) {
  return new RegisterError('REFERENCE_INVALID', 'Data terkait tidak ditemukan di perusahaan ini', 400);
}

async function guardedWrite(key, fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RegisterError) throw e;
    if (e.code === 'ER_DUP_ENTRY') throw duplicateError(key, e);
    if (e.code === 'ER_NO_REFERENCED_ROW_2' || e.code === 'ER_NO_REFERENCED_ROW') throw referenceError(e);
    if (e.code === 'ER_CHECK_CONSTRAINT_VIOLATED') throw new RegisterError('CHECK_FAILED', 'Isian tidak memenuhi aturan register', 400, { constraint: e.sqlMessage });
    throw e;
  }
}

// ------------------------------------------------------------ reads (SQL + shape)
const LOCATION_JOIN = (alias) => `LEFT JOIN org_locations loc ON loc.entity_id = ${alias}.entity_id AND loc.id = ${alias}.location_id`;

// When a backup job is due for its next check (§4.5): the last check plus its
// frequency's days, or registration + FIRST_CHECK_GRACE_DAYS when never checked.
const CHECK_DAYS_SQL = (alias) => `(CASE ${alias}.frequency WHEN 'daily' THEN ${CHECK_DAYS.daily} WHEN 'weekly' THEN ${CHECK_DAYS.weekly}
  WHEN 'monthly' THEN ${CHECK_DAYS.monthly} ELSE ${CHECK_DAYS.other} END)`;
const BACKUP_DUE_ON = (alias) => `(CASE WHEN ${alias}.last_checked_on IS NULL
  THEN DATE(${alias}.created_at + INTERVAL 7 HOUR) + INTERVAL ${FIRST_CHECK_GRACE_DAYS} DAY
  ELSE ${alias}.last_checked_on + INTERVAL ${CHECK_DAYS_SQL(alias)} DAY END)`;
const BACKUP_OVERDUE = (alias) => `(${alias}.status = 'active' AND ${BACKUP_DUE_ON(alias)} < ${WIB_TODAY})`;
const BACKUP_FAILING = (alias) => `(${alias}.status = 'active' AND ${alias}.last_result = 'failed')`;

const SELECTS = {
  network: `SELECT n.*, loc.name AS location_name, isp.provider_name AS isp_name
              FROM it_network_devices n ${LOCATION_JOIN('n')}
              LEFT JOIN it_isp_links isp ON isp.entity_id = n.entity_id AND isp.id = n.isp_link_id
             WHERE n.entity_id = ?`,
  isp: `SELECT l.*, loc.name AS location_name, v.name AS vendor_name
          FROM it_isp_links l ${LOCATION_JOIN('l')}
          LEFT JOIN software_vendors v ON v.entity_id = l.entity_id AND v.id = l.vendor_id
         WHERE l.entity_id = ?`,
  cctv: `SELECT c.*, loc.name AS location_name, rd.brand_model AS recorder_name, rd.device_type AS recorder_device_type
           FROM it_cctv_systems c ${LOCATION_JOIN('c')}
           LEFT JOIN it_network_devices rd ON rd.entity_id = c.entity_id AND rd.id = c.recorder_device_id
          WHERE c.entity_id = ?`,
  backup: `SELECT b.*, loc.name AS location_name,
                  ${BACKUP_DUE_ON('b')} AS due_on, ${BACKUP_OVERDUE('b')} AS overdue,
                  (SELECT COUNT(*) FROM it_backup_checks k WHERE k.entity_id = b.entity_id AND k.backup_job_id = b.id) AS check_count
             FROM it_backup_jobs b ${LOCATION_JOIN('b')}
            WHERE b.entity_id = ?`,
  phone: `SELECT p.*, loc.name AS location_name,
                 COALESCE(pu.name, pd.full_name) AS person_name, pd.status AS person_status,
                 d.brand AS device_brand, d.model AS device_model, d.asset_code AS device_asset_code
            FROM it_phone_lines p ${LOCATION_JOIN('p')}
            LEFT JOIN people_directory pd ON pd.entity_id = p.entity_id AND pd.id = p.person_id
            LEFT JOIN users pu ON pu.id = pd.user_id
            LEFT JOIN devices d ON d.entity_id = p.entity_id AND d.id = p.device_id
           WHERE p.entity_id = ?`,
};
const ALIAS = { network: 'n', isp: 'l', cctv: 'c', backup: 'b', phone: 'p' };
const ORDER = {
  network: 'ORDER BY loc.name ASC, n.device_type ASC, n.id ASC',
  isp: 'ORDER BY loc.name ASC, l.is_backup ASC, l.id ASC',
  cctv: 'ORDER BY loc.name ASC, c.id ASC',
  backup: 'ORDER BY b.status ASC, b.id ASC',
  phone: "ORDER BY FIELD(p.status, 'active', 'spare', 'terminated'), p.kind ASC, p.number ASC, p.extension ASC, p.id ASC",
};

const base = (r) => ({
  id: Number(r.id),
  departmentId: int(r.department_id),
  locationId: int(r.location_id),
  locationName: r.location_name || null,
  notes: r.notes || null,
  version: r.version != null ? Number(r.version) : undefined,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const SHAPES = {
  network: (r) => ({
    ...base(r),
    deviceType: r.device_type,
    deviceTypeLabel: NETWORK_TYPE_LABELS[r.device_type] || r.device_type,
    brandModel: r.brand_model,
    serialNumber: r.serial_number || null,
    ipAddress: r.ip_address || null,
    installedYear: int(r.installed_year),
    ispLinkId: int(r.isp_link_id),
    ispName: r.isp_name || null,
    firmwareUpdatedOn: isoDate(r.firmware_updated_on),
    status: r.status,
    statusLabel: NETWORK_STATUS_LABELS[r.status] || r.status,
    statusChangedAt: iso(r.status_changed_at),
  }),
  isp: (r) => ({
    ...base(r),
    vendorId: int(r.vendor_id),
    vendorName: r.vendor_name || null,
    providerName: r.provider_name,
    customerNumber: r.customer_number || null,
    bandwidthMbps: int(r.bandwidth_mbps),
    publicIpDedicated: bool(r.public_ip_dedicated),
    isBackup: bool(r.is_backup),
    contractStart: isoDate(r.contract_start),
    contractEnd: isoDate(r.contract_end),
    monthlyCost: money(r.monthly_cost),
    status: r.status,
    statusLabel: ISP_STATUS_LABELS[r.status] || r.status,
    statusChangedAt: iso(r.status_changed_at),
  }),
  cctv: (r) => ({
    ...base(r),
    cameraCount: int(r.camera_count),
    cameraModel: r.camera_model || null,
    recorderType: r.recorder_type,
    recorderTypeLabel: CCTV_RECORDER_LABELS[r.recorder_type] || r.recorder_type,
    recorderDeviceId: int(r.recorder_device_id),
    recorderName: r.recorder_name || null,
    serialNumber: r.serial_number || null,
    remoteAccess: bool(r.remote_access),
    sameNetworkAsPc: bool(r.same_network_as_pc),
    status: r.status,
    statusLabel: CCTV_STATUS_LABELS[r.status] || r.status,
    camerasOffline: int(r.cameras_offline) || 0,
    statusChangedAt: iso(r.status_changed_at),
  }),
  backup: (r) => ({
    ...base(r),
    dataScope: r.data_scope,
    method: r.method,
    frequency: r.frequency,
    frequencyLabel: BACKUP_FREQUENCY_LABELS[r.frequency] || r.frequency,
    storageLocation: r.storage_location,
    storageLocationLabel: BACKUP_STORAGE_LABELS[r.storage_location] || r.storage_location,
    retention: r.retention || null,
    restoreTestedOn: isoDate(r.restore_tested_on),
    lastCheckedOn: isoDate(r.last_checked_on),
    lastResult: r.last_result,
    lastResultLabel: BACKUP_RESULT_LABELS[r.last_result] || r.last_result,
    dueOn: isoDate(r.due_on),
    overdue: Number(r.overdue) === 1,
    checkCount: Number(r.check_count || 0),
    status: r.status,
    statusLabel: BACKUP_STATUS_LABELS[r.status] || r.status,
    statusChangedAt: iso(r.status_changed_at),
  }),
  phone: (r) => ({
    ...base(r),
    kind: r.kind,
    kindLabel: PHONE_KIND_LABELS[r.kind] || r.kind,
    number: r.number || null,
    extension: r.extension || null,
    personId: int(r.person_id),
    personName: r.person_name || null,
    personResigned: r.person_status === 'resigned',
    holderLabel: r.holder_label || null,
    holderName: r.person_name || r.holder_label || null,
    deviceId: int(r.device_id),
    deviceName: [r.device_brand, r.device_model].filter(Boolean).join(' ') || r.device_asset_code || null,
    provider: r.provider || null,
    planName: r.plan_name || null,
    startedOn: isoDate(r.started_on),
    monthlyCost: money(r.monthly_cost),
    status: r.status,
    statusLabel: PHONE_STATUS_LABELS[r.status] || r.status,
    statusChangedAt: iso(r.status_changed_at),
  }),
};

/** Every row of one register of the entity (registers are small: ≤ 1000 rows). */
async function listRows(db, entityId, key) {
  const [rows] = await db.query(`${SELECTS[key]} ${ORDER[key]} LIMIT 1000`, [entityId]);
  return rows.map(SHAPES[key]);
}

async function getRow(db, entityId, key, id) {
  const [[row]] = await db.query(`${SELECTS[key]} AND ${ALIAS[key]}.id = ? LIMIT 1`, [entityId, id]);
  return row ? SHAPES[key](row) : null;
}

// ------------------------------------------------------------ writes
async function lockRow(conn, entityId, key, id) {
  const def = REGISTERS[key];
  const [[row]] = await conn.query(`SELECT * FROM ${def.table} WHERE id = ? AND entity_id = ? FOR UPDATE`, [id, entityId]);
  if (!row) throw notFound(def.label);
  return row;
}

// The current row as body-shaped values, for merging and diffing.
function bodyOf(def, row) {
  const out = {};
  for (const [field, spec] of Object.entries(def.fields)) out[field] = comparable(spec, row[spec.col]);
  return out;
}

function phoneStatusRules(values, merged) {
  // A line in use has a holder; a spare or stopped line has none.
  if (merged.status === 'active' && !merged.personId && !merged.holderLabel) {
    throw new RegisterError('HOLDER_REQUIRED', 'Nomor aktif harus punya pemegang — pakai "Ganti pemegang"', 400, { field: 'status' });
  }
}

/** POST — a new register row. Returns the new id. */
async function createRow(conn, { entityId, userId, key, body }) {
  const def = REGISTERS[key];
  return guardedWrite(key, async () => {
    const values = { ...def.defaults };
    for (const field of Object.keys(def.fields)) if (body[field] !== undefined) values[field] = body[field];
    for (const field of def.required) {
      if (values[field] === undefined || values[field] === null || values[field] === '') {
        throw new RegisterError('VALIDATION_ERROR', 'Lengkapi isian wajib', 400, { field });
      }
    }
    const stored = {};
    for (const [field, value] of Object.entries(values)) {
      const spec = def.fields[field];
      if (spec) stored[field] = storeValue(spec, value);
    }
    if (key === 'phone') {
      if (stored.status === 'active') throw new RegisterError('HOLDER_REQUIRED', 'Simpan nomor dulu, lalu pakai "Ganti pemegang" untuk menyerahkannya', 400, { field: 'status' });
    }
    if (key === 'cctv') {
      if (stored.status === 'online') stored.camerasOffline = 0;
      if (stored.status === 'offline') stored.camerasOffline = stored.cameraCount;
    }
    await checkReferences(conn, entityId, key, stored);
    const departmentId = await peopleCultureDepartmentId(conn, entityId);
    const cols = ['entity_id', 'department_id', 'created_by', 'updated_by'];
    const args = [entityId, departmentId, userId, userId];
    for (const [field, value] of Object.entries(stored)) {
      cols.push(def.fields[field].col);
      args.push(value);
    }
    const [ins] = await conn.query(
      `INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      args,
    );
    const id = Number(ins.insertId);
    const safe = safeForLog(def, stored);
    await logWith(conn, {
      entityId, userId, action: `${def.subject}.create`, subjectType: def.subject, subjectId: id, metadata: { after: safe },
    });
    return id;
  });
}

/** PATCH — changes some fields of a row at the version the caller saw. */
async function updateRow(conn, { entityId, userId, key, id, body }) {
  const def = REGISTERS[key];
  return guardedWrite(key, async () => {
    const row = await lockRow(conn, entityId, key, id);
    if (Number(row.version) !== Number(body.version)) throw versionConflict();
    const current = bodyOf(def, row);
    if (key === 'phone') { current.personId = int(row.person_id); current.holderLabel = row.holder_label || null; }
    const incoming = {};
    for (const field of Object.keys(def.fields)) if (body[field] !== undefined) incoming[field] = storeValue(def.fields[field], body[field]);
    const before = {};
    const after = {};
    for (const [field, value] of Object.entries(incoming)) {
      const spec = def.fields[field];
      if (comparable(spec, value) !== current[field]) { before[field] = current[field]; after[field] = comparable(spec, value); }
    }
    const merged = { ...current, ...after };
    if (key === 'cctv' && after.status !== undefined) {
      if (merged.status === 'online') merged.camerasOffline = 0;
      if (merged.status === 'offline') merged.camerasOffline = merged.cameraCount;
      if (merged.camerasOffline !== current.camerasOffline) { before.camerasOffline = current.camerasOffline; after.camerasOffline = merged.camerasOffline; }
    }
    let clearHolder = false;
    if (key === 'phone' && after.status !== undefined) {
      if (['spare', 'terminated'].includes(merged.status)) clearHolder = Boolean(current.personId || current.holderLabel);
      else phoneStatusRules(after, merged);
    }
    if (!Object.keys(after).length) return { id: Number(id), changed: [], version: Number(row.version) };
    await checkReferences(conn, entityId, key, after, current);
    const sets = Object.keys(after).map((field) => `${def.fields[field].col} = ?`);
    const args = Object.keys(after).map((field) => after[field]);
    if (after.status !== undefined) sets.push('status_changed_at = CURRENT_TIMESTAMP');
    if (clearHolder) sets.push('person_id = NULL', 'holder_label = NULL');
    sets.push('updated_by = ?', 'version = version + 1');
    args.push(userId, id, entityId, row.version);
    const [upd] = await conn.query(
      `UPDATE ${def.table} SET ${sets.join(', ')} WHERE id = ? AND entity_id = ? AND version = ?`,
      args,
    );
    if (!upd.affectedRows) throw versionConflict();
    const changes = logChanges(def, before, after);
    if (clearHolder) changes.holderCleared = true;
    await logWith(conn, {
      entityId, userId, action: `${def.subject}.update`, subjectType: def.subject, subjectId: Number(id), metadata: changes,
    });
    return { id: Number(id), changed: Object.keys(after), version: Number(row.version) + 1 };
  });
}

/** POST /cctv/:id/status — Online / Sebagian offline / Offline / Tidak aktif with offline cameras. */
async function setCctvStatus(conn, { entityId, userId, id, status, camerasOffline, note, version }) {
  return guardedWrite('cctv', async () => {
    const row = await lockRow(conn, entityId, 'cctv', id);
    if (version !== undefined && version !== null && Number(row.version) !== Number(version)) throw versionConflict();
    const count = Number(row.camera_count);
    let offline;
    if (status === 'online' || status === 'retired') offline = 0;
    else if (status === 'offline') offline = count;
    else {
      offline = Number(camerasOffline);
      if (!Number.isInteger(offline) || offline < 1 || offline >= Math.max(count, 1)) {
        throw new RegisterError('CAMERAS_OFFLINE_INVALID', `Untuk "Sebagian offline", isi kamera offline 1–${Math.max(count - 1, 1)}`, 400, { field: 'camerasOffline' });
      }
    }
    const statusChanged = row.status !== status;
    await conn.query(
      `UPDATE it_cctv_systems SET status = ?, cameras_offline = ?${statusChanged ? ', status_changed_at = CURRENT_TIMESTAMP' : ''},
              updated_by = ?, version = version + 1
        WHERE id = ? AND entity_id = ?`,
      [status, offline, userId, id, entityId],
    );
    await logWith(conn, {
      entityId, userId, action: 'it_cctv_system.status', subjectType: 'it_cctv_system', subjectId: Number(id),
      metadata: { before: { status: row.status, camerasOffline: Number(row.cameras_offline) }, after: { status, camerasOffline: offline }, note: clean(note) },
    });
    return { id: Number(id), status, camerasOffline: offline, version: Number(row.version) + 1 };
  });
}

// ------------------------------------------------------------ backup checks
async function listBackupChecks(db, entityId, jobId) {
  const [[job]] = await db.query('SELECT id FROM it_backup_jobs WHERE id = ? AND entity_id = ? LIMIT 1', [jobId, entityId]);
  if (!job) throw notFound('Backup');
  const [rows] = await db.query(
    `SELECT k.id, k.checked_on, k.result, k.restore_tested, k.note, k.created_at, u.name AS checked_by_name
       FROM it_backup_checks k LEFT JOIN users u ON u.id = k.checked_by
      WHERE k.entity_id = ? AND k.backup_job_id = ?
      ORDER BY k.checked_on DESC, k.id DESC LIMIT 200`,
    [entityId, jobId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    checkedOn: isoDate(r.checked_on),
    result: r.result,
    resultLabel: BACKUP_RESULT_LABELS[r.result] || r.result,
    restoreTested: Number(r.restore_tested) === 1,
    note: r.note || null,
    checkedByName: r.checked_by_name || null,
    createdAt: iso(r.created_at),
  }));
}

/**
 * POST /backups/:id/checks — append one check and, in the same transaction,
 * move the job's last_checked_on / last_result (only when this check is not
 * older than the last one) and restore_tested_on (the latest tested day).
 */
async function addBackupCheck(conn, { entityId, userId, jobId, checkedOn, result, restoreTested, note }) {
  return guardedWrite('backup', async () => {
    const job = await lockRow(conn, entityId, 'backup', jobId);
    if (job.status !== 'active') throw new RegisterError('BACKUP_RETIRED', 'Backup ini sudah tidak aktif', 409);
    if (checkedOn > wibToday()) throw new RegisterError('DATE_IN_FUTURE', 'Tanggal pemeriksaan tidak boleh di masa depan', 400, { field: 'checkedOn' });
    const [ins] = await conn.query(
      `INSERT INTO it_backup_checks (entity_id, backup_job_id, checked_on, result, restore_tested, note, checked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entityId, jobId, checkedOn, result, restoreTested ? 1 : 0, clean(note), userId],
    );
    const lastChecked = isoDate(job.last_checked_on);
    const isLatest = !lastChecked || checkedOn >= lastChecked;
    const restoreOn = isoDate(job.restore_tested_on);
    const nextRestore = restoreTested && (!restoreOn || checkedOn > restoreOn) ? checkedOn : restoreOn;
    await conn.query(
      `UPDATE it_backup_jobs
          SET last_checked_on = ?, last_result = ?, restore_tested_on = ?, updated_by = ?, version = version + 1
        WHERE id = ? AND entity_id = ?`,
      [isLatest ? checkedOn : lastChecked, isLatest ? result : job.last_result, nextRestore, userId, jobId, entityId],
    );
    await logWith(conn, {
      entityId, userId, action: 'it_backup_job.check', subjectType: 'it_backup_job', subjectId: Number(jobId),
      metadata: { checkId: Number(ins.insertId), checkedOn, result, restoreTested: Boolean(restoreTested) },
    });
    return { id: Number(ins.insertId), jobId: Number(jobId) };
  });
}

// ------------------------------------------------------------ Google Workspace reviews
function gwsRiskFlags(r, today = wibToday()) {
  if (!r) return [];
  const flags = [];
  if (!r.mfaEnforced) flags.push({ key: 'mfa', label: 'MFA belum wajib' });
  if (!r.externalSharingRestricted) flags.push({ key: 'sharing', label: 'Berbagi ke luar belum dibatasi' });
  if (r.sharedAccountsUsed) flags.push({ key: 'shared_accounts', label: 'Akun bersama dipakai' });
  if (r.exUsersActive > 0) flags.push({ key: 'ex_users', label: `${r.exUsersActive} akun eks-karyawan masih aktif` });
  const due = new Date(`${r.reviewedOn}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + GWS_REVIEW_DAYS);
  if (!Number.isNaN(due.getTime()) && due.toISOString().slice(0, 10) < today) flags.push({ key: 'overdue', label: `Review terakhir lebih dari ${GWS_REVIEW_DAYS} hari lalu` });
  return flags;
}

const shapeGws = (r) => {
  const out = {
    id: Number(r.id),
    departmentId: int(r.department_id),
    reviewedOn: isoDate(r.reviewed_on),
    activeUsers: Number(r.active_users),
    superAdmins: Number(r.super_admins),
    mfaEnforced: Number(r.mfa_enforced) === 1,
    externalSharingRestricted: Number(r.external_sharing_restricted) === 1,
    sharedAccountsUsed: Number(r.shared_accounts_used) === 1,
    exUsersActive: Number(r.ex_users_active),
    reviewedByName: r.reviewed_by_name || null,
    notes: r.notes || null,
    createdAt: iso(r.created_at),
  };
  out.riskFlags = gwsRiskFlags(out);
  return out;
};

async function listGwsReviews(db, entityId) {
  const [rows] = await db.query(
    `SELECT g.*, u.name AS reviewed_by_name FROM it_gws_reviews g LEFT JOIN users u ON u.id = g.reviewed_by
      WHERE g.entity_id = ? ORDER BY g.reviewed_on DESC, g.id DESC LIMIT 200`,
    [entityId],
  );
  return rows.map(shapeGws);
}

/** POST /gws-reviews — a new snapshot; a correction is another review. */
async function addGwsReview(conn, { entityId, userId, body }) {
  return guardedWrite('gws', async () => {
    if (body.reviewedOn > wibToday()) throw new RegisterError('DATE_IN_FUTURE', 'Tanggal review tidak boleh di masa depan', 400, { field: 'reviewedOn' });
    if (body.superAdmins > body.activeUsers) throw new RegisterError('VALIDATION_ERROR', 'Super admin tidak boleh lebih banyak dari pengguna aktif', 400, { field: 'superAdmins' });
    const departmentId = await peopleCultureDepartmentId(conn, entityId);
    const [ins] = await conn.query(
      `INSERT INTO it_gws_reviews (entity_id, department_id, reviewed_on, active_users, super_admins, mfa_enforced,
                                   external_sharing_restricted, shared_accounts_used, ex_users_active, reviewed_by, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, departmentId, body.reviewedOn, body.activeUsers, body.superAdmins, body.mfaEnforced ? 1 : 0,
        body.externalSharingRestricted ? 1 : 0, body.sharedAccountsUsed ? 1 : 0, body.exUsersActive || 0, userId,
        cleanNotes(body.notes), userId, userId],
    );
    await logWith(conn, {
      entityId, userId, action: 'it_gws_review.create', subjectType: 'it_gws_review', subjectId: Number(ins.insertId),
      metadata: {
        reviewedOn: body.reviewedOn, activeUsers: body.activeUsers, superAdmins: body.superAdmins,
        mfaEnforced: Boolean(body.mfaEnforced), externalSharingRestricted: Boolean(body.externalSharingRestricted),
        sharedAccountsUsed: Boolean(body.sharedAccountsUsed), exUsersActive: body.exUsersActive || 0,
      },
    });
    return Number(ins.insertId);
  });
}

// ------------------------------------------------------------ phone line holder
/**
 * Hands a company line to a directory person or a team label (status Aktif),
 * or takes it back (holder null → Cadangan). Exported for the HRGA
 * onboarding/offboarding actions "Serahkan / terima kembali nomor", which call
 * it on their own connection and transaction.
 */
async function setPhoneLineHolder(conn, {
  entityId, userId, id, personId: personIdIn = null, accountUserId = null, holderLabel = null, version, source = null,
}) {
  return guardedWrite('phone', async () => {
    let personId = personIdIn;
    // An app account without its own directory row gets one (as devices do),
    // so the line is always held by a directory person.
    if (!personId && accountUserId) {
      const directory = require('./peopleDirectory.service');
      const person = await directory.ensurePersonForUser(conn, entityId, accountUserId, userId, { create: true });
      if (!person) throw new RegisterError('PERSON_INVALID', 'Akun tidak ditemukan di perusahaan ini', 400, { field: 'personId' });
      personId = person.id;
    }
    const row = await lockRow(conn, entityId, 'phone', id);
    if (version !== undefined && version !== null && Number(row.version) !== Number(version)) throw versionConflict();
    if (row.status === 'terminated') throw new RegisterError('LINE_TERMINATED', 'Nomor ini sudah berhenti', 409);
    const label = clean(holderLabel);
    if (personId && label) throw new RegisterError('VALIDATION_ERROR', 'Pilih satu pemegang: orang di direktori atau nama tim', 400);
    if (personId) {
      const [[person]] = await conn.query(
        'SELECT id, kind, status FROM people_directory WHERE id = ? AND entity_id = ? LIMIT 1',
        [personId, entityId],
      );
      if (!person) throw new RegisterError('PERSON_INVALID', 'Orang tidak ditemukan di direktori perusahaan ini', 400, { field: 'personId' });
      if (person.kind === 'excluded') throw new RegisterError('PERSON_EXCLUDED', 'Orang ini dikecualikan dari direktori', 409, { field: 'personId' });
      if (person.status === 'resigned') throw new RegisterError('PERSON_RESIGNED', 'Orang ini sudah resign', 409, { field: 'personId' });
    }
    const nextStatus = personId || label ? 'active' : 'spare';
    const before = { personId: int(row.person_id), holderLabel: row.holder_label || null, status: row.status };
    const after = { personId: personId ? Number(personId) : null, holderLabel: label, status: nextStatus };
    await conn.query(
      `UPDATE it_phone_lines
          SET person_id = ?, holder_label = ?, status = ?${row.status !== nextStatus ? ', status_changed_at = CURRENT_TIMESTAMP' : ''},
              updated_by = ?, version = version + 1
        WHERE id = ? AND entity_id = ?`,
      [after.personId, label, nextStatus, userId, id, entityId],
    );
    await logWith(conn, {
      entityId, userId, action: 'it_phone_line.holder', subjectType: 'it_phone_line', subjectId: Number(id),
      metadata: { before, after, ...(source ? { source } : {}) },
    });
    return { id: Number(id), ...after, version: Number(row.version) + 1 };
  });
}

/** The person's active company lines — number and extension only (directory profile, every viewer). */
async function companyLinesForPerson(db, entityId, personId) {
  const [rows] = await db.query(
    `SELECT p.id, p.kind, p.number, p.extension FROM it_phone_lines p
      WHERE p.entity_id = ? AND p.person_id = ? AND p.status = 'active'
      ORDER BY p.kind ASC, p.id ASC`,
    [entityId, personId],
  );
  return rows.map((r) => ({
    id: Number(r.id), kind: r.kind, kindLabel: PHONE_KIND_LABELS[r.kind] || r.kind, number: r.number || null, extension: r.extension || null,
  }));
}

// ------------------------------------------------------------ vendors (IT vendor tab)
async function listVendors(db, entityId) {
  const [rows] = await db.query(
    `SELECT v.id, v.name, v.vendor_kind, v.contact_person, v.email, v.phone, v.portal_url, v.notes,
            (SELECT COUNT(*) FROM it_isp_links l WHERE l.entity_id = v.entity_id AND l.vendor_id = v.id) AS isp_links
       FROM software_vendors v
      WHERE v.entity_id = ? AND v.deleted_at IS NULL
      ORDER BY v.vendor_kind ASC, v.name ASC`,
    [entityId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    vendorKind: r.vendor_kind,
    vendorKindLabel: VENDOR_KIND_LABELS[r.vendor_kind] || r.vendor_kind,
    contactPerson: r.contact_person || null,
    email: r.email || null,
    phone: r.phone || null,
    portalUrl: r.portal_url || null,
    notes: r.notes || null,
    ispLinks: Number(r.isp_links || 0),
  }));
}

// ------------------------------------------------------------ summary and dashboard block
/**
 * The "Infrastruktur" block of the IT dashboard and the register's tab counts.
 * Never an IP address, a cost or a serial number (§4.2). A register with no
 * row reports total 0, so the page leaves its card out.
 */
async function infrastructureBlock(db, entityId) {
  const [[cctv]] = await db.query(
    `SELECT COUNT(*) AS total,
            SUM(c.status <> 'retired') AS systems,
            SUM(CASE WHEN c.status <> 'retired' THEN c.camera_count ELSE 0 END) AS cameras,
            SUM(c.status IN ('offline', 'partial')) AS not_online,
            SUM(CASE WHEN c.status IN ('offline', 'partial') THEN c.cameras_offline ELSE 0 END) AS cameras_offline
       FROM it_cctv_systems c WHERE c.entity_id = ?`,
    [entityId],
  );
  const [[isp]] = await db.query(
    `SELECT COUNT(*) AS total,
            SUM(l.status = 'active') AS active,
            SUM(CASE WHEN l.status = 'active' AND l.is_backup = 0 THEN COALESCE(l.bandwidth_mbps, 0) ELSE 0 END) AS primary_mbps,
            COUNT(DISTINCT CASE WHEN l.status = 'active' AND l.is_backup = 0 AND NOT EXISTS (
              SELECT 1 FROM it_isp_links bk WHERE bk.entity_id = l.entity_id AND bk.location_id = l.location_id
                 AND bk.status = 'active' AND bk.is_backup = 1) THEN l.location_id END) AS without_backup,
            SUM(l.status = 'active' AND l.contract_end IS NOT NULL
                AND l.contract_end <= ${WIB_TODAY} + INTERVAL ${ISP_CONTRACT_WINDOW_DAYS} DAY) AS contracts_ending
       FROM it_isp_links l WHERE l.entity_id = ?`,
    [entityId],
  );
  const [[backup]] = await db.query(
    `SELECT COUNT(*) AS total,
            SUM(b.status = 'active') AS active,
            SUM(${BACKUP_FAILING('b')}) AS failing,
            SUM(${BACKUP_OVERDUE('b')} AND NOT ${BACKUP_FAILING('b')}) AS overdue,
            SUM(b.status = 'active' AND b.restore_tested_on IS NULL) AS restore_untested
       FROM it_backup_jobs b WHERE b.entity_id = ?`,
    [entityId],
  );
  const [[network]] = await db.query(
    `SELECT COUNT(*) AS total, SUM(n.status = 'active') AS active, SUM(n.status = 'damaged') AS damaged
       FROM it_network_devices n WHERE n.entity_id = ?`,
    [entityId],
  );
  const [[phone]] = await db.query(
    `SELECT COUNT(*) AS total, SUM(p.status = 'active') AS active, SUM(p.status = 'spare') AS spare
       FROM it_phone_lines p WHERE p.entity_id = ?`,
    [entityId],
  );
  const [gwsRows] = await db.query(
    `SELECT g.*, NULL AS reviewed_by_name FROM it_gws_reviews g WHERE g.entity_id = ?
      ORDER BY g.reviewed_on DESC, g.id DESC LIMIT 1`,
    [entityId],
  );
  const [[vendors]] = await db.query(
    "SELECT COUNT(*) AS total, SUM(v.vendor_kind <> 'software') AS infra FROM software_vendors v WHERE v.entity_id = ? AND v.deleted_at IS NULL",
    [entityId],
  );
  const n = (v) => Number(v || 0);
  const latest = gwsRows[0]?.reviewed_on ? shapeGws(gwsRows[0]) : null;
  return {
    network: { total: n(network?.total), active: n(network?.active), damaged: n(network?.damaged) },
    isp: {
      total: n(isp?.total), active: n(isp?.active), primaryMbps: n(isp?.primary_mbps),
      locationsWithoutBackup: n(isp?.without_backup), contractsEnding: n(isp?.contracts_ending), contractWindowDays: ISP_CONTRACT_WINDOW_DAYS,
    },
    cctv: {
      total: n(cctv?.total), systems: n(cctv?.systems), cameras: n(cctv?.cameras),
      systemsNotOnline: n(cctv?.not_online), camerasOffline: n(cctv?.cameras_offline),
    },
    backup: {
      total: n(backup?.total), active: n(backup?.active), failing: n(backup?.failing),
      overdue: n(backup?.overdue), restoreUntested: n(backup?.restore_untested),
    },
    gws: latest ? {
      total: 1,
      reviewedOn: latest.reviewedOn,
      mfaEnforced: latest.mfaEnforced,
      superAdmins: latest.superAdmins,
      riskFlags: latest.riskFlags.length,
      overdue: latest.riskFlags.some((f) => f.key === 'overdue'),
    } : { total: 0 },
    phone: { total: n(phone?.total), active: n(phone?.active), spare: n(phone?.spare) },
    vendors: { total: n(vendors?.total), infra: n(vendors?.infra) },
  };
}

module.exports = {
  RegisterError, REGISTERS, SELECTS, SHAPES,
  normalizePhone, normalizeExtension, normalizeIp, redactIp, clean, cleanNotes, isoDate, wibToday,
  peopleCultureDepartmentId, listRows, getRow, createRow, updateRow, setCctvStatus,
  listBackupChecks, addBackupCheck, listGwsReviews, addGwsReview, gwsRiskFlags,
  setPhoneLineHolder, companyLinesForPerson, listVendors, infrastructureBlock,
  BACKUP_DUE_ON, BACKUP_OVERDUE, BACKUP_FAILING, WIB_TODAY,
};
