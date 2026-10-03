// Reading the owner's IT device report in the browser and presenting the
// server's import preview (docs/rancangan-people-culture-g1.md rule 18,
// API contract §4). Pure: the import dialog and the tests import it.
//
// The browser sends each sheet as a raw matrix of cell values. Before that it
// drops every column whose header mentions a password, "sandi", a username or
// a credential — those values never leave the browser (the report holds WiFi
// passwords in plain text). "User Name" (with a space) is the device holder
// column and stays.
import { formatNumber } from '../../components/format.js';
import { DEVICE_STATUS_LABELS, DEVICE_TYPE_LABELS, HOLDER_KIND_LABELS } from './itModel.js';

export const SHEETS = {
  devices: { name: 'Device Inventory', required: ['Device Type', 'Company', 'Status'] },
  people: { name: 'User List', required: ['Employee Name', 'Entity', 'Status'] },
};

export const MAX_ROWS = 5000;
export const MAX_COLUMNS = 80;
export const MAX_CELL_TEXT = 1000;
// The API's JSON body limit is 1 MB; stay a little under it.
export const MAX_BODY_BYTES = 1000 * 1000 - 4096;

const CREDENTIAL = /password|sandi|username|credential/i;
export const isCredentialHeader = (text) => CREDENTIAL.test(String(text ?? ''));

const normalize = (text) => String(text ?? '').toLowerCase().replace(/\s+/g, '');
const isEmpty = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

// One cell as JSON can carry it: dates as ISO strings, long text cut to the
// server's limit, anything unknown as text.
export function cellValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim();
  if (!text) return null;
  return text.length > MAX_CELL_TEXT ? text.slice(0, MAX_CELL_TEXT) : text;
}

// The sheet of the file to read for `kind`: exact name first (case and spaces
// ignored), then a name that contains it. Hidden sheets are listed too.
export function pickSheet(names, kind) {
  const wanted = normalize(SHEETS[kind]?.name);
  const list = (names || []).map(String);
  return list.find((name) => normalize(name) === wanted) || list.find((name) => normalize(name).includes(wanted)) || '';
}

// Index of the header row: the first of the first 30 rows holding every
// required column name; -1 when there is none.
export function findHeaderRow(matrix, kind) {
  const required = (SHEETS[kind]?.required || []).map(normalize);
  const limit = Math.min((matrix || []).length, 30);
  for (let i = 0; i < limit; i += 1) {
    const cells = new Set((matrix[i] || []).map(normalize));
    if (required.every((name) => cells.has(name))) return i;
  }
  return -1;
}

// The matrix to send for one sheet, and what was left out:
//   credential columns — any column whose header cell (or, when no header row
//   is found, any cell of the first 10 rows) mentions a
//   password/sandi/username/credential;
//   trailing empty rows and columns; columns past the 80th.
// Blank rows inside the sheet stay, so the server's row numbers are the
// file's row numbers.
export function prepareSheet(rawMatrix, kind) {
  const matrix = (rawMatrix || []).map((row) => (Array.isArray(row) ? row.map(cellValue) : []));
  const headerRow = findHeaderRow(matrix, kind);
  const scanFrom = headerRow >= 0 ? headerRow : 0;
  const scanTo = headerRow >= 0 ? headerRow + 1 : Math.min(matrix.length, 10);
  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  const credentialColumns = [];
  const dropped = new Set();
  for (let col = 0; col < width; col += 1) {
    for (let r = scanFrom; r < scanTo; r += 1) {
      const text = matrix[r]?.[col];
      if (typeof text === 'string' && isCredentialHeader(text)) {
        dropped.add(col);
        credentialColumns.push(text);
        break;
      }
    }
  }
  let rows = matrix.map((row) => row.filter((_, col) => !dropped.has(col)));
  // Trailing empty cells of every row, then trailing empty rows.
  rows = rows.map((row) => {
    let end = row.length;
    while (end > 0 && isEmpty(row[end - 1])) end -= 1;
    return row.slice(0, end);
  });
  while (rows.length && !rows[rows.length - 1].length) rows.pop();
  const keptWidth = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const columnsCut = Math.max(0, keptWidth - MAX_COLUMNS);
  if (columnsCut) rows = rows.map((row) => row.slice(0, MAX_COLUMNS));
  return {
    matrix: rows,
    headerFound: headerRow >= 0,
    credentialColumns,
    columnsCut,
    rowCount: rows.length,
    tooManyRows: rows.length > MAX_ROWS,
  };
}

// Why a prepared sheet cannot be sent (null = fine).
export function sheetProblem(prepared, sheetName) {
  if (!prepared) return null;
  if (!prepared.rowCount) return `Sheet "${sheetName}" kosong.`;
  if (prepared.tooManyRows) return `Sheet "${sheetName}" lebih dari ${formatNumber(MAX_ROWS)} baris.`;
  return null;
}

export const bodyBytes = (body) => new TextEncoder().encode(JSON.stringify(body)).length;
export const bodyTooLarge = (body) => bodyBytes(body) > MAX_BODY_BYTES;

// ------------------------------------------------------------ preview

export const ACTION_STATUS = { new: 'import_new', link: 'import_link', exists: 'import_exists', skip: 'import_skip' };
export const ACTION_LABELS = { new: 'Baru', link: 'Tautkan ke akun', exists: 'Sudah ada', skip: 'Dilewati' };
export const actionStatus = (action) => ACTION_STATUS[action] || 'import_exists';
export const LEVEL_ORDER = { error: 0, warning: 1, info: 2 };
export const issueStatus = (level) => `issue_${LEVEL_ORDER[level] !== undefined ? level : 'info'}`;

// The most serious level among a row's issues ('' = none).
export function worstLevel(issues) {
  let worst = '';
  for (const issue of issues || []) {
    if (worst === '' || (LEVEL_ORDER[issue.level] ?? 3) < (LEVEL_ORDER[worst] ?? 3)) worst = issue.level;
  }
  return worst;
}

// Rows IT may tick "Perbarui" for: already in the app, with differences.
export const canUpdate = (row) => row?.action === 'exists' && Array.isArray(row.differences) && row.differences.length > 0;
export const updatableKeys = (rows) => (rows || []).filter(canUpdate).map((row) => row.key);
// Ticks that still point at an updatable row (a new preview may drop some).
export const keepValidUpdates = (updates, rows) => {
  const valid = new Set(updatableKeys(rows));
  return (updates || []).filter((key) => valid.has(key));
};

// Chips over the preview grid.
export const ROW_FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'new', label: 'Baru' },
  { key: 'link', label: 'Tautkan' },
  { key: 'exists', label: 'Sudah ada' },
  { key: 'skip', label: 'Dilewati' },
  { key: 'issues', label: 'Ada catatan' },
];
export function filterRows(rows, key) {
  const list = rows || [];
  if (!key || key === 'all') return list;
  if (key === 'issues') return list.filter((row) => (row.issues || []).some((issue) => issue.level !== 'info'));
  return list.filter((row) => row.action === key);
}
export const countRows = (rows, key) => filterRows(rows, key).length;

// The holder the import will record for a device row, as one line.
export function importHolderText(row) {
  const holder = row?.holder;
  if (!holder) return row?.holderText ? `${row.holderText} (dicatat di catatan)` : '';
  const name = holder.name || holder.label || row.holderText || '';
  const kind = HOLDER_KIND_LABELS[holder.kind] || '';
  return kind ? `${name} · ${kind}` : name;
}

export const importTypeLabel = (row) => DEVICE_TYPE_LABELS[row?.deviceType] || row?.deviceTypeLabel || row?.reportType || '';
export const importStatusLabel = (row) => DEVICE_STATUS_LABELS[row?.status] || row?.statusLabel || row?.reportStatus || '';
export const differenceText = (d) => `${d.label}: ${d.current ?? '—'} → ${d.incoming ?? '—'}`;

// Company codes to choose from: the account's company first (the only one
// that can be applied), then the other codes found in the file.
export function companyOptions(preview) {
  if (!preview) return [];
  const codes = [preview.companyCode];
  for (const counts of [preview.counts?.devices, preview.counts?.people]) {
    for (const code of Object.keys(counts?.otherCompany || {})) if (!codes.includes(code)) codes.push(code);
  }
  return codes.filter(Boolean).map((code) => ({ value: code, label: code === preview.companyCode ? `${code} (perusahaan akun Anda)` : code }));
}
export function companyCodeError(code, preview) {
  if (!preview || !code) return 'Pilih kode perusahaan.';
  if (code !== preview.companyCode) return `Impor hanya untuk baris perusahaan ${preview.companyCode} (perusahaan akun Anda).`;
  return '';
}

const otherCompanyText = (map) => Object.entries(map || {}).map(([code, n]) => `${code} ${formatNumber(n)}`).join(', ');

// The preview's counts as label/value lines for a KeyValue.
export function previewSummary(preview) {
  const out = [];
  const d = preview?.counts?.devices;
  if (d) {
    out.push({ label: 'Perangkat di file (perusahaan ini)', value: `${formatNumber(d.rows)} baris — ${formatNumber(d.new)} baru, ${formatNumber(d.exists)} sudah ada, ${formatNumber(d.skipped)} dilewati` });
    if (d.updatable) out.push({ label: 'Bisa diperbarui', value: `${formatNumber(d.updatable)} perangkat punya perbedaan` });
    const byStatus = Object.entries(d.byStatus || {}).filter(([, n]) => n).map(([s, n]) => `${DEVICE_STATUS_LABELS[s] || s} ${formatNumber(n)}`).join(', ');
    if (byStatus) out.push({ label: 'Per status', value: byStatus });
    const holders = Object.entries(d.holders || {}).filter(([, n]) => n).map(([k, n]) => `${HOLDER_KIND_LABELS[k] || k} ${formatNumber(n)}`).join(', ');
    if (holders) out.push({ label: 'Pemegang', value: holders });
    if (d.holderResigned) out.push({ label: 'Pemegang sudah resign', value: formatNumber(d.holderResigned) });
    if (d.withoutSerial) out.push({ label: 'Tanpa nomor seri', value: formatNumber(d.withoutSerial) });
    if (d.sharedAssetCodes?.length) out.push({ label: 'Nomor aset dipakai lebih dari satu perangkat', value: d.sharedAssetCodes.map((s) => s.assetCode).join(', ') });
    const skipped = (d.summaryRowsSkipped || 0) + (d.emptyRowsSkipped || 0);
    if (skipped) out.push({ label: 'Baris ringkasan/kosong dilewati', value: formatNumber(skipped) });
    if (d.missingCompany) out.push({ label: 'Tanpa kode perusahaan', value: formatNumber(d.missingCompany) });
    if (Object.keys(d.otherCompany || {}).length) out.push({ label: 'Perangkat perusahaan lain (tidak diimpor)', value: otherCompanyText(d.otherCompany) });
  }
  const p = preview?.counts?.people;
  if (p) {
    out.push({ label: 'Orang di file (perusahaan ini)', value: `${formatNumber(p.rows)} baris — ${formatNumber(p.new)} baru, ${formatNumber(p.link)} ditautkan ke akun, ${formatNumber(p.exists)} sudah ada, ${formatNumber(p.skipped)} dilewati` });
    if (p.updatable) out.push({ label: 'Orang yang bisa diperbarui', value: formatNumber(p.updatable) });
    if (p.nameOnly) out.push({ label: 'Cocok hanya dari nama', value: `${formatNumber(p.nameOnly)} — periksa pilihannya di tabel` });
    if (p.resigned) out.push({ label: 'Berstatus resign', value: `${formatNumber(p.resigned)} (tanggal resign = tanggal impor)` });
    if (p.emailsDropped) out.push({ label: 'Email pribadi tidak diimpor', value: formatNumber(p.emailsDropped) });
    if (p.missingCompany) out.push({ label: 'Tanpa kode perusahaan', value: formatNumber(p.missingCompany) });
    if (Object.keys(p.otherCompany || {}).length) out.push({ label: 'Orang perusahaan lain (tidak diimpor)', value: otherCompanyText(p.otherCompany) });
  }
  if (preview?.newLocations?.length) {
    out.push({ label: preview.createLocations ? 'Lokasi baru yang dibuat' : 'Lokasi belum ada', value: preview.newLocations.join(', ') });
  }
  return out;
}

// Columns the server ignored, as one sentence per sheet (credential columns
// are named so IT sees they were left out).
export function ignoredColumnsNotes(preview, dropped = {}) {
  const notes = [];
  for (const [kind, label] of [['devices', 'Device Inventory'], ['people', 'User List']]) {
    const sheet = preview?.sheets?.[kind];
    const credential = [...new Set([...(dropped[kind] || []), ...(sheet?.credentialColumns || []), ...(sheet?.credentialColumnsIgnored || [])])];
    if (credential.length) notes.push(`Sheet "${label}": kolom ${credential.map((c) => `"${c}"`).join(', ')} tidak dibaca dan tidak dikirim (berisi kata sandi atau akun).`);
    if (sheet?.otherColumnsIgnored?.length) notes.push(`Sheet "${label}": kolom lain diabaikan — ${sheet.otherColumnsIgnored.join(', ')}.`);
  }
  return notes;
}

// The apply result as label/value lines (a directory import has no device
// or location lines).
const DEVICE_LINES = new Set(['Perangkat baru', 'Perangkat diperbarui', 'Penugasan dibuat (perangkat Aktif)', 'Lokasi baru']);
export function applySummary(result, kind = 'devices') {
  if (!result) return [];
  const lines = [
    ['Perangkat baru', result.devicesCreated],
    ['Perangkat diperbarui', result.devicesUpdated],
    ['Penugasan dibuat (perangkat Aktif)', result.assignmentsCreated],
    ['Orang baru di direktori', result.peopleCreated],
    ['Akun ditautkan ke direktori', result.peopleLinked],
    ['Orang diperbarui', result.peopleUpdated],
    ['Lokasi baru', result.locationsCreated],
    ['Tidak berubah', result.unchanged],
    ['Dilewati', result.skipped],
  ];
  return lines
    .filter(([label, n]) => n !== undefined && n !== null && (kind !== 'people' || !DEVICE_LINES.has(label)))
    .map(([label, n]) => ({ label, value: formatNumber(n) }));
}

// The import request body. Apply adds the confirmed company code, the
// preview's fingerprint and the ticked updates.
export function importBody({ kind, devices, people, createLocations, personChoices, apply }) {
  const body = {};
  if (kind === 'people') body.people = people;
  else {
    body.devices = devices;
    if (people) body.people = people;
    body.createLocations = Boolean(createLocations);
  }
  if (personChoices && Object.keys(personChoices).length) body.personChoices = personChoices;
  if (apply) {
    body.companyCode = apply.companyCode;
    body.fingerprint = apply.fingerprint;
    if (apply.updates?.length) body.updates = apply.updates;
  }
  return body;
}
