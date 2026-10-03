// Indonesian labels for the IT asset enums (devices, subscriptions) and the
// one amount formatter the IT pages use. Pure: the pages and tests import it.
import { EMPTY, formatMoney, formatQty } from '../../components/format.js';

export const DEVICE_TYPE_LABELS = {
  laptop: 'Laptop',
  pc: 'PC',
  macbook: 'MacBook',
  smartphone: 'Smartphone',
  tablet: 'Tablet',
  printer: 'Printer',
  router: 'Router',
  switch: 'Switch',
  access_point: 'Access point',
  cctv_nvr: 'CCTV / NVR',
  monitor: 'Monitor',
  external_hdd: 'Harddisk eksternal',
  peripheral: 'Periferal',
  other: 'Lainnya',
  telephone: 'Telepon',
  label_printer: 'Printer label',
  fingerprint: 'Mesin sidik jari',
};

// Device statuses, labelled like the owner's report (rule 14). The order is
// the one the pages show: the report's four first, then the lifecycle states
// the report does not have.
export const DEVICE_STATUS_LABELS = {
  assigned: 'Aktif',
  available: 'Cadangan',
  damaged: 'Rusak',
  retired: 'Tidak aktif',
  maintenance: 'Perawatan',
  repair: 'Perbaikan',
  lost: 'Hilang',
  disposed: 'Dibuang',
};
export const MAIN_DEVICE_STATUSES = ['assigned', 'available', 'damaged', 'retired'];
export const OTHER_DEVICE_STATUSES = ['maintenance', 'repair', 'lost', 'disposed'];
// The report's "Problematic Devices" = Rusak + Tidak aktif.
export const PROBLEMATIC_STATUSES = ['damaged', 'retired'];
// Same rules as the backend (config/itAssets.js): Dibuang is final, and a
// device can be handed over only from these statuses.
export const FINAL_DEVICE_STATUSES = ['disposed'];
export const ASSIGNABLE_FROM = ['available', 'damaged', 'maintenance', 'repair', 'retired'];
// A move to these statuses needs a written reason (IT Lead decision: the log
// must say why a device broke, left service or disappeared).
export const REASON_REQUIRED_STATUSES = ['damaged', 'retired', 'lost', 'disposed'];

// The StatusBadge key of a device status (components/statusTone.js holds the
// tones; the device_* keys carry the report's wording).
export const deviceStatusKey = (status) => `device_${status || 'unknown'}`;
export const deviceStatusLabel = (status) => labelFor(DEVICE_STATUS_LABELS, status);

// Which statuses a device may move to from `status`, each with the reason it
// cannot (null = allowed). Mirrors the backend's changeStatus() guards so the
// dialog never offers a move the server refuses.
export function statusTransitions(status) {
  return [...MAIN_DEVICE_STATUSES, ...OTHER_DEVICE_STATUSES].map((to) => {
    let blocked = null;
    if (FINAL_DEVICE_STATUSES.includes(status)) blocked = 'Perangkat sudah Dibuang; statusnya tidak bisa diubah lagi';
    else if (to === status) blocked = to === 'assigned' ? 'Sudah Aktif. Kembalikan dulu untuk mengganti pemegang.' : 'Status saat ini';
    else if (to === 'assigned' && !ASSIGNABLE_FROM.includes(status)) blocked = `Perangkat berstatus ${deviceStatusLabel(status)} tidak bisa diserahkan`;
    return { status: to, label: DEVICE_STATUS_LABELS[to], blocked, needsHolder: to === 'assigned', needsReason: REASON_REQUIRED_STATUSES.includes(to) };
  });
}

// The request body of PATCH /it/devices/:id/status. Aktif takes exactly one
// holder: a directory entry (its account when it has one, else the person)
// or a team label.
export function statusChangeBody({ status, note, holderMode, entry, label }) {
  const body = { status };
  const text = String(note || '').trim();
  if (text) body.note = text;
  if (status !== 'assigned') return body;
  if (holderMode === 'label') {
    const name = String(label || '').trim();
    if (name) body.holderLabel = name;
  } else if (entry) {
    if (entry.userId) body.assignedTo = Number(entry.userId);
    else if (entry.personId) body.personId = Number(entry.personId);
  }
  return body;
}

// Client checks before the status request; field → message.
export function statusChangeErrors({ status, note, holderMode, entry, label }) {
  const errors = {};
  if (!status) errors.status = 'Pilih status baru.';
  if (status === 'assigned') {
    if (holderMode === 'label') {
      const name = String(label || '').trim();
      if (!name) errors.label = 'Isi nama tim atau label pemegang.';
      else if (name.length > 120) errors.label = 'Label pemegang maksimal 120 karakter.';
    } else if (!entry) errors.entry = 'Pilih orang dari direktori.';
  }
  if (REASON_REQUIRED_STATUSES.includes(status) && !String(note || '').trim()) errors.note = 'Alasan wajib diisi.';
  return errors;
}

export const HOLDER_KIND_LABELS = {
  user: 'Akun aplikasi',
  person: 'Orang di direktori',
  label: 'Label tim',
  new_person: 'Orang baru dari file',
  none: 'Tanpa pemegang',
};

export const LOCATION_KIND_LABELS = {
  office: 'Kantor',
  store: 'Toko',
  warehouse: 'Gudang',
  other: 'Lainnya',
};

// "Merek / model" is one field (rule 20): the old brand column, if any, reads
// in front of the model.
export const brandModel = (device) => [device?.brand, device?.model].filter(Boolean).join(' ');

// RAM / SSD / OS in one short line for the list ("16 GB · 512 GB · Windows 11").
export function specLine(device) {
  const parts = [];
  if (device?.ramGb) parts.push(`${device.ramGb} GB`);
  if (device?.storageGb) parts.push(device.storageGb >= 1024 && device.storageGb % 1024 === 0 ? `${device.storageGb / 1024} TB` : `${device.storageGb} GB`);
  if (device?.osVersion) parts.push(device.osVersion);
  return parts.join(' · ');
}

// The device's holder as one line: its name, or "—".
export const holderName = (device) => device?.holder?.name || device?.holder?.label || device?.assigneeName || '';

// A device's title on its detail page: the type and "Merek / model", else
// the asset number.
// The same title as parts for <Mixed>: the type is a label, the brand, model
// and asset code are the device's own data.
export function deviceTitleParts(device) {
  const type = DEVICE_TYPE_LABELS[device?.deviceType];
  const name = brandModel(device) || device?.assetCode || '';
  return [type || (device?.deviceType ? { text: device.deviceType, data: true } : 'Perangkat'), name ? { text: name, data: true } : null];
}

export function deviceTitle(device) {
  const type = DEVICE_TYPE_LABELS[device?.deviceType] || device?.deviceType || 'Perangkat';
  const name = brandModel(device);
  return name ? `${type} ${name}` : (device?.assetCode ? `${type} ${device.assetCode}` : type);
}

// Query params of the devices list/export from the page's filter state (only
// filled filters are sent).
export function deviceQuery(filters = {}) {
  const out = {};
  for (const key of ['status', 'deviceType', 'locationId', 'holderKind', 'q']) {
    const value = filters[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') out[key] = String(value).trim();
  }
  for (const key of ['problematic', 'noAssetCode', 'resignedHolder']) if (filters[key]) out[key] = '1';
  if (filters.warrantyDays) out.warrantyDays = String(filters.warrantyDays);
  return out;
}

// Form values ↔ request body of POST/PATCH /it/devices. Numbers are sent as
// numbers, empty fields as null, "Merek / model" as model with brand empty.
const numberOrNull = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const textOrNull = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};
export const DEVICE_FORM_FIELDS = [
  'deviceType', 'model', 'serialNumber', 'assetCode', 'purchaseYear', 'locationId', 'ramGb', 'storageGb', 'osVersion',
  'imei', 'macAddress', 'purchaseDate', 'purchasePrice', 'supplier', 'warrantyStart', 'warrantyEnd', 'warrantyType',
  'conditionState', 'notes',
];
export function deviceFormValues(device) {
  const d = device || {};
  return {
    deviceType: d.deviceType || '',
    model: brandModel(d),
    serialNumber: d.serialNumber || '',
    assetCode: d.assetCode || '',
    purchaseYear: d.purchaseYear ?? '',
    locationId: d.locationId ? String(d.locationId) : '',
    ramGb: d.ramGb ?? '',
    storageGb: d.storageGb ?? '',
    osVersion: d.osVersion || '',
    imei: d.imei || '',
    macAddress: d.macAddress || '',
    purchaseDate: d.purchaseDate ? String(d.purchaseDate).slice(0, 10) : '',
    purchasePrice: d.purchasePrice ?? '',
    supplier: d.supplier || '',
    warrantyStart: d.warrantyStart ? String(d.warrantyStart).slice(0, 10) : '',
    warrantyEnd: d.warrantyEnd ? String(d.warrantyEnd).slice(0, 10) : '',
    warrantyType: d.warrantyType || 'manufacturer',
    conditionState: d.conditionState || 'good',
    notes: d.notes || '',
  };
}
function bodyValue(field, value) {
  if (['purchaseYear', 'ramGb', 'storageGb', 'purchasePrice', 'locationId'].includes(field)) return numberOrNull(value);
  if (field === 'deviceType' || field === 'warrantyType' || field === 'conditionState') return value || undefined;
  return textOrNull(value);
}
// Create: every filled field. Edit (`initial` given): only what changed; a
// device that still had a separate brand gets it cleared with the model.
export function deviceBody(values, initial) {
  const body = {};
  for (const field of DEVICE_FORM_FIELDS) {
    const value = bodyValue(field, values[field]);
    if (!initial) {
      if (value !== null && value !== undefined) body[field] = value;
      continue;
    }
    if (value !== bodyValue(field, initial.values[field])) body[field] = value === undefined ? null : value;
  }
  if (initial && initial.brand && body.model !== undefined) body.brand = null;
  return body;
}

// Client checks of the device form; field → message.
export function deviceFormErrors(values) {
  const errors = {};
  if (!values.deviceType) errors.deviceType = 'Pilih tipe perangkat.';
  const year = numberOrNull(values.purchaseYear);
  if (values.purchaseYear !== '' && (year === null || !Number.isInteger(year) || year < 1990 || year > 2100)) errors.purchaseYear = 'Tahun beli 1990–2100.';
  const ram = numberOrNull(values.ramGb);
  if (values.ramGb !== '' && (ram === null || !Number.isInteger(ram) || ram < 1 || ram > 4096)) errors.ramGb = 'RAM 1–4096 GB, bilangan bulat.';
  const ssd = numberOrNull(values.storageGb);
  if (values.storageGb !== '' && (ssd === null || !Number.isInteger(ssd) || ssd < 1 || ssd > 1048576)) errors.storageGb = 'Penyimpanan 1–1.048.576 GB, bilangan bulat.';
  if (String(values.assetCode || '').trim().length > 80) errors.assetCode = 'Nomor aset maksimal 80 karakter.';
  if (String(values.model || '').trim().length > 150) errors.model = 'Merek / model maksimal 150 karakter.';
  if (String(values.serialNumber || '').trim().length > 150) errors.serialNumber = 'Nomor seri maksimal 150 karakter.';
  if (String(values.osVersion || '').trim().length > 80) errors.osVersion = 'OS maksimal 80 karakter.';
  if (values.warrantyStart && values.warrantyEnd && values.warrantyEnd < values.warrantyStart) errors.warrantyEnd = 'Garansi selesai tidak boleh sebelum garansi mulai.';
  return errors;
}

// Server error → the form field it belongs to (field errors stay on the field).
const DEVICE_ERROR_FIELDS = { SERIAL_TAKEN: 'serialNumber', LOCATION_INVALID: 'locationId', LOCATION_INACTIVE: 'locationId' };
export function deviceFieldErrorFromApi(error) {
  const data = error?.response?.data?.error;
  if (!data) return null;
  if (DEVICE_ERROR_FIELDS[data.code]) return { [DEVICE_ERROR_FIELDS[data.code]]: data.message };
  const fields = data.details?.fieldErrors;
  if (data.code === 'VALIDATION_ERROR' && fields) {
    const out = {};
    for (const [field, messages] of Object.entries(fields)) if (messages?.length) out[field] = messages[0];
    return Object.keys(out).length ? out : null;
  }
  return null;
}

export const CONDITION_LABELS = {
  excellent: 'Sangat baik',
  good: 'Baik',
  fair: 'Cukup',
  poor: 'Kurang',
  broken: 'Rusak',
};

export const WARRANTY_TYPE_LABELS = {
  none: 'Tanpa garansi',
  manufacturer: 'Garansi pabrik',
  extended: 'Garansi tambahan',
  accidental: 'Garansi kerusakan',
};

export const BILLING_CYCLE_LABELS = {
  monthly: 'Bulanan',
  quarterly: 'Per kuartal',
  yearly: 'Tahunan',
  multi_year: 'Multi-tahun',
  one_time: 'Sekali bayar',
};

// Invoice statuses the shared status map does not name; the tone stays the
// shared one (StatusBadge `label`).
export const INVOICE_STATUS_LABELS = { void: 'Batal' };

// The label for a code, or the code itself when it is not in the map (a new
// value from the server stays readable instead of disappearing).
export function labelFor(map, value) {
  if (value === null || value === undefined || value === '') return EMPTY;
  return map[value] || String(value);
}

export const optionsFrom = (map, keys = Object.keys(map)) => keys.map((value) => ({ value, label: map[value] }));

// Rupiah through format.js; another currency keeps its code in front.
export function formatAmount(value, currency) {
  if (value === null || value === undefined || value === '') return EMPTY;
  if (!currency || String(currency).toLowerCase() === 'idr') return formatMoney(value);
  const amount = formatQty(value);
  return amount === EMPTY ? EMPTY : `${currency} ${amount}`;
}

// ------------------------------------------------------------ Prakasa AI (Wave C2)
// The people picker's own list (GET /people/directory, as useDirectoryEntries
// loads it) as Prakasa AI lookup results: the entries that hold every word of
// the text. Only what the picker shows leaves: the name, and the position and
// division as the hint — never an email, a phone number or an id.
const plainText = (value) => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function personResults(entries, text, limit = 20) {
  const words = plainText(text).split(' ').filter(Boolean);
  if (!words.length) return [];
  return (entries || [])
    .filter((entry) => entry && entry.key && entry.name)
    .filter((entry) => { const hay = ` ${plainText(`${entry.name} ${entry.position || ''} ${entry.departmentName || ''}`)} `; return words.every((word) => hay.includes(word)); })
    .slice(0, limit)
    .map((entry) => ({ value: entry.key, label: entry.name, hint: [entry.position, entry.departmentName].filter(Boolean).join(' · ') }));
}
export const personName = (entries, key) => (entries || []).find((entry) => entry.key === key)?.name || '';
