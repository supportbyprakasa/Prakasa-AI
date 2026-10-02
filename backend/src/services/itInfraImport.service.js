const { logWith } = require('./activityLog.service');
const { looksSecret } = require('./secretText');
const registers = require('./itRegisters.service');
const {
  IMPORT_COLUMNS, NETWORK_TYPE_LABELS, NETWORK_STATUS_LABELS, CCTV_RECORDER_LABELS,
  REPORT_NETWORK_TYPE_MAP, REPORT_NETWORK_STATUS_MAP, REPORT_RECORDER_MAP, YES, NO,
} = require('../config/itInfra');

// Import of the owner's IT report into the infrastructure registers
// (docs/rancangan-people-culture-g2.md §4.3). The browser has already read
// the .xlsx, kept ONLY the allow-listed columns and sent rows as JSON; the
// route's strict zod schema refused any other key. Here:
//   - each row is normalised (report words → register values); a cell that
//     looks like a written-down password is dropped with a warning;
//   - the report has no company column, so the user maps every "Lokasi" text
//     to a location of the signed-in user's entity (or skips it); the mapping
//     is re-validated against the entity, and skipped rows are counted per text;
//   - each row gets an action: new / exists / different (with field diffs) /
//     skip, by identity — network: serial, else (location, type, IP), else
//     (location, type, brand/model); ISP: (location, provider, customer no.);
//     CCTV: serial, else (location, recorder, model);
//   - apply recomputes the same plan inside one transaction, creates the new
//     rows and changes an existing row only when its key is ticked in
//     `updates`. Re-importing the same file changes nothing.
// Nothing here reads, keeps or logs a password column: none can arrive.

const KIND_ORDER = ['isp', 'network', 'cctv'];
const NOTES_MAX = 500;

const text = (v) => {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || null;
};
const lower = (v) => (text(v) || '').toLowerCase();
const issue = (level, code, message) => ({ level, code, message });

function yesNo(value) {
  if (typeof value === 'boolean') return value;
  const s = lower(value);
  if (!s) return null;
  if (YES.includes(s)) return true;
  if (NO.includes(s)) return false;
  return undefined; // not a yes/no answer
}

function isoFromCell(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (d) return `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
  return null;
}

function joinNotes(parts, issues) {
  const joined = parts.filter(Boolean).join('\n');
  if (!joined) return null;
  if (joined.length > NOTES_MAX) {
    issues.push(issue('warning', 'NOTES_CUT', `Catatan dipotong menjadi ${NOTES_MAX} karakter`));
    return joined.slice(0, NOTES_MAX);
  }
  return joined;
}

// Drops every cell that looks like a written-down password (the browser does
// the same; the server never trusts that it did).
function dropSecrets(row, issues) {
  const out = {};
  for (const [field, value] of Object.entries(row)) {
    if (field !== 'rowNumber' && typeof value === 'string' && looksSecret(value)) {
      issues.push(issue('warning', 'SECRET_DROPPED', 'Catatan berisi kata sandi — tidak diimpor'));
      out[field] = null;
    } else out[field] = value;
  }
  return out;
}

// ------------------------------------------------------------ normalisation per kind
function normalizeNetwork(raw, issues) {
  const notes = [];
  const typeText = text(raw.deviceType) || '';
  const code = typeText.match(/\(([^)]+)\)\s*$/);
  const base = typeText.replace(/\([^)]*\)\s*$/, '').trim();
  let deviceType = REPORT_NETWORK_TYPE_MAP[base.toLowerCase()] || null;
  if (!base) issues.push(issue('error', 'TYPE_MISSING', 'Tipe perangkat kosong'));
  else if (!deviceType) {
    deviceType = 'other';
    issues.push(issue('info', 'TYPE_OTHER', `Tipe "${base}" dicatat sebagai Lainnya`));
    notes.push(`Tipe di laporan: ${base}`);
  }
  if (code) notes.push(`Kode: ${code[1].trim()}`);
  const brandModel = text(raw.brandModel);
  if (!brandModel) issues.push(issue('error', 'BRAND_MISSING', 'Merek / model kosong — lengkapi di file atau tambahkan manual'));
  let ipAddress = null;
  if (text(raw.ipAddress)) {
    // A cell may hold two addresses (LAN / WAN): the first valid one is kept.
    const parts = String(raw.ipAddress).split(/[\s/,;]+/).filter(Boolean);
    const valid = parts.filter((p) => { try { return Boolean(registers.normalizeIp(p)); } catch { return false; } });
    if (valid.length) ipAddress = registers.normalizeIp(valid[0]);
    if (!valid.length) issues.push(issue('warning', 'IP_INVALID', 'Alamat IP tidak valid — tidak diimpor'));
    else if (parts.length > 1) issues.push(issue('warning', 'IP_EXTRA', 'Sel berisi lebih dari satu alamat IP — hanya yang pertama diimpor, catat yang lain manual'));
  }
  let installedYear = null;
  if (raw.installedYear !== null && raw.installedYear !== undefined && text(raw.installedYear)) {
    const y = Number(String(raw.installedYear).trim());
    if (Number.isInteger(y) && y >= 1990 && y <= 2100) installedYear = y;
    else issues.push(issue('warning', 'YEAR_INVALID', `Tahun pasang "${text(raw.installedYear)}" tidak dikenali — tidak diimpor`));
  }
  let firmwareUpdatedOn = null;
  if (text(raw.firmware)) {
    firmwareUpdatedOn = isoFromCell(raw.firmware);
    if (!firmwareUpdatedOn) notes.push(`Firmware: ${text(raw.firmware)}`);
  }
  let status = 'active';
  const statusText = lower(raw.status);
  if (!statusText) issues.push(issue('info', 'STATUS_DEFAULT', 'Status kosong — dicatat Aktif'));
  else if (REPORT_NETWORK_STATUS_MAP[statusText]) status = REPORT_NETWORK_STATUS_MAP[statusText];
  else issues.push(issue('warning', 'STATUS_UNKNOWN', `Status "${text(raw.status)}" tidak dikenali — dicatat Aktif`));
  const ispName = text(raw.ispName);
  const serialNumber = text(raw.serialNumber);
  return {
    fields: { deviceType, brandModel, serialNumber, ipAddress, installedYear, firmwareUpdatedOn, status },
    ispName,
    notesParts: [...notes, text(raw.notes) ? String(raw.notes).trim() : null],
  };
}

function parseBandwidth(value) {
  if (value === null || value === undefined) return { mbps: null };
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? { mbps: Math.round(value) } : { note: String(value) };
  const s = lower(value);
  if (!s) return { mbps: null };
  const m = s.replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(gbps|gb|g|mbps|mb|m)?$/);
  if (!m) return { note: text(value) };
  const n = Number(m[1]);
  return { mbps: Math.round(/^g/.test(m[2] || '') ? n * 1000 : n) };
}

function normalizeIsp(raw, issues) {
  const notes = [];
  const providerName = text(raw.provider);
  if (!providerName) issues.push(issue('error', 'PROVIDER_MISSING', 'Provider kosong'));
  let customerNumber = null;
  if (raw.customerNumber !== null && raw.customerNumber !== undefined) {
    customerNumber = typeof raw.customerNumber === 'number' ? String(Math.trunc(raw.customerNumber)) : text(raw.customerNumber);
  }
  const bw = parseBandwidth(raw.bandwidth);
  if (bw.note) { notes.push(`Bandwidth: ${bw.note}`); issues.push(issue('warning', 'BANDWIDTH_TEXT', 'Bandwidth tidak dikenali — dicatat di catatan')); }
  const flag = (value, label, field) => {
    const v = yesNo(value);
    if (v === undefined) { notes.push(`${label}: ${text(value)}`); issues.push(issue('warning', 'YES_NO', `${label} bukan Ya/Tidak — dicatat di catatan`)); return false; }
    return v === null ? false : v;
  };
  return {
    fields: {
      providerName,
      customerNumber,
      bandwidthMbps: bw.mbps ?? null,
      publicIpDedicated: flag(raw.dedicatedIp, 'IP publik dedicated', 'dedicatedIp'),
      isBackup: flag(raw.backupIsp, 'ISP cadangan', 'backupIsp'),
    },
    notesParts: [...notes, text(raw.notes) ? String(raw.notes).trim() : null],
  };
}

function normalizeCctv(raw, issues) {
  const notes = [];
  let cameraCount = null;
  const c = Number(typeof raw.cameraCount === 'string' ? raw.cameraCount.trim() : raw.cameraCount);
  if (raw.cameraCount === null || raw.cameraCount === undefined || raw.cameraCount === '' || !Number.isInteger(c) || c < 0 || c > 2000) {
    issues.push(issue('error', 'CAMERAS_MISSING', 'Jumlah kamera kosong atau bukan angka'));
  } else cameraCount = c;
  const recorderText = lower(raw.recorderType);
  let recorderType = REPORT_RECORDER_MAP[recorderText] || null;
  if (!recorderText) recorderType = 'none';
  else if (!recorderType) {
    recorderType = 'none';
    notes.push(`Perekam di laporan: ${text(raw.recorderType)}`);
    issues.push(issue('warning', 'RECORDER_UNKNOWN', `Perekam "${text(raw.recorderType)}" tidak dikenali — dicatat Tanpa perekam`));
  }
  const remote = yesNo(raw.remoteAccess);
  if (remote === undefined) notes.push(`Akses jarak jauh: ${text(raw.remoteAccess)}`);
  const same = yesNo(raw.sameNetworkAsPc);
  if (same === undefined) issues.push(issue('info', 'NETWORK_UNCONFIRMED', 'Satu jaringan dengan PC belum dipastikan'));
  return {
    fields: {
      cameraCount,
      cameraModel: text(raw.cameraModel),
      recorderType,
      serialNumber: text(raw.serialNumber),
      remoteAccess: remote === true,
      sameNetworkAsPc: same === undefined ? null : same,
    },
    notesParts: [...notes, text(raw.notes) ? String(raw.notes).trim() : null],
  };
}

const NORMALIZERS = { network: normalizeNetwork, isp: normalizeIsp, cctv: normalizeCctv };

// Identity of a row (file row or register row) per kind.
const serialKey = (s) => (text(s) ? text(s).toUpperCase() : null);
function identityOf(kind, f) {
  if (kind === 'network') {
    if (serialKey(f.serialNumber)) return { key: `s:${serialKey(f.serialNumber)}`, weak: false };
    if (f.ipAddress) return { key: `ip:${f.locationId}|${f.deviceType}|${f.ipAddress}`, weak: false };
    return { key: `bm:${f.locationId}|${f.deviceType}|${lower(f.brandModel)}`, weak: true };
  }
  if (kind === 'isp') return { key: `${f.locationId}|${lower(f.providerName)}|${lower(f.customerNumber)}`, weak: false };
  if (serialKey(f.serialNumber)) return { key: `s:${serialKey(f.serialNumber)}`, weak: false };
  return { key: `m:${f.locationId}|${f.recorderType}|${lower(f.cameraModel)}`, weak: false };
}

// Fields an import may set or compare, with the labels of the diff lines.
const COMPARED = {
  network: { locationId: 'Lokasi', deviceType: 'Tipe', brandModel: 'Merek / model', serialNumber: 'Nomor seri', ipAddress: 'Alamat IP', installedYear: 'Tahun pasang', ispLinkId: 'ISP terkait', firmwareUpdatedOn: 'Update firmware', status: 'Status', notes: 'Catatan' },
  isp: { locationId: 'Lokasi', providerName: 'Provider', customerNumber: 'No. pelanggan', bandwidthMbps: 'Bandwidth (Mbps)', publicIpDedicated: 'IP publik dedicated', isBackup: 'ISP cadangan', notes: 'Catatan' },
  cctv: { locationId: 'Lokasi', cameraCount: 'Jumlah kamera', cameraModel: 'Model', recorderType: 'DVR/NVR', recorderDeviceId: 'Perekam', serialNumber: 'Nomor seri', remoteAccess: 'Akses jarak jauh', sameNetworkAsPc: 'Satu jaringan dengan PC', notes: 'Catatan' },
};

const sameValue = (a, b) => {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '';
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a) === String(b);
};

function displayValue(kind, field, value, ctx) {
  if (value === null || value === undefined || value === '') return null;
  if (field === 'locationId') return ctx.locationName.get(Number(value)) || String(value);
  if (field === 'deviceType') return NETWORK_TYPE_LABELS[value] || value;
  if (field === 'status' && kind === 'network') return NETWORK_STATUS_LABELS[value] || value;
  if (field === 'recorderType') return CCTV_RECORDER_LABELS[value] || value;
  if (field === 'ispLinkId') return ctx.ispName.get(Number(value)) || `ISP #${value}`;
  if (field === 'recorderDeviceId') return ctx.recorderName.get(Number(value)) || `Perangkat #${value}`;
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  return String(value);
}

// ------------------------------------------------------------ plan
async function loadContext(db, entityId, locationMap, { lock = false } = {}) {
  const forUpdate = lock ? ' FOR UPDATE' : '';
  const [locations] = await db.query('SELECT id, name, is_active FROM org_locations WHERE entity_id = ?', [entityId]);
  const byId = new Map(locations.map((l) => [Number(l.id), l]));
  for (const [label, id] of Object.entries(locationMap || {})) {
    if (id === null || id === undefined) continue;
    const loc = byId.get(Number(id));
    if (!loc) throw new registers.RegisterError('LOCATION_INVALID', `Lokasi untuk "${label}" tidak ditemukan di perusahaan ini`, 400, { location: label });
    if (Number(loc.is_active) !== 1) throw new registers.RegisterError('LOCATION_INACTIVE', `Lokasi untuk "${label}" sudah nonaktif`, 400, { location: label });
  }
  const [network] = await db.query(`SELECT * FROM it_network_devices WHERE entity_id = ?${forUpdate}`, [entityId]);
  const [isp] = await db.query(`SELECT * FROM it_isp_links WHERE entity_id = ?${forUpdate}`, [entityId]);
  const [cctv] = await db.query(`SELECT * FROM it_cctv_systems WHERE entity_id = ?${forUpdate}`, [entityId]);
  return {
    locations,
    locationName: new Map(locations.map((l) => [Number(l.id), l.name])),
    existing: { network, isp, cctv },
    ispName: new Map(isp.map((r) => [Number(r.id), r.provider_name])),
    recorderName: new Map(network.map((r) => [Number(r.id), r.brand_model])),
  };
}

// A register row in the same body shape as a normalised file row.
function existingFields(kind, r) {
  const b = (v) => (v === null || v === undefined ? null : Number(v) === 1);
  const d = (v) => registers.isoDate(v);
  if (kind === 'network') {
    return {
      locationId: Number(r.location_id), deviceType: r.device_type, brandModel: r.brand_model, serialNumber: r.serial_number || null,
      ipAddress: r.ip_address || null, installedYear: r.installed_year != null ? Number(r.installed_year) : null,
      ispLinkId: r.isp_link_id != null ? Number(r.isp_link_id) : null, firmwareUpdatedOn: d(r.firmware_updated_on), status: r.status, notes: r.notes || null,
    };
  }
  if (kind === 'isp') {
    return {
      locationId: Number(r.location_id), providerName: r.provider_name, customerNumber: r.customer_number || null,
      bandwidthMbps: r.bandwidth_mbps != null ? Number(r.bandwidth_mbps) : null, publicIpDedicated: b(r.public_ip_dedicated), isBackup: b(r.is_backup), notes: r.notes || null,
    };
  }
  return {
    locationId: Number(r.location_id), cameraCount: Number(r.camera_count), cameraModel: r.camera_model || null, recorderType: r.recorder_type,
    recorderDeviceId: r.recorder_device_id != null ? Number(r.recorder_device_id) : null, serialNumber: r.serial_number || null,
    remoteAccess: b(r.remote_access), sameNetworkAsPc: b(r.same_network_as_pc), notes: r.notes || null,
  };
}

/**
 * Builds the per-row plan of one request (preview and apply share it).
 * body = { network?, isp?, cctv?, locationMap, updates? } (already zod-checked).
 */
function buildPlan(body, ctx) {
  const locationMap = body.locationMap || {};
  const mappedId = (label) => {
    const id = label ? locationMap[label] : undefined;
    return id === null || id === undefined ? null : Number(id);
  };
  const result = { rows: { network: [], isp: [], cctv: [] }, counts: {}, skippedByLocation: {} };
  // ISPs and recorders the file itself will create, so network rows and CCTV
  // rows can point at them (resolved to ids on apply).
  const fileIsp = new Map(); // `${locationId}|provider` → row key
  const fileRecorder = new Map(); // `${locationId}|SERIAL` → row key

  for (const kind of KIND_ORDER) {
    const seen = new Map();
    const existingByIdentity = new Map();
    for (const r of ctx.existing[kind]) {
      const f = existingFields(kind, r);
      existingByIdentity.set(identityOf(kind, f).key, { row: r, fields: f });
    }
    const counts = { rows: 0, new: 0, exists: 0, different: 0, skip: 0 };
    for (const raw of body[kind] || []) {
      const issues = [];
      const cleanRow = dropSecrets(raw, issues);
      const locationText = text(cleanRow.location);
      const key = `${kind}:${cleanRow.rowNumber}`;
      const out = { key, kind, rowNumber: cleanRow.rowNumber, locationText, action: 'new', issues, differences: [] };
      counts.rows += 1;
      const locationId = mappedId(locationText);
      if (!locationText) {
        out.action = 'skip';
        issues.push(issue('error', 'LOCATION_MISSING', 'Lokasi kosong'));
      } else if (locationId === null) {
        out.action = 'skip';
        issues.push(issue('info', 'NOT_MAPPED', 'Lokasi tidak dipetakan ke lokasi perusahaan ini — dilewati'));
        result.skippedByLocation[locationText] = (result.skippedByLocation[locationText] || 0) + 1;
      }
      const norm = NORMALIZERS[kind](cleanRow, issues);
      const fields = { locationId, ...norm.fields };
      const notesParts = [...norm.notesParts];
      if (kind === 'network' && norm.ispName && locationId !== null) {
        const match = ctx.existing.isp.find((r) => Number(r.location_id) === locationId && lower(r.provider_name) === lower(norm.ispName));
        if (match) fields.ispLinkId = Number(match.id);
        else if (fileIsp.has(`${locationId}|${lower(norm.ispName)}`)) out.ispRowKey = fileIsp.get(`${locationId}|${lower(norm.ispName)}`);
        else { fields.ispLinkId = null; notesParts.unshift(`ISP terkait: ${norm.ispName}`); }
      }
      if (kind === 'cctv' && serialKey(fields.serialNumber) && locationId !== null) {
        const match = ctx.existing.network.find((r) => Number(r.location_id) === locationId && serialKey(r.serial_number) === serialKey(fields.serialNumber));
        if (match) fields.recorderDeviceId = Number(match.id);
        else if (fileRecorder.has(`${locationId}|${serialKey(fields.serialNumber)}`)) out.recorderRowKey = fileRecorder.get(`${locationId}|${serialKey(fields.serialNumber)}`);
      }
      fields.notes = joinNotes(notesParts, issues);
      out.fields = fields;
      if (out.action !== 'skip' && issues.some((i) => i.level === 'error')) out.action = 'skip';
      if (out.action !== 'skip') {
        const identity = identityOf(kind, fields);
        if (identity.weak) issues.push(issue('warning', 'NO_SERIAL', 'Tanpa nomor seri, periksa manual'));
        if (seen.has(identity.key)) {
          out.action = 'skip';
          issues.push(issue('warning', 'DUPLICATE_IN_FILE', `Sama dengan baris ${seen.get(identity.key)} di file — dilewati`));
        } else {
          seen.set(identity.key, cleanRow.rowNumber);
          const existing = existingByIdentity.get(identity.key);
          if (existing) {
            out.matchId = Number(existing.row.id);
            out.version = Number(existing.row.version);
            for (const [field, label] of Object.entries(COMPARED[kind])) {
              const incoming = fields[field];
              // An empty cell in the file is "no information", never "clear it".
              if (incoming === null || incoming === undefined || incoming === '') continue;
              if (field === 'ispLinkId' || field === 'recorderDeviceId') { if (incoming === undefined) continue; }
              const current = existing.fields[field];
              if (!sameValue(incoming, current)) {
                out.differences.push({
                  field, label, current: displayValue(kind, field, current, ctx), incoming: displayValue(kind, field, incoming, ctx),
                });
              }
            }
            out.action = out.differences.length ? 'different' : 'exists';
          } else if (kind === 'isp') {
            fileIsp.set(`${locationId}|${lower(fields.providerName)}`, key);
          } else if (kind === 'network' && ['nvr', 'dvr'].includes(fields.deviceType) && serialKey(fields.serialNumber)) {
            fileRecorder.set(`${locationId}|${serialKey(fields.serialNumber)}`, key);
          }
        }
      }
      counts[out.action] += 1;
      result.rows[kind].push(out);
    }
    result.counts[kind] = counts;
  }
  return result;
}

// What the preview sends back per row: display fields only.
function previewRow(row, ctx) {
  const f = row.fields || {};
  return {
    key: row.key,
    kind: row.kind,
    rowNumber: row.rowNumber,
    action: row.action,
    locationText: row.locationText,
    locationName: f.locationId ? ctx.locationName.get(f.locationId) || null : null,
    summary: summaryOf(row.kind, f),
    fields: f,
    issues: row.issues,
    differences: row.differences,
  };
}

function summaryOf(kind, f) {
  if (kind === 'network') return [NETWORK_TYPE_LABELS[f.deviceType] || f.deviceType, f.brandModel, f.serialNumber].filter(Boolean).join(' · ');
  if (kind === 'isp') return [f.providerName, f.bandwidthMbps != null ? `${f.bandwidthMbps} Mbps` : null, f.isBackup ? /* i18n */ 'cadangan' : null].filter(Boolean).join(' · ');
  return [`${f.cameraCount ?? '?'} kamera`, CCTV_RECORDER_LABELS[f.recorderType] || f.recorderType, f.cameraModel].filter(Boolean).join(' · ');
}

async function preview(db, entityId, body) {
  const ctx = await loadContext(db, entityId, body.locationMap);
  const plan = buildPlan(body, ctx);
  return {
    rows: Object.fromEntries(KIND_ORDER.map((kind) => [kind, plan.rows[kind].map((r) => previewRow(r, ctx))])),
    counts: plan.counts,
    skippedByLocation: plan.skippedByLocation,
    locations: ctx.locations.filter((l) => Number(l.is_active) === 1).map((l) => ({ id: Number(l.id), name: l.name })),
  };
}

/** Apply: same plan, one transaction (the caller's conn), updates only for ticked keys. */
async function apply(conn, { entityId, userId, body }) {
  const ctx = await loadContext(conn, entityId, body.locationMap, { lock: true });
  const plan = buildPlan(body, ctx);
  const ticked = new Set(body.updates || []);
  const createdIds = new Map(); // row key → new id
  const out = {
    created: { network: 0, isp: 0, cctv: 0 }, updated: { network: 0, isp: 0, cctv: 0 }, unchanged: 0, skipped: 0, differentNotTicked: 0,
  };
  for (const kind of KIND_ORDER) {
    for (const row of plan.rows[kind]) {
      const fields = { ...row.fields };
      if (row.ispRowKey) fields.ispLinkId = createdIds.get(row.ispRowKey) ?? null;
      if (row.recorderRowKey) fields.recorderDeviceId = createdIds.get(row.recorderRowKey) ?? null;
      if (row.action === 'skip') { out.skipped += 1; continue; }
      if (row.action === 'exists') { out.unchanged += 1; continue; }
      if (row.action === 'different') {
        if (!ticked.has(row.key)) { out.differentNotTicked += 1; out.unchanged += 1; continue; }
        const patch = { version: row.version };
        for (const d of row.differences) patch[d.field] = fields[d.field];
        await registers.updateRow(conn, { entityId, userId, key: kind, id: row.matchId, body: patch });
        out.updated[kind] += 1;
        continue;
      }
      const body2 = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      const id = await registers.createRow(conn, { entityId, userId, key: kind, body: body2 });
      createdIds.set(row.key, id);
      out.created[kind] += 1;
    }
  }
  await logWith(conn, {
    entityId, userId, action: 'it_infra.import', subjectType: 'entity', subjectId: entityId,
    metadata: { ...out, skippedByLocation: plan.skippedByLocation },
  });
  return { ...out, skippedByLocation: plan.skippedByLocation };
}

module.exports = {
  preview, apply, buildPlan, loadContext, identityOf, parseBandwidth, yesNo, normalizeNetwork, normalizeIsp, normalizeCctv, IMPORT_COLUMNS,
};
