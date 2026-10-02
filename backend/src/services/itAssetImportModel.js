const crypto = require('node:crypto');
const {
  REPORT_DEVICE_COLUMNS, REPORT_PEOPLE_COLUMNS, REPORT_TYPE_MAP, REPORT_STATUS_MAP,
  REPORT_PEOPLE_STATUS_MAP, REPORT_SUMMARY_LABELS, CREDENTIAL_HEADER_RE, DEVICE_TYPE_LABELS,
  DEVICE_STATUS_LABELS,
} = require('../config/itAssets');
const { checkWorkEmail } = require('./workEmail');

// The owner's device report → a plan (pure: no database; the service supplies
// what the entity already holds). People & Culture wave 1, rules 8, 10, 15, 16, 18.
//
// Only the report's own layout is read: sheet "Device Inventory" (columns
// REPORT_DEVICE_COLUMNS) and the hidden "User List" (REPORT_PEOPLE_COLUMNS),
// each sent by the browser as a matrix of cell values. Columns are found by
// their exact header text; any other column is ignored, and a column whose
// header contains password/sandi/username/credential is never read at all.
// Rows of another company are only counted, never listed.

const MAX_ROWS = 5000;
const HEADER_SCAN_ROWS = 30;

class ImportError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// ------------------------------------------------------------------ cells

const normHeader = (h) => String(h ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** A cell as text: trimmed, inner whitespace collapsed; '-', '#N/A' and '' are empty. Whole floats lose ".0". */
function cellText(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return Number.isInteger(v) ? String(v) : String(v);
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s || s === '-' || s === '–' || /^#n\/a$/i.test(s)) return null;
  return s;
}

const nameKey = (v) => (cellText(v) || '').toLowerCase();
const limit = (s, n) => (s && s.length > n ? s.slice(0, n) : s);

function yearOf(v, currentYear) {
  const s = cellText(v);
  if (!s) return { year: null };
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { year: null, invalid: s };
  if (n < 1990 || n > currentYear + 1) return { year: null, invalid: s };
  return { year: n };
}

// ------------------------------------------------------------------ sheets

/**
 * Finds the header row (the first of the top rows holding every required
 * header) and maps each known column to its index by exact header text.
 */
function locateHeader(matrix, columns, sheetLabel) {
  if (!Array.isArray(matrix) || !matrix.length) {
    throw new ImportError('IMPORT_SHEET_EMPTY', `Sheet "${sheetLabel}" kosong.`);
  }
  if (matrix.length > MAX_ROWS) {
    throw new ImportError('IMPORT_TOO_MANY_ROWS', `Sheet "${sheetLabel}" lebih dari ${MAX_ROWS} baris.`);
  }
  const required = columns.filter((c) => c.required).map((c) => normHeader(c.header));
  for (let r = 0; r < Math.min(HEADER_SCAN_ROWS, matrix.length); r += 1) {
    const row = Array.isArray(matrix[r]) ? matrix[r] : [];
    const headers = row.map(normHeader);
    if (!required.every((h) => headers.includes(h))) continue;
    const index = {};
    const credentialColumns = [];
    const ignoredColumns = [];
    headers.forEach((h, i) => {
      if (!h) return;
      if (CREDENTIAL_HEADER_RE.test(h)) { credentialColumns.push(String(row[i]).trim()); return; }
      const column = columns.find((c) => normHeader(c.header) === h);
      if (column && index[column.field] === undefined) index[column.field] = i;
      else if (!column) ignoredColumns.push(String(row[i]).trim());
    });
    return { headerRow: r, index, credentialColumns, ignoredColumns };
  }
  const names = columns.filter((c) => c.required).map((c) => `"${c.header}"`).join(', ');
  throw new ImportError('IMPORT_HEADER_NOT_FOUND', `Kolom ${names} tidak ditemukan di sheet "${sheetLabel}". Gunakan laporan perangkat IT (sheet "Device Inventory" dan "User List").`);
}

// Reads only the mapped columns of a row — never a credential column.
function readRow(row, index) {
  const out = {};
  for (const [field, i] of Object.entries(index)) out[field] = Array.isArray(row) ? row[i] : undefined;
  return out;
}

const isSummaryRow = (raw) => {
  const type = nameKey(raw.type);
  const no = nameKey(raw.no);
  return REPORT_SUMMARY_LABELS.includes(type) || REPORT_SUMMARY_LABELS.includes(no);
};

function parseDeviceSheet(matrix, entityCode, { currentYear = new Date().getUTCFullYear() } = {}) {
  const header = locateHeader(matrix, REPORT_DEVICE_COLUMNS, 'Device Inventory');
  const code = String(entityCode || '').trim().toUpperCase();
  const rows = [];
  const skipped = { summary: 0, empty: 0, otherCompany: {}, missingCompany: 0 };
  for (let r = header.headerRow + 1; r < matrix.length; r += 1) {
    const raw = readRow(matrix[r], header.index);
    const values = Object.values(raw).map(cellText).filter(Boolean);
    if (!values.length) { skipped.empty += 1; continue; }
    if (isSummaryRow(raw)) { skipped.summary += 1; continue; }
    const company = (cellText(raw.company) || '').toUpperCase();
    if (!company) {
      // A row without a type and company is a note or a total under the table.
      if (!cellText(raw.type)) { skipped.summary += 1; continue; }
      skipped.missingCompany += 1;
      continue;
    }
    if (company !== code) {
      skipped.otherCompany[company] = (skipped.otherCompany[company] || 0) + 1;
      continue;
    }
    rows.push({ key: `d:${r + 1}`, rowNumber: r + 1, ...mapDeviceRow(raw, currentYear) });
  }
  return { header, rows, skipped };
}

function mapDeviceRow(raw, currentYear) {
  const issues = [];
  const typeText = cellText(raw.type);
  let deviceType = REPORT_TYPE_MAP[nameKey(raw.type)] || null;
  const noteParts = [];
  if (!typeText) issues.push({ level: 'error', code: 'TYPE_MISSING', message: 'Tipe perangkat kosong' });
  else if (!deviceType) {
    deviceType = 'other';
    noteParts.push(`Tipe di laporan: ${typeText}`);
    issues.push({ level: 'warning', code: 'TYPE_UNKNOWN', message: `Tipe "${typeText}" tidak dikenal — dicatat sebagai Lainnya` });
  }
  const statusText = cellText(raw.status);
  const status = REPORT_STATUS_MAP[nameKey(raw.status)] || null;
  if (!status) issues.push({ level: 'error', code: 'STATUS_UNKNOWN', message: statusText ? `Status "${statusText}" tidak dikenal` : 'Status kosong' });
  const serial = cellText(raw.serial) ? limit(cellText(raw.serial).toUpperCase(), 150) : null;
  const assetCode = limit(cellText(raw.assetCode), 80);
  const model = limit(cellText(raw.model), 150);
  const year = yearOf(raw.purchaseYear, currentYear);
  if (year.invalid) issues.push({ level: 'warning', code: 'YEAR_INVALID', message: `Tahun beli "${year.invalid}" tidak valid — dikosongkan` });
  const notes = cellText(raw.notes);
  if (notes) noteParts.push(notes);
  return {
    no: cellText(raw.no),
    reportType: typeText,
    reportStatus: statusText,
    deviceType,
    status,
    model,
    serial,
    assetCode,
    purchaseYear: year.year,
    holderText: limit(cellText(raw.holder), 150),
    locationText: limit(cellText(raw.location), 120),
    notes: noteParts.length ? limit(noteParts.join(' · '), 1000) : null,
    issues,
  };
}

function parsePeopleSheet(matrix, entityCode) {
  const header = locateHeader(matrix, REPORT_PEOPLE_COLUMNS, 'User List');
  const code = String(entityCode || '').trim().toUpperCase();
  const rows = [];
  const otherNames = new Map(); // name key → company, for holders of another company
  const skipped = { empty: 0, otherCompany: {}, missingCompany: 0 };
  for (let r = header.headerRow + 1; r < matrix.length; r += 1) {
    const raw = readRow(matrix[r], header.index);
    const values = Object.values(raw).map(cellText).filter(Boolean);
    if (!values.length) { skipped.empty += 1; continue; }
    const company = (cellText(raw.company) || '').toUpperCase();
    if (!company) { skipped.missingCompany += 1; continue; }
    if (company !== code) {
      skipped.otherCompany[company] = (skipped.otherCompany[company] || 0) + 1;
      if (nameKey(raw.name)) otherNames.set(nameKey(raw.name), company);
      continue;
    }
    const issues = [];
    const fullName = limit(cellText(raw.name), 150);
    if (!fullName) issues.push({ level: 'error', code: 'NAME_MISSING', message: 'Nama karyawan kosong' });
    const statusText = cellText(raw.status);
    const status = REPORT_PEOPLE_STATUS_MAP[nameKey(raw.status)] || null;
    if (!status) issues.push({ level: 'error', code: 'STATUS_UNKNOWN', message: statusText ? `Status "${statusText}" tidak dikenal` : 'Status kosong' });
    rows.push({
      key: `p:${r + 1}`,
      rowNumber: r + 1,
      no: cellText(raw.no),
      fullName,
      nameKey: nameKey(fullName),
      position: limit(cellText(raw.position), 150),
      status,
      reportStatus: statusText,
      emailText: cellText(raw.email),
      issues,
    });
  }
  return { header, rows, skipped, otherNames };
}

// ------------------------------------------------------------------ plan

const bucket = (map, key, value) => {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};

/**
 * context = {
 *   users:   [{ id, name, email, status, deleted }]  accounts of the entity
 *   people:  [{ id, user_id, full_name, work_email, position, status, kind, resigned_on_source }]
 *   locations: [{ id, name, is_active }]
 *   devices: [{ id, serial_key, device_type, model, asset_code, purchase_year, location_id,
 *               location_name, status, notes, holder_name }]
 * }
 */
function indexContext(context) {
  const usersByEmail = new Map();
  const usersByName = new Map();
  for (const u of context.users || []) {
    if (u.deleted) continue;
    if (u.email) usersByEmail.set(String(u.email).toLowerCase(), u);
    bucket(usersByName, nameKey(u.name), u);
  }
  const rowByUser = new Map();
  const peopleByEmail = new Map();
  const peopleByName = new Map();
  for (const p of context.people || []) {
    if (p.user_id != null) { rowByUser.set(Number(p.user_id), p); continue; }
    if (p.work_email) peopleByEmail.set(String(p.work_email).toLowerCase(), p);
    bucket(peopleByName, nameKey(p.full_name), p);
  }
  const locationsByName = new Map((context.locations || []).map((l) => [nameKey(l.name), l]));
  const devicesBySerial = new Map();
  const devicesByComposite = new Map();
  for (const d of context.devices || []) {
    if (d.serial_key) devicesBySerial.set(String(d.serial_key).toUpperCase(), d);
    else bucket(devicesByComposite, compositeKey(d.device_type, d.model, d.asset_code, d.status === 'assigned' ? d.holder_name : null), d);
  }
  return { usersByEmail, usersByName, rowByUser, peopleByEmail, peopleByName, locationsByName, devicesBySerial, devicesByComposite };
}

function compositeKey(type, model, assetCode, holder) {
  return [type || '', nameKey(model), nameKey(assetCode), nameKey(holder)].join('|');
}

function planPeople(parsed, idx, { personChoices = {}, env = process.env } = {}) {
  const seen = new Map();
  const rows = parsed.rows.map((row) => {
    const issues = [...row.issues];
    const out = {
      key: row.key, rowNumber: row.rowNumber, no: row.no,
      fullName: row.fullName, position: row.position, status: row.status, reportStatus: row.reportStatus,
      workEmail: null, emailDropped: false, action: 'skip', match: null, nameOnly: false, choices: null,
      target: null, differences: [], issues,
    };
    if (issues.some((i) => i.level === 'error')) return out;
    if (seen.has(row.nameKey)) {
      issues.push({ level: 'error', code: 'DUPLICATE_IN_FILE', message: `Nama sama dengan baris ${seen.get(row.nameKey)} di file` });
      return out;
    }
    seen.set(row.nameKey, row.rowNumber);

    if (row.emailText) {
      const checked = checkWorkEmail(row.emailText, env);
      if (checked.ok) out.workEmail = checked.email;
      else {
        out.emailDropped = true;
        issues.push({ level: 'warning', code: checked.code, message: `Email "${row.emailText}" tidak diimpor: ${checked.message}` });
      }
    }

    // Matching order (rule 8): work email → exact name → new.
    let user = out.workEmail ? idx.usersByEmail.get(out.workEmail) : null;
    let by = user ? 'email' : null;
    let person = !user && out.workEmail ? idx.peopleByEmail.get(out.workEmail) : null;
    if (person) by = 'email';
    if (!user && !person) {
      const users = idx.usersByName.get(row.nameKey) || [];
      const people = idx.peopleByName.get(row.nameKey) || [];
      if (users.length + people.length > 1) {
        issues.push({ level: 'error', code: 'NAME_AMBIGUOUS', message: `Nama cocok dengan ${users.length + people.length} orang di aplikasi — tambahkan/tautkan manual di direktori` });
        return out;
      }
      if (users.length === 1) { [user] = users; by = 'name'; }
      if (people.length === 1) { [person] = people; by = 'name'; }
    }

    if (user) {
      const own = idx.rowByUser.get(Number(user.id));
      out.match = { by, userId: Number(user.id), name: user.name, email: user.email, personId: own ? Number(own.id) : null };
      out.nameOnly = by === 'name';
      if (out.nameOnly) {
        out.choices = ['link', 'new'];
        issues.push({ level: 'info', code: 'NAME_MATCH', message: `Kemungkinan sama dengan akun "${user.name}" (${user.email})` });
        if (personChoices[row.key] === 'new') {
          out.action = 'new';
          out.target = { newPersonKey: row.key };
          return out;
        }
      }
      if (own) {
        out.action = 'exists';
        out.target = { userId: Number(user.id), personId: Number(own.id) };
        out.differences = personDifferences(own, out);
      } else {
        out.action = 'link';
        out.target = { userId: Number(user.id) };
      }
      return out;
    }
    if (person) {
      out.match = { by, userId: null, name: person.full_name, email: person.work_email || null, personId: Number(person.id) };
      out.action = 'exists';
      out.target = { personId: Number(person.id) };
      out.differences = personDifferences(person, out);
      return out;
    }
    out.action = 'new';
    out.target = { newPersonKey: row.key };
    return out;
  });
  return rows;
}

function personDifferences(current, incoming) {
  const diffs = [];
  if (incoming.position && (current.position || '') !== incoming.position) {
    diffs.push({ field: 'position', label: 'Jabatan', current: current.position || null, incoming: incoming.position });
  }
  if (incoming.status && current.status !== incoming.status) {
    diffs.push({ field: 'status', label: 'Status', current: current.status, incoming: incoming.status });
  }
  return diffs;
}

/** Resolves a report "User Name" to a holder (rule 8 order), or a team label. */
function resolveHolderText(text, idx, fileNew, otherNames) {
  const key = nameKey(text);
  if (text.includes('@')) {
    const email = text.toLowerCase();
    const user = idx.usersByEmail.get(email);
    if (user) return { kind: 'user', userId: Number(user.id), name: user.name, by: 'email', resigned: user.status !== 'active' };
    const person = idx.peopleByEmail.get(email);
    if (person) return { kind: 'person', personId: Number(person.id), name: person.full_name, by: 'email', resigned: person.status === 'resigned' };
  }
  const users = (idx.usersByName.get(key) || []);
  const people = (idx.peopleByName.get(key) || []).filter((p) => p.kind !== 'excluded');
  const planned = fileNew.get(key);
  const candidates = users.length + people.length + (planned ? 1 : 0);
  if (candidates > 1) {
    return { kind: 'label', label: text, name: text, ambiguous: candidates };
  }
  if (users.length === 1) {
    const u = users[0];
    return { kind: 'user', userId: Number(u.id), name: u.name, by: 'name', resigned: u.status !== 'active' };
  }
  if (people.length === 1) {
    const p = people[0];
    return { kind: 'person', personId: Number(p.id), name: p.full_name, by: 'name', resigned: p.status === 'resigned' };
  }
  if (planned) {
    return { kind: 'new_person', newPersonKey: planned.key, name: planned.fullName, by: 'file', resigned: planned.status === 'resigned' };
  }
  return { kind: 'label', label: text, name: text, otherCompany: otherNames.get(key) || null };
}

function planDevices(parsed, idx, peopleRows, otherNames, { createLocations = false } = {}) {
  // People of this file who will be new rows are holder candidates too (they are
  // applied first). Rows linked to an account resolve through the account.
  const fileNew = new Map();
  for (const p of peopleRows) if (p.action === 'new') fileNew.set(nameKey(p.fullName), p);

  const serialSeen = new Map();
  const compositeUsed = new Map();
  const newLocations = new Map();
  const assetCount = new Map();
  for (const row of parsed.rows) if (row.assetCode) assetCount.set(nameKey(row.assetCode), (assetCount.get(nameKey(row.assetCode)) || 0) + 1);

  const rows = parsed.rows.map((row) => {
    const issues = [...row.issues];
    const out = {
      key: row.key, rowNumber: row.rowNumber, no: row.no,
      reportType: row.reportType, reportStatus: row.reportStatus,
      deviceType: row.deviceType, deviceTypeLabel: row.deviceType ? DEVICE_TYPE_LABELS[row.deviceType] : null,
      model: row.model, serialNumber: row.serial, assetCode: row.assetCode, purchaseYear: row.purchaseYear,
      status: row.status, statusLabel: row.status ? DEVICE_STATUS_LABELS[row.status] : null,
      locationText: row.locationText, locationId: null, locationNew: false,
      holderText: row.holderText, holder: null, notes: row.notes,
      action: 'skip', existingDeviceId: null, differences: [], issues,
    };
    if (issues.some((i) => i.level === 'error')) return out;

    // Holder: only an Aktif device has one (an assignment row, rule 15).
    if (row.status === 'assigned') {
      if (!row.holderText) {
        out.status = 'available';
        out.statusLabel = DEVICE_STATUS_LABELS.available;
        issues.push({ level: 'warning', code: 'ACTIVE_WITHOUT_HOLDER', message: 'Status Active tanpa User Name — dicatat Cadangan' });
      } else {
        const holder = resolveHolderText(row.holderText, idx, fileNew, otherNames);
        out.holder = holder;
        if (holder.kind === 'label') {
          if (holder.ambiguous) issues.push({ level: 'warning', code: 'HOLDER_AMBIGUOUS', message: `"${row.holderText}" cocok dengan ${holder.ambiguous} orang — dicatat sebagai label, pilih pemegang manual` });
          else if (holder.otherCompany) issues.push({ level: 'warning', code: 'HOLDER_OTHER_COMPANY', message: `"${row.holderText}" terdaftar di entitas ${holder.otherCompany} — dicatat sebagai label` });
          else issues.push({ level: 'info', code: 'HOLDER_LABEL', message: `Pemakai "${row.holderText}" belum ada di direktori — dicatat sebagai label` });
        } else if (holder.resigned) {
          issues.push({ level: 'warning', code: 'HOLDER_RESIGNED', message: `Pemakai "${holder.name}" sudah resign` });
        }
      }
    } else if (row.holderText) {
      out.notes = limit([out.notes, `Pemakai di laporan: ${row.holderText}`].filter(Boolean).join(' · '), 1000);
      issues.push({ level: 'info', code: 'HOLDER_IGNORED', message: `${DEVICE_STATUS_LABELS[row.status]}: pemakai "${row.holderText}" dicatat di catatan, bukan sebagai pemegang` });
    }

    // Location.
    if (row.locationText) {
      const loc = idx.locationsByName.get(nameKey(row.locationText));
      if (loc) {
        out.locationId = Number(loc.id);
        if (!Number(loc.is_active)) issues.push({ level: 'warning', code: 'LOCATION_INACTIVE', message: `Lokasi "${loc.name}" berstatus nonaktif` });
      } else {
        newLocations.set(nameKey(row.locationText), row.locationText);
        if (createLocations) out.locationNew = true;
        else issues.push({ level: 'warning', code: 'LOCATION_NEW', message: `Lokasi "${row.locationText}" belum ada — centang "buat lokasi baru" atau perangkat tanpa lokasi` });
      }
    }

    // Asset code: not unique in the real data (rule 16) — warn, never refuse.
    if (row.assetCode) {
      const code = nameKey(row.assetCode);
      const inDb = [...idx.devicesBySerial.values(), ...[...idx.devicesByComposite.values()].flat()]
        .filter((d) => nameKey(d.asset_code) === code && (!row.serial || String(d.serial_key || '').toUpperCase() !== row.serial)).length;
      const total = (assetCount.get(code) || 0) + inDb;
      if (total > 1) issues.push({ level: 'warning', code: 'ASSET_CODE_SHARED', message: `Nomor aset ${row.assetCode} dipakai ${total} perangkat` });
    }

    // Identity (rule 16): serial number, else type + model + asset code + holder.
    let existing = null;
    if (row.serial) {
      if (serialSeen.has(row.serial)) {
        issues.push({ level: 'error', code: 'SERIAL_DUPLICATE_IN_FILE', message: `Nomor seri sama dengan baris ${serialSeen.get(row.serial)} di file` });
        return out;
      }
      serialSeen.set(row.serial, row.rowNumber);
      existing = idx.devicesBySerial.get(row.serial) || null;
    } else {
      issues.push({ level: 'warning', code: 'NO_SERIAL', message: 'Tanpa nomor seri, periksa manual' });
      const key = compositeKey(row.deviceType, row.model, row.assetCode, out.holder ? out.holder.name : null);
      const candidates = idx.devicesByComposite.get(key) || [];
      const used = compositeUsed.get(key) || 0;
      existing = candidates[used] || null;
      compositeUsed.set(key, used + 1);
    }

    if (existing) {
      out.action = 'exists';
      out.existingDeviceId = Number(existing.id);
      out.differences = deviceDifferences(existing, out);
    } else {
      out.action = 'new';
    }
    return out;
  });
  return { rows, newLocations: [...newLocations.values()] };
}

function deviceDifferences(current, incoming) {
  const diffs = [];
  const add = (field, label, cur, inc) => {
    if ((cur ?? null) === (inc ?? null)) return;
    diffs.push({ field, label, current: cur ?? null, incoming: inc ?? null });
  };
  if (incoming.deviceType && current.device_type !== incoming.deviceType) {
    add('deviceType', 'Tipe', DEVICE_TYPE_LABELS[current.device_type] || current.device_type, incoming.deviceTypeLabel);
  }
  if (incoming.model && nameKey(current.model) !== nameKey(incoming.model)) add('model', 'Merek / model', current.model || null, incoming.model);
  if (incoming.assetCode && nameKey(current.asset_code) !== nameKey(incoming.assetCode)) add('assetCode', 'No. aset', current.asset_code || null, incoming.assetCode);
  if (incoming.purchaseYear && Number(current.purchase_year) !== incoming.purchaseYear) add('purchaseYear', 'Tahun beli', current.purchase_year != null ? Number(current.purchase_year) : null, incoming.purchaseYear);
  if (incoming.locationText && nameKey(current.location_name) !== nameKey(incoming.locationText)) add('location', 'Lokasi', current.location_name || null, incoming.locationText);
  if (incoming.status && current.status !== incoming.status) add('status', 'Status', DEVICE_STATUS_LABELS[current.status] || current.status, incoming.statusLabel);
  const incomingHolder = incoming.holder ? incoming.holder.name : null;
  if (nameKey(current.status === 'assigned' ? current.holder_name : null) !== nameKey(incomingHolder)) {
    add('holder', 'Pemakai', current.status === 'assigned' ? current.holder_name || null : null, incomingHolder);
  }
  if (incoming.notes && nameKey(current.notes) !== nameKey(incoming.notes)) add('notes', 'Catatan', current.notes || null, incoming.notes);
  return diffs;
}

// ------------------------------------------------------------------ whole plan

function countBy(rows, pick) {
  const out = {};
  for (const r of rows) {
    const k = pick(r);
    if (k == null) continue;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/**
 * payload = { devices: matrix | null, people: matrix | null, createLocations, personChoices }
 * Returns the full preview: rows, counts and a fingerprint of everything apply
 * will do (apply recomputes it and refuses a different one).
 */
function buildPlan(payload, context, { entityCode, currentYear, env = process.env } = {}) {
  if (!payload.devices && !payload.people) {
    throw new ImportError('IMPORT_EMPTY', 'Tidak ada sheet yang dikirim. Pilih sheet "Device Inventory" dan/atau "User List".', 400);
  }
  const idx = indexContext(context);
  const peopleParsed = payload.people ? parsePeopleSheet(payload.people, entityCode) : null;
  const people = peopleParsed ? planPeople(peopleParsed, idx, { personChoices: payload.personChoices || {}, env }) : [];
  const otherNames = peopleParsed ? peopleParsed.otherNames : new Map();
  const devicesParsed = payload.devices ? parseDeviceSheet(payload.devices, entityCode, { currentYear }) : null;
  const devicePlan = devicesParsed
    ? planDevices(devicesParsed, idx, people, otherNames, { createLocations: Boolean(payload.createLocations) })
    : { rows: [], newLocations: [] };
  const devices = devicePlan.rows;

  const assetCodes = new Map();
  for (const d of devices) if (d.assetCode && d.action !== 'skip') assetCodes.set(nameKey(d.assetCode), { assetCode: d.assetCode, rows: [...(assetCodes.get(nameKey(d.assetCode))?.rows || []), d.rowNumber] });

  const counts = {
    devices: devicesParsed ? {
      rows: devices.length,
      new: devices.filter((d) => d.action === 'new').length,
      exists: devices.filter((d) => d.action === 'exists').length,
      updatable: devices.filter((d) => d.action === 'exists' && d.differences.length).length,
      skipped: devices.filter((d) => d.action === 'skip').length,
      byStatus: countBy(devices.filter((d) => d.action !== 'skip'), (d) => d.status),
      byType: countBy(devices.filter((d) => d.action !== 'skip'), (d) => d.deviceType),
      holders: countBy(devices.filter((d) => d.action !== 'skip' && d.holder), (d) => d.holder.kind),
      holderResigned: devices.filter((d) => d.holder && d.holder.resigned).length,
      withoutSerial: devices.filter((d) => d.action !== 'skip' && !d.serialNumber).length,
      withAssetCode: devices.filter((d) => d.action !== 'skip' && d.assetCode).length,
      sharedAssetCodes: [...assetCodes.values()].filter((a) => a.rows.length > 1),
      summaryRowsSkipped: devicesParsed.skipped.summary,
      emptyRowsSkipped: devicesParsed.skipped.empty,
      missingCompany: devicesParsed.skipped.missingCompany,
      otherCompany: devicesParsed.skipped.otherCompany,
    } : null,
    people: peopleParsed ? {
      rows: people.length,
      new: people.filter((p) => p.action === 'new').length,
      link: people.filter((p) => p.action === 'link').length,
      exists: people.filter((p) => p.action === 'exists').length,
      updatable: people.filter((p) => p.action === 'exists' && p.differences.length).length,
      skipped: people.filter((p) => p.action === 'skip').length,
      nameOnly: people.filter((p) => p.nameOnly).length,
      resigned: people.filter((p) => p.action !== 'skip' && p.status === 'resigned').length,
      emailsDropped: people.filter((p) => p.emailDropped).length,
      missingCompany: peopleParsed.skipped.missingCompany,
      otherCompany: peopleParsed.skipped.otherCompany,
    } : null,
  };

  const sheets = {
    devices: devicesParsed ? { credentialColumnsIgnored: devicesParsed.header.credentialColumns, otherColumnsIgnored: devicesParsed.header.ignoredColumns } : null,
    people: peopleParsed ? { credentialColumnsIgnored: peopleParsed.header.credentialColumns, otherColumnsIgnored: peopleParsed.header.ignoredColumns } : null,
  };

  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    entityCode,
    createLocations: Boolean(payload.createLocations),
    newLocations: devicePlan.newLocations,
    people: people.map((p) => [p.key, p.action, p.target, p.fullName, p.position, p.status, p.workEmail, p.differences]),
    devices: devices.map((d) => [d.key, d.action, d.existingDeviceId, d.deviceType, d.model, d.serialNumber, d.assetCode,
      d.purchaseYear, d.status, d.locationId, d.locationText, d.holder, d.notes, d.differences]),
  })).digest('hex');

  return {
    companyCode: entityCode,
    fingerprint,
    newLocations: devicePlan.newLocations,
    createLocations: Boolean(payload.createLocations),
    counts,
    sheets,
    people,
    devices,
  };
}

module.exports = {
  MAX_ROWS,
  ImportError,
  cellText,
  normHeader,
  nameKey,
  locateHeader,
  parseDeviceSheet,
  parsePeopleSheet,
  indexContext,
  compositeKey,
  planPeople,
  planDevices,
  resolveHolderText,
  deviceDifferences,
  buildPlan,
};
