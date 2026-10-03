// IT infrastructure registers (People & Culture wave 2, row 2.3 —
// docs/rancangan-people-culture-g2.md Bagian 4): labels, tabs, form models,
// the dashboard cards and the browser side of the IT report import. Pure: the
// page, the dialogs and the tests import it. The labels and the import
// allow-list mirror backend/src/config/itInfra.js — a test keeps them equal.
import { formatDate, formatMoney, formatNumber } from '../../components/format.js';
import { f } from '../../components/ai/aiFormFields.js';

// ------------------------------------------------------------ labels
export const NETWORK_TYPE_LABELS = {
  router: 'Router', switch: 'Switch', access_point: 'Access point', nvr: 'NVR', dvr: 'DVR',
  firewall: 'Firewall', modem: 'Modem', other: 'Lainnya',
};
export const NETWORK_STATUS_LABELS = { active: 'Aktif', spare: 'Cadangan', damaged: 'Rusak', retired: 'Tidak aktif' };
export const ISP_STATUS_LABELS = { active: 'Aktif', terminated: 'Berhenti' };
export const CCTV_RECORDER_LABELS = { nvr: 'NVR', dvr: 'DVR', cloud: 'Cloud', none: 'Tanpa perekam' };
export const CCTV_STATUS_LABELS = { online: 'Online', partial: 'Sebagian offline', offline: 'Offline', retired: 'Tidak aktif' };
export const BACKUP_FREQUENCY_LABELS = { daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan', other: 'Lainnya' };
export const BACKUP_STORAGE_LABELS = { onsite: 'Di lokasi', offsite: 'Di luar lokasi', cloud: 'Cloud' };
export const BACKUP_RESULT_LABELS = { ok: 'Berhasil', failed: 'Gagal', unknown: 'Belum diperiksa' };
export const BACKUP_STATUS_LABELS = { active: 'Aktif', retired: 'Tidak aktif' };
export const PHONE_KIND_LABELS = { mobile: 'HP', ip_phone: 'Telepon IP' };
export const PHONE_STATUS_LABELS = { active: 'Aktif', spare: 'Cadangan', terminated: 'Berhenti' };
export const VENDOR_KIND_LABELS = {
  software: 'Software', isp: 'ISP', cctv: 'CCTV', network: 'Jaringan', hardware: 'Perangkat keras', service: 'Jasa', other: 'Lainnya',
};

export const optionsFrom = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }));
const YES_NO = (v) => {
  if (v === null || v === undefined) return 'Belum dipastikan';
  return v ? 'Ya' : 'Tidak';
};

// statusTone.js keys (tone is never decided here).
export function statusKey(kind, row) {
  if (!row) return '';
  if (kind === 'network') return `net_${row.status}`;
  if (kind === 'isp') return `isp_${row.status}`;
  if (kind === 'cctv') return `cctv_${row.status}`;
  if (kind === 'backup') return row.status === 'retired' ? 'backup_retired' : `backup_${row.lastResult || 'unknown'}`;
  if (kind === 'phone') return `line_${row.status}`;
  return row.status || '';
}
export function statusText(kind, row) {
  if (!row) return '';
  if (kind === 'backup') return row.status === 'retired' ? BACKUP_STATUS_LABELS.retired : (BACKUP_RESULT_LABELS[row.lastResult] || row.lastResultLabel || '');
  const labels = { network: NETWORK_STATUS_LABELS, isp: ISP_STATUS_LABELS, cctv: CCTV_STATUS_LABELS, phone: PHONE_STATUS_LABELS }[kind] || {};
  return labels[row.status] || row.statusLabel || row.status || '';
}

// ------------------------------------------------------------ tabs
export const TABS = [
  { k: 'network', l: 'Jaringan', icon: 'router' },
  { k: 'isp', l: 'ISP', icon: 'public' },
  { k: 'cctv', l: 'CCTV', icon: 'videocam' },
  { k: 'backup', l: 'Backup', icon: 'backup' },
  { k: 'gws', l: 'Google Workspace', icon: 'admin_panel_settings' },
  { k: 'phone', l: 'Telepon & HP', icon: 'call' },
  { k: 'vendor', l: 'Vendor', icon: 'storefront' },
];
export const TAB_KEYS = TABS.map((t) => t.k);
export const tabFrom = (value) => (TAB_KEYS.includes(value) ? value : 'network');

export const ENDPOINTS = {
  network: '/it/infrastructure/network-devices',
  isp: '/it/infrastructure/isp-links',
  cctv: '/it/infrastructure/cctv',
  backup: '/it/infrastructure/backups',
  phone: '/it/infrastructure/phone-lines',
  gws: '/it/infrastructure/gws-reviews',
  vendor: '/it/infrastructure/vendors',
};

export const ADD_LABELS = {
  network: 'Tambah perangkat jaringan',
  isp: 'Tambah ISP',
  cctv: 'Tambah CCTV',
  backup: 'Tambah backup',
  gws: 'Catat review',
  phone: 'Tambah nomor',
  vendor: 'Tambah vendor',
};

export const RECORD_LABELS = {
  network: 'Perangkat jaringan', isp: 'ISP', cctv: 'Sistem CCTV', backup: 'Backup', phone: 'Nomor perusahaan', vendor: 'Vendor',
};

// The tab's count from the summary block (GET /it/infrastructure/summary).
export function tabCount(summary, key) {
  if (!summary) return undefined;
  if (key === 'vendor') return summary.vendors?.total;
  if (key === 'gws') return undefined; // reviews are a history, not a count
  return summary[key]?.total;
}

// The same title as parts for <Mixed> (i18n/NoTranslate.jsx): the kind is a
// label, the brand, provider, location and number are the row's own data.
export function rowTitleParts(kind, row) {
  const own = (text) => (text ? { text, data: true } : null);
  if (!row) return { parts: [], separator: ' ' };
  if (kind === 'network') return { parts: [NETWORK_TYPE_LABELS[row.deviceType] || own(row.deviceType), own(row.brandModel)], separator: ' · ' };
  if (kind === 'isp') return { parts: [own(row.providerName), row.isBackup ? '(cadangan)' : null], separator: ' ' };
  if (kind === 'cctv') return { parts: ['CCTV', own(row.locationName)], separator: ' ' };
  if (kind === 'backup') return { parts: [own(row.dataScope) || 'Backup'], separator: ' ' };
  if (kind === 'phone') return { parts: [own(phoneText(row))], separator: ' ' };
  if (kind === 'vendor') return { parts: [own(row.name)], separator: ' ' };
  return { parts: [], separator: ' ' };
}

// The register's title for one row, as a sheet title or a dialog subject.
export function rowTitle(kind, row) {
  if (!row) return '';
  if (kind === 'network') return [NETWORK_TYPE_LABELS[row.deviceType] || row.deviceType, row.brandModel].filter(Boolean).join(' · ');
  if (kind === 'isp') return `${row.providerName}${row.isBackup ? ' (cadangan)' : ''}`;
  if (kind === 'cctv') return `CCTV ${row.locationName || ''}`.trim();
  if (kind === 'backup') return row.dataScope || 'Backup';
  if (kind === 'phone') return phoneText(row);
  if (kind === 'vendor') return row.name;
  return '';
}

export function phoneText(row) {
  if (!row) return '';
  const parts = [];
  if (row.number) parts.push(row.number);
  if (row.extension) parts.push(`ext. ${row.extension}`);
  return parts.join(' · ');
}

// ------------------------------------------------------------ list filters
// Location chips with counts, in name order; "Tanpa lokasi" last (backup only).
export function locationChips(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = row.locationId == null ? 'none' : String(row.locationId);
    const name = row.locationId == null ? 'Tanpa lokasi' : (row.locationName || `Lokasi #${row.locationId}`);
    const item = map.get(key) || { key, name, count: 0 };
    item.count += 1;
    map.set(key, item);
  }
  return [...map.values()].sort((a, b) => (a.key === 'none') - (b.key === 'none') || a.name.localeCompare(b.name, 'id'));
}

export function statusChips(kind, rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = statusKey(kind, row);
    const item = map.get(key) || { key, label: statusText(kind, row), count: 0 };
    item.count += 1;
    map.set(key, item);
  }
  return [...map.values()];
}

export function filterRows(kind, rows, { location = '', status = '' } = {}) {
  return (rows || []).filter((row) => {
    if (location) {
      const key = row.locationId == null ? 'none' : String(row.locationId);
      if (key !== location) return false;
    }
    if (status && statusKey(kind, row) !== status) return false;
    return true;
  });
}

// ------------------------------------------------------------ forms
// Field specs per register: type text | number | select | date | switch |
// textarea | location | ref. `ref` options come from the page's lookups.
const NOTES_FIELD = { name: 'notes', label: 'Catatan', type: 'textarea', max: 500, hint: 'Jangan menulis kata sandi.' };

export const FORM_FIELDS = {
  network: [
    { name: 'deviceType', label: 'Tipe', type: 'select', options: optionsFrom(NETWORK_TYPE_LABELS), required: true },
    { name: 'brandModel', label: 'Merek / model', type: 'text', required: true, max: 150, hint: 'Contoh: Asus AX6000.' },
    { name: 'serialNumber', label: 'Nomor seri', type: 'text', mono: true, max: 150 },
    { name: 'locationId', label: 'Lokasi', type: 'location', required: true },
    { name: 'ipAddress', label: 'Alamat IP', type: 'text', mono: true, max: 45, hint: 'Hanya terlihat oleh People & Culture.' },
    { name: 'installedYear', label: 'Tahun pasang', type: 'number', min: 1990, max: 2100 },
    { name: 'ispLinkId', label: 'ISP terkait', type: 'ref', ref: 'isp' },
    { name: 'firmwareUpdatedOn', label: 'Update firmware terakhir', type: 'date' },
    { name: 'status', label: 'Status', type: 'select', options: optionsFrom(NETWORK_STATUS_LABELS) },
    NOTES_FIELD,
  ],
  isp: [
    { name: 'providerName', label: 'Provider', type: 'text', required: true, max: 120 },
    { name: 'locationId', label: 'Lokasi', type: 'location', required: true },
    { name: 'vendorId', label: 'Vendor ISP', type: 'ref', ref: 'ispVendor' },
    { name: 'customerNumber', label: 'No. pelanggan', type: 'text', mono: true, max: 60 },
    { name: 'bandwidthMbps', label: 'Bandwidth (Mbps)', type: 'number', min: 0, max: 1000000 },
    { name: 'isBackup', label: 'ISP cadangan', type: 'switch' },
    { name: 'publicIpDedicated', label: 'IP publik dedicated', type: 'switch' },
    { name: 'contractStart', label: 'Awal kontrak', type: 'date' },
    { name: 'contractEnd', label: 'Akhir kontrak', type: 'date' },
    { name: 'monthlyCost', label: 'Biaya per bulan (Rp)', type: 'number', min: 0, hint: 'Hanya terlihat oleh People & Culture.' },
    { name: 'status', label: 'Status', type: 'select', options: optionsFrom(ISP_STATUS_LABELS) },
    NOTES_FIELD,
  ],
  cctv: [
    { name: 'locationId', label: 'Lokasi', type: 'location', required: true },
    { name: 'cameraCount', label: 'Jumlah kamera', type: 'number', required: true, min: 0, max: 2000 },
    { name: 'cameraModel', label: 'Model', type: 'text', max: 150 },
    { name: 'recorderType', label: 'Perekam', type: 'select', options: optionsFrom(CCTV_RECORDER_LABELS), required: true },
    { name: 'recorderDeviceId', label: 'Perangkat perekam (NVR/DVR)', type: 'ref', ref: 'recorder' },
    { name: 'serialNumber', label: 'Nomor seri', type: 'text', mono: true, max: 150 },
    { name: 'remoteAccess', label: 'Akses jarak jauh', type: 'switch' },
    { name: 'sameNetworkAsPc', label: 'Satu jaringan dengan PC', type: 'select', options: [{ value: '', label: 'Belum dipastikan' }, { value: 'yes', label: 'Ya' }, { value: 'no', label: 'Tidak' }] },
    NOTES_FIELD,
  ],
  backup: [
    { name: 'dataScope', label: 'Data yang dibackup', type: 'text', required: true, max: 190 },
    { name: 'method', label: 'Metode', type: 'text', required: true, max: 120, hint: 'Contoh: Google Drive, NAS, hard disk eksternal.' },
    { name: 'frequency', label: 'Frekuensi', type: 'select', options: optionsFrom(BACKUP_FREQUENCY_LABELS), required: true },
    { name: 'storageLocation', label: 'Lokasi backup', type: 'select', options: optionsFrom(BACKUP_STORAGE_LABELS), required: true },
    { name: 'locationId', label: 'Kantor', type: 'location', hint: 'Kosongkan untuk backup cloud.' },
    { name: 'retention', label: 'Retensi', type: 'text', max: 60, hint: 'Contoh: 30 hari.' },
    { name: 'status', label: 'Status', type: 'select', options: optionsFrom(BACKUP_STATUS_LABELS), editOnly: true },
    NOTES_FIELD,
  ],
  phone: [
    { name: 'kind', label: 'Jenis', type: 'select', options: optionsFrom(PHONE_KIND_LABELS), required: true },
    { name: 'number', label: 'Nomor', type: 'text', mono: true, max: 30, hint: 'Hanya nomor milik perusahaan. Contoh: 0812-3456-7890.' },
    { name: 'extension', label: 'Ekstensi', type: 'text', mono: true, max: 10 },
    { name: 'locationId', label: 'Lokasi', type: 'location', required: true },
    { name: 'provider', label: 'Operator', type: 'text', max: 80 },
    { name: 'planName', label: 'Paket', type: 'text', max: 120 },
    { name: 'startedOn', label: 'Mulai dipakai', type: 'date' },
    { name: 'monthlyCost', label: 'Biaya per bulan (Rp)', type: 'number', min: 0, hint: 'Hanya terlihat oleh People & Culture.' },
    { name: 'deviceId', label: 'Perangkat', type: 'ref', ref: 'device' },
    { name: 'status', label: 'Status', type: 'select', options: [{ value: 'spare', label: 'Cadangan' }, { value: 'terminated', label: 'Berhenti' }, { value: 'active', label: 'Aktif' }], editOnly: true, hint: 'Aktif diatur lewat "Ganti pemegang".' },
    NOTES_FIELD,
  ],
  vendor: [
    { name: 'name', label: 'Nama vendor', type: 'text', required: true, max: 190 },
    { name: 'vendorKind', label: 'Jenis', type: 'select', options: optionsFrom(VENDOR_KIND_LABELS), required: true },
    { name: 'contactPerson', label: 'Kontak PIC', type: 'text', max: 150 },
    { name: 'phone', label: 'Telepon PIC', type: 'text', max: 40 },
    { name: 'email', label: 'Email', type: 'text', max: 190 },
    { name: 'portalUrl', label: 'Portal', type: 'text', max: 500, hint: 'Alamat situs saja — jangan menulis akun atau kata sandi.' },
    { name: 'notes', label: 'Catatan', type: 'textarea', max: 1000, hint: 'Jangan menulis kata sandi.' },
  ],
};

export const formFields = (kind, editing) => (FORM_FIELDS[kind] || []).filter((f) => editing || !f.editOnly);
// Long forms (> 5 fields) go to a full-screen dialog (§3.3).
export const usesFullScreen = (kind, editing) => formFields(kind, editing).length > 5;

const DEFAULTS = {
  network: { status: 'active' },
  isp: { status: 'active', isBackup: false, publicIpDedicated: false },
  cctv: { recorderType: 'nvr', remoteAccess: false },
  backup: { frequency: 'daily', storageLocation: 'cloud' },
  phone: { kind: 'mobile' },
  vendor: { vendorKind: 'isp' },
};

// Row → form values (strings for inputs, booleans for switches).
export function formValues(kind, row) {
  const values = {};
  for (const f of FORM_FIELDS[kind] || []) {
    const v = row ? row[f.name] : DEFAULTS[kind]?.[f.name];
    if (f.type === 'switch') values[f.name] = Boolean(v);
    else if (f.name === 'sameNetworkAsPc') values[f.name] = v === true ? 'yes' : v === false ? 'no' : '';
    else values[f.name] = v === null || v === undefined ? '' : String(v);
  }
  return values;
}

// Form value → API value.
function apiValue(field, value) {
  if (field.type === 'switch') return Boolean(value);
  if (field.name === 'sameNetworkAsPc') return value === 'yes' ? true : value === 'no' ? false : null;
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (['number', 'location', 'ref'].includes(field.type)) return Number(text);
  return text;
}

const SECRET_TEXT_RE = /\b(pass(word|wd)?|kata\s*sandi|sandi|pwd|pin|puk)\s*[:=]/i;
export const looksSecret = (value) => typeof value === 'string' && SECRET_TEXT_RE.test(value);
export const SECRET_TEXT_MESSAGE = 'Jangan menulis kata sandi di aplikasi';

// Client checks; field → message.
export function formErrors(kind, values, editing = false) {
  const errors = {};
  for (const f of formFields(kind, editing)) {
    const v = values[f.name];
    const text = typeof v === 'string' ? v.trim() : v;
    if (f.required && (text === '' || text === null || text === undefined)) { errors[f.name] = `${f.label} wajib diisi.`; continue; }
    if (typeof text === 'string' && f.max && f.type !== 'number' && text.length > f.max) errors[f.name] = `${f.label} maksimal ${f.max} karakter.`;
    if (f.type === 'number' && text !== '') {
      const n = Number(text);
      if (!Number.isFinite(n)) errors[f.name] = `${f.label} harus angka.`;
      else if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) errors[f.name] = `${f.label} di luar rentang.`;
      else if (f.name !== 'monthlyCost' && !Number.isInteger(n)) errors[f.name] = `${f.label} harus bilangan bulat.`;
    }
    if (looksSecret(text)) errors[f.name] = SECRET_TEXT_MESSAGE;
  }
  if (kind === 'phone') {
    if (values.kind === 'mobile' && !String(values.number || '').trim()) errors.number = 'Isi nomor HP perusahaan.';
    if (values.kind === 'ip_phone' && !String(values.number || '').trim() && !String(values.extension || '').trim()) errors.extension = 'Isi ekstensi atau nomor.';
  }
  if (kind === 'isp' && values.contractStart && values.contractEnd && values.contractEnd < values.contractStart) {
    errors.contractEnd = 'Akhir kontrak tidak boleh sebelum awal kontrak.';
  }
  if (kind === 'vendor' && values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.email).trim())) errors.email = 'Email tidak valid.';
  if (kind === 'vendor' && values.portalUrl && !/^https:\/\//i.test(String(values.portalUrl).trim())) errors.portalUrl = 'Awali dengan https://';
  return errors;
}

// The request body: every filled field on create; only what changed (plus
// `version`) on edit. Vendors have no version.
export function formBody(kind, values, row = null) {
  const body = {};
  for (const f of formFields(kind, Boolean(row))) {
    const next = apiValue(f, values[f.name]);
    if (!row) {
      if (next !== null) body[f.name] = next;
      continue;
    }
    const before = apiValue(f, formValues(kind, row)[f.name]);
    if (next !== before) body[f.name] = next;
  }
  if (row && kind !== 'vendor' && Object.keys(body).length) body.version = row.version;
  if (kind === 'vendor') {
    // The vendor API reads empty as "leave as is".
    for (const key of Object.keys(body)) if (body[key] === null) delete body[key];
  }
  return body;
}

// API error → field error, when the server names the field.
export function fieldErrorFromApi(error) {
  const e = error?.response?.data?.error;
  if (!e) return null;
  const field = e.details?.field;
  if (field && typeof field === 'string' && !field.includes('.')) return { [field]: e.message };
  if (e.code === 'SECRET_TEXT') return null;
  const flat = e.details?.fieldErrors;
  if (flat && typeof flat === 'object') {
    const out = {};
    for (const [k, list] of Object.entries(flat)) if (Array.isArray(list) && list.length) out[k] = list[0];
    return Object.keys(out).length ? out : null;
  }
  return null;
}

// ------------------------------------------------------------ Prakasa AI (Wave C2)
// The register forms as Prakasa AI sees them (docs/prakasa-ai-rencana.md §9.9).
// The policy itself is written where the form is registered (InfraDialogs.jsx
// AI_POLICY) and again in the server's catalog; this only turns the form's own
// field specs (FORM_FIELDS) into AI field specs.
export const AI_EDIT_TITLES = {
  network: 'Ubah perangkat jaringan', isp: 'Ubah ISP', cctv: 'Ubah CCTV', backup: 'Ubah backup', phone: 'Ubah nomor', vendor: 'Ubah vendor',
};
// The type of the record an edit form changes (the audit names it with its id).
export const AI_RECORD_TYPES = {
  network: 'it_network_device', isp: 'it_isp_link', cctv: 'it_cctv', backup: 'it_backup', phone: 'it_phone_line', vendor: 'it_vendor',
};
const AI_TYPES = { text: 'text', number: 'number', select: 'select', date: 'date', switch: 'checkbox', textarea: 'textarea', location: 'select', ref: 'select' };

// policy = { ai: [names the AI may fill], userOnly: [names listed, never filled, never read] }.
// A field of the form that the policy does not name is not registered at all:
// a field added to FORM_FIELDS later stays out of the AI's reach until someone
// decides. `locations` and `refs` are the options the form's selects show.
export function aiRegisterFields(kind, editing, policy, { locations = [], refs = {} } = {}) {
  const fillable = policy?.ai || [];
  const userOnly = policy?.userOnly || [];
  const out = [];
  for (const field of formFields(kind, editing)) {
    const type = AI_TYPES[field.type] || 'text';
    if (userOnly.includes(field.name) || !fillable.includes(field.name)) {
      if (userOnly.includes(field.name)) out.push(f.userOnly(field.name, field.label, type));
      continue;
    }
    const common = { required: field.required === true, ...(field.hint ? { hint: field.hint } : {}) };
    if (field.type === 'location') out.push(f.select(field.name, field.label, locations, common));
    else if (field.type === 'ref') out.push(f.select(field.name, field.label, refs[field.ref] || [], common));
    else if (field.type === 'select') out.push(f.select(field.name, field.label, field.options, common));
    else if (field.type === 'switch') out.push(f.checkbox(field.name, field.label, common));
    else if (field.type === 'date') out.push(f.date(field.name, field.label, common));
    else if (field.type === 'number') out.push(f.number(field.name, field.label, { ...common, step: 1, ...(field.min !== undefined ? { min: field.min } : {}), ...(field.max !== undefined ? { max: field.max } : {}) }));
    else out.push((field.type === 'textarea' ? f.textarea : f.text)(field.name, field.label, { ...common, ...(field.max ? { maxLength: field.max } : {}) }));
  }
  return out;
}

// ------------------------------------------------------------ detail sheet
export function detailItems(kind, row) {
  if (!row) return [];
  const d = (v) => (v ? formatDate(v) : null);
  if (kind === 'network') {
    return [
      { label: 'Tipe', translate: true, value: NETWORK_TYPE_LABELS[row.deviceType] || row.deviceType },
      { label: 'Merek / model', value: row.brandModel },
      { label: 'Nomor seri', value: row.serialNumber },
      { label: 'Lokasi', value: row.locationName },
      { label: 'Alamat IP', value: row.ipAddress },
      { label: 'Tahun pasang', value: row.installedYear },
      { label: 'ISP terkait', value: row.ispName },
      { label: 'Update firmware terakhir', value: d(row.firmwareUpdatedOn) },
      { label: 'Status', translate: true, value: statusText(kind, row) },
      { label: 'Catatan', value: row.notes },
    ];
  }
  if (kind === 'isp') {
    return [
      { label: 'Provider', value: row.providerName },
      { label: 'Lokasi', value: row.locationName },
      { label: 'Vendor', value: row.vendorName },
      { label: 'No. pelanggan', value: row.customerNumber },
      { label: 'Bandwidth', value: row.bandwidthMbps != null ? `${formatNumber(row.bandwidthMbps)} Mbps` : null },
      { label: 'ISP cadangan', translate: true, value: YES_NO(row.isBackup) },
      { label: 'IP publik dedicated', translate: true, value: YES_NO(row.publicIpDedicated) },
      { label: 'Kontrak', value: [d(row.contractStart), d(row.contractEnd)].some(Boolean) ? `${d(row.contractStart) || '—'} s.d. ${d(row.contractEnd) || '—'}` : null, translate: true },
      { label: 'Biaya per bulan', value: row.monthlyCost != null ? formatMoney(row.monthlyCost) : null },
      { label: 'Status', translate: true, value: statusText(kind, row) },
      { label: 'Catatan', value: row.notes },
    ];
  }
  if (kind === 'cctv') {
    return [
      { label: 'Lokasi', value: row.locationName },
      { label: 'Jumlah kamera', value: formatNumber(row.cameraCount) },
      { label: 'Kamera offline', value: formatNumber(row.camerasOffline || 0) },
      { label: 'Model', value: row.cameraModel },
      { label: 'Perekam', translate: true, value: CCTV_RECORDER_LABELS[row.recorderType] || row.recorderType },
      { label: 'Perangkat perekam', value: row.recorderName },
      { label: 'Nomor seri', value: row.serialNumber },
      { label: 'Akses jarak jauh', translate: true, value: YES_NO(row.remoteAccess) },
      { label: 'Satu jaringan dengan PC', translate: true, value: YES_NO(row.sameNetworkAsPc) },
      { label: 'Status', translate: true, value: statusText(kind, row) },
      { label: 'Status sejak', value: d(row.statusChangedAt) },
      { label: 'Catatan', value: row.notes },
    ];
  }
  if (kind === 'backup') {
    return [
      { label: 'Data yang dibackup', value: row.dataScope },
      { label: 'Metode', value: row.method },
      { label: 'Frekuensi', translate: true, value: BACKUP_FREQUENCY_LABELS[row.frequency] || row.frequency },
      { label: 'Lokasi backup', translate: true, value: BACKUP_STORAGE_LABELS[row.storageLocation] || row.storageLocation },
      { label: 'Kantor', value: row.locationName },
      { label: 'Retensi', value: row.retention },
      { label: 'Pemeriksaan terakhir', value: row.lastCheckedOn ? `${d(row.lastCheckedOn)} · ${BACKUP_RESULT_LABELS[row.lastResult] || ''}` : 'Belum pernah', translate: true },
      { label: 'Pemeriksaan berikutnya', value: row.status === 'active' && row.dueOn ? `${d(row.dueOn)}${row.overdue ? ' (terlambat)' : ''}` : null, translate: true },
      { label: 'Uji restore terakhir', value: row.restoreTestedOn ? d(row.restoreTestedOn) : 'Belum pernah', translate: true },
      { label: 'Status', translate: true, value: BACKUP_STATUS_LABELS[row.status] || row.status },
      { label: 'Catatan', value: row.notes },
    ];
  }
  if (kind === 'phone') {
    return [
      { label: 'Jenis', translate: true, value: PHONE_KIND_LABELS[row.kind] || row.kind },
      { label: 'Nomor', value: row.number },
      { label: 'Ekstensi', value: row.extension },
      // `parts`: the name is record data, the note beside it is interface text.
      { label: 'Pemegang', value: row.holderName || null, parts: row.holderName ? [{ text: row.holderName, data: true }, row.personResigned ? '(sudah resign)' : null] : null, separator: ' ' },
      { label: 'Lokasi', value: row.locationName },
      { label: 'Operator', value: row.provider },
      { label: 'Paket', value: row.planName },
      { label: 'Mulai dipakai', value: d(row.startedOn) },
      { label: 'Perangkat', value: row.deviceName },
      { label: 'Biaya per bulan', value: row.monthlyCost != null ? formatMoney(row.monthlyCost) : null },
      { label: 'Status', translate: true, value: statusText(kind, row) },
      { label: 'Catatan', value: row.notes },
    ];
  }
  if (kind === 'vendor') {
    return [
      { label: 'Nama', value: row.name },
      { label: 'Jenis', translate: true, value: VENDOR_KIND_LABELS[row.vendorKind] || row.vendorKind },
      { label: 'Kontak PIC', value: row.contactPerson },
      { label: 'Telepon PIC', value: row.phone },
      { label: 'Email', value: row.email },
      { label: 'Portal', value: row.portalUrl },
      { label: 'Catatan', value: row.notes },
    ];
  }
  return [];
}

// ------------------------------------------------------------ CCTV status, backup check, holder
export function cctvStatusErrors({ status, camerasOffline }, row) {
  const errors = {};
  if (!status) errors.status = 'Pilih status.';
  if (status === 'partial') {
    const n = Number(camerasOffline);
    const max = Math.max((row?.cameraCount || 0) - 1, 1);
    if (!String(camerasOffline ?? '').trim() || !Number.isInteger(n) || n < 1 || n > max) errors.camerasOffline = `Isi 1–${max}.`;
  }
  return errors;
}
export function cctvStatusBody({ status, camerasOffline, note }, row) {
  const body = { status, version: row?.version };
  if (status === 'partial') body.camerasOffline = Number(camerasOffline);
  const text = String(note || '').trim();
  if (text) body.note = text;
  return body;
}

export function backupCheckErrors({ checkedOn, result, note }, today) {
  const errors = {};
  if (!checkedOn) errors.checkedOn = 'Isi tanggal pemeriksaan.';
  else if (today && checkedOn > today) errors.checkedOn = 'Tanggal tidak boleh di masa depan.';
  if (!result) errors.result = 'Pilih hasil.';
  if (String(note || '').length > 255) errors.note = 'Catatan maksimal 255 karakter.';
  if (looksSecret(note)) errors.note = SECRET_TEXT_MESSAGE;
  return errors;
}
export function backupCheckBody({ checkedOn, result, restoreTested, note }) {
  const body = { checkedOn, result, restoreTested: Boolean(restoreTested) };
  const text = String(note || '').trim();
  if (text) body.note = text;
  return body;
}

// Holder: a directory entry (person row or app account), a team label, or nobody.
export function holderBody({ mode, entry, label }, row) {
  const body = { version: row?.version };
  if (mode === 'entry' && entry) {
    if (entry.personId) body.personId = Number(entry.personId);
    else if (entry.userId) body.userId = Number(entry.userId);
  } else if (mode === 'label') body.holderLabel = String(label || '').trim();
  return body;
}
export function holderErrors({ mode, entry, label }) {
  if (mode === 'entry' && !entry) return { entry: 'Pilih orang.' };
  if (mode === 'label') {
    const text = String(label || '').trim();
    if (!text) return { label: 'Isi nama tim.' };
    if (text.length > 120) return { label: 'Maksimal 120 karakter.' };
    if (looksSecret(text)) return { label: SECRET_TEXT_MESSAGE };
  }
  return {};
}

export const GWS_FIELDS = [
  { name: 'reviewedOn', label: 'Tanggal review', type: 'date', required: true },
  { name: 'activeUsers', label: 'Pengguna aktif', type: 'number', required: true },
  { name: 'superAdmins', label: 'Super admin', type: 'number', required: true },
  { name: 'exUsersActive', label: 'Akun eks-karyawan masih aktif', type: 'number', required: true },
  { name: 'mfaEnforced', label: 'MFA wajib', type: 'switch' },
  { name: 'externalSharingRestricted', label: 'Berbagi ke luar dibatasi', type: 'switch' },
  { name: 'sharedAccountsUsed', label: 'Akun bersama dipakai', type: 'switch' },
];
export function gwsErrors(values, today) {
  const errors = {};
  if (!values.reviewedOn) errors.reviewedOn = 'Isi tanggal review.';
  else if (today && values.reviewedOn > today) errors.reviewedOn = 'Tanggal tidak boleh di masa depan.';
  for (const name of ['activeUsers', 'superAdmins', 'exUsersActive']) {
    const text = String(values[name] ?? '').trim();
    const n = Number(text);
    if (!text) errors[name] = 'Wajib diisi.';
    else if (!Number.isInteger(n) || n < 0 || n > 65535) errors[name] = 'Isi bilangan bulat 0 atau lebih.';
  }
  if (!errors.superAdmins && !errors.activeUsers && Number(values.superAdmins) > Number(values.activeUsers)) errors.superAdmins = 'Tidak boleh lebih dari pengguna aktif.';
  if (looksSecret(values.notes)) errors.notes = SECRET_TEXT_MESSAGE;
  if (String(values.notes || '').length > 500) errors.notes = 'Catatan maksimal 500 karakter.';
  return errors;
}
export function gwsBody(values) {
  const body = {
    reviewedOn: values.reviewedOn,
    activeUsers: Number(values.activeUsers),
    superAdmins: Number(values.superAdmins),
    exUsersActive: Number(values.exUsersActive),
    mfaEnforced: Boolean(values.mfaEnforced),
    externalSharingRestricted: Boolean(values.externalSharingRestricted),
    sharedAccountsUsed: Boolean(values.sharedAccountsUsed),
  };
  const notes = String(values.notes || '').trim();
  if (notes) body.notes = notes;
  return body;
}
export function gwsItems(review) {
  if (!review) return [];
  return [
    { label: 'Tanggal review', value: formatDate(review.reviewedOn) },
    { label: 'Pengguna aktif', value: formatNumber(review.activeUsers) },
    { label: 'Super admin', value: formatNumber(review.superAdmins) },
    { label: 'MFA wajib', translate: true, value: YES_NO(review.mfaEnforced) },
    { label: 'Berbagi ke luar dibatasi', translate: true, value: YES_NO(review.externalSharingRestricted) },
    { label: 'Akun bersama dipakai', translate: true, value: YES_NO(review.sharedAccountsUsed) },
    { label: 'Akun eks-karyawan masih aktif', value: formatNumber(review.exUsersActive) },
    { label: 'Direview oleh', value: review.reviewedByName },
    { label: 'Catatan', value: review.notes },
  ];
}

// ------------------------------------------------------------ IT dashboard "Infrastruktur"
// One StatCard per register that has rows; an empty register has no card.
export function infraCards(block) {
  if (!block) return [];
  const n = (v) => Number(v) || 0;
  const cards = [];
  const to = (tab) => `/it/infrastructure?tab=${tab}`;
  if (n(block.cctv?.total)) {
    const off = n(block.cctv.systemsNotOnline);
    cards.push({ key: 'cctv', label: 'Kamera CCTV', value: formatNumber(n(block.cctv.cameras)), note: off ? `${formatNumber(off)} sistem offline/sebagian` : 'Semua sistem online', alert: off > 0, to: to('cctv') });
  }
  if (n(block.isp?.total)) {
    const without = n(block.isp.locationsWithoutBackup);
    cards.push({ key: 'bandwidth', label: 'Bandwidth utama (Mbps)', value: formatNumber(n(block.isp.primaryMbps)), note: without ? `${formatNumber(without)} lokasi tanpa ISP cadangan` : 'Semua lokasi punya ISP cadangan', alert: false, to: to('isp') });
    const ending = n(block.isp.contractsEnding);
    cards.push({ key: 'contracts', label: `Kontrak ISP berakhir ≤ ${n(block.isp.contractWindowDays) || 60} hari`, value: formatNumber(ending), note: ending ? 'Putuskan perpanjang atau ganti' : null, alert: ending > 0, to: to('isp') });
  }
  if (n(block.backup?.total)) {
    const bad = n(block.backup.failing) + n(block.backup.overdue);
    const untested = n(block.backup.restoreUntested);
    const notes = [];
    if (bad) notes.push(`${formatNumber(bad)} gagal / terlambat diperiksa`);
    if (untested) notes.push(`restore belum diuji ${formatNumber(untested)}`);
    cards.push({ key: 'backup', label: 'Backup aktif', value: formatNumber(n(block.backup.active)), note: notes.join(' · ') || 'Semua diperiksa tepat waktu', alert: bad > 0, to: to('backup') });
  }
  if (n(block.gws?.total)) {
    const g = block.gws;
    cards.push({
      key: 'gws',
      label: 'Keamanan Google Workspace',
      value: g.mfaEnforced ? 'MFA wajib' : 'MFA belum wajib',
      note: `Super admin ${formatNumber(n(g.superAdmins))} · review terakhir ${formatDate(g.reviewedOn)}${g.overdue ? ' (terlambat)' : ''}`,
      alert: n(g.riskFlags) > 0,
      to: to('gws'),
    });
  }
  if (n(block.phone?.total)) {
    cards.push({ key: 'phone', label: 'Nomor perusahaan aktif', value: formatNumber(n(block.phone.active)), note: `${formatNumber(n(block.phone.spare))} cadangan`, alert: false, to: to('phone') });
  }
  return cards;
}

// ------------------------------------------------------------ import (browser side, §4.3)
// Mirrors backend IMPORT_COLUMNS: only these columns are read.
export const IMPORT_COLUMNS = {
  network: [
    { field: 'deviceType', label: 'Tipe', headers: ['Device Type (Router/Switch/AP/NVR)', 'Device Type'], required: true },
    { field: 'serialNumber', label: 'Nomor seri', headers: ['Serial Number'] },
    { field: 'brandModel', label: 'Merek / model', headers: ['Brand/Model', 'Brand / Model'] },
    { field: 'location', label: 'Lokasi', headers: ['Lokasi', 'Location'], required: true },
    { field: 'ipAddress', label: 'Alamat IP', headers: ['IP Address'] },
    { field: 'installedYear', label: 'Tahun pasang', headers: ['Tahun Install', 'Year'] },
    { field: 'ispName', label: 'ISP terkait', headers: ['ISP Terkait', 'ISP'] },
    { field: 'firmware', label: 'Update firmware terakhir', headers: ['Firmware Update Terakhir'] },
    { field: 'status', label: 'Status', headers: ['Status'] },
    { field: 'notes', label: 'Catatan', headers: ['Notes', 'Note', 'Catatan'] },
  ],
  isp: [
    { field: 'location', label: 'Lokasi', headers: ['Lokasi', 'Location'], required: true },
    { field: 'provider', label: 'Provider', headers: ['Provider'], required: true },
    { field: 'customerNumber', label: 'No. pelanggan', headers: ['No Pelanggan', 'Customer No.'] },
    { field: 'bandwidth', label: 'Bandwidth', headers: ['Bandwidth'] },
    { field: 'dedicatedIp', label: 'IP publik dedicated', headers: ['IP Public Dedicated (Yes/No)', 'Dedicated IP'] },
    { field: 'backupIsp', label: 'ISP cadangan', headers: ['Backup ISP (Yes/No)', 'Backup ISP'] },
    { field: 'notes', label: 'Catatan', headers: ['Note', 'Notes', 'Catatan'] },
  ],
  cctv: [
    { field: 'location', label: 'Lokasi', headers: ['Lokasi', 'Location'], required: true },
    { field: 'cameraCount', label: 'Jumlah kamera', headers: ['Jumlah Kamera', 'No. of Cameras'], required: true },
    { field: 'cameraModel', label: 'Model', headers: ['Model'] },
    { field: 'recorderType', label: 'DVR/NVR', headers: ['DVR/NVR', 'Type (DVR/NVR)'] },
    { field: 'remoteAccess', label: 'Akses jarak jauh', headers: ['Remote Access (Yes/No)', 'Remote Access'] },
    { field: 'serialNumber', label: 'Nomor seri', headers: ['Serial Number'] },
    { field: 'sameNetworkAsPc', label: 'Satu jaringan dengan PC', headers: ['Satu Network dengan PC (Yes/No)', '1 Network with PC'] },
    { field: 'notes', label: 'Catatan', headers: ['Catatan', 'Notes', 'Note'] },
  ],
};
export const IMPORT_KIND_LABELS = { network: 'Perangkat jaringan', isp: 'ISP', cctv: 'CCTV' };
export const IMPORT_MAX_ROWS = 2000;
export const SECRET_HEADER_RE = /pass|sandi|kata\s*kunci|user\s*name|username|login|\bpin\b|puk|token|secret|credential/i;
export const normalizeHeader = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const MAX_CELL = 1000;
function cell(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim();
  if (!text) return null;
  return text.length > MAX_CELL ? text.slice(0, MAX_CELL) : text;
}

// Which kind a sheet is, from its header row (first of the first 10 rows that
// holds every required header of a kind). Secret headers are listed, never mapped.
// Headers of the USER device inventory: such a sheet is never read as network
// devices (user devices live in Perangkat, decision 23).
export const USER_DEVICE_HEADERS = ['asset no.', 'nomor aset', 'user name', 'nama user', 'purchase year', 'tahun beli', 'os version', 'ram size (gb)', 'company'];

export function detectSheet(matrix) {
  const limit = Math.min((matrix || []).length, 10);
  for (let r = 0; r < limit; r += 1) {
    const headers = (matrix[r] || []).map(normalizeHeader);
    if (headers.some((h) => USER_DEVICE_HEADERS.includes(h))) continue;
    for (const kind of Object.keys(IMPORT_COLUMNS)) {
      const columns = IMPORT_COLUMNS[kind];
      const found = new Map();
      const secretColumns = [];
      const ignoredColumns = [];
      headers.forEach((h, index) => {
        if (!h) return;
        const original = String(matrix[r][index]).replace(/\s+/g, ' ').trim();
        if (SECRET_HEADER_RE.test(h)) { secretColumns.push(original); return; }
        const col = columns.find((c) => c.headers.some((name) => normalizeHeader(name) === h));
        if (col && ![...found.values()].includes(col.field)) found.set(index, col.field);
        else if (h !== 'no') ignoredColumns.push(original);
      });
      const fields = new Set(found.values());
      if (columns.filter((c) => c.required).every((c) => fields.has(c.field))) {
        // A network sheet also matches nothing else; a CCTV sheet has "Jumlah Kamera".
        return { kind, headerRow: r, columns: found, secretColumns, ignoredColumns };
      }
    }
  }
  return null;
}

// Data rows of a detected sheet as allow-listed objects. A row holding only
// notes continues the row above (the report writes long CCTV notes on extra
// lines); fully empty rows are skipped; secret-looking values are dropped.
export function extractRows(matrix, detection) {
  const rows = [];
  let droppedSecrets = 0;
  if (!detection) return { rows, droppedSecrets };
  for (let r = detection.headerRow + 1; r < (matrix || []).length; r += 1) {
    const source = matrix[r] || [];
    const row = { rowNumber: r + 1 };
    let filled = 0;
    for (const [index, field] of detection.columns.entries()) {
      let value = cell(source[index]);
      if (typeof value === 'string' && looksSecret(value)) { value = null; droppedSecrets += 1; }
      row[field] = value;
      if (value !== null) filled += 1;
    }
    if (!filled) continue;
    const onlyNotes = filled === 1 && row.notes !== null && row.notes !== undefined;
    if (onlyNotes && rows.length) {
      const prev = rows[rows.length - 1];
      prev.notes = [prev.notes, row.notes].filter(Boolean).join('\n').slice(0, MAX_CELL);
      continue;
    }
    rows.push(row);
  }
  return { rows, droppedSecrets };
}

// Reads every sheet of the workbook: [{ sheet, kind, rows, secretColumns, ignoredColumns, droppedSecrets }].
export function readWorkbook(sheets) {
  const out = [];
  for (const s of sheets || []) {
    const detection = detectSheet(s.data);
    if (!detection) continue;
    const { rows, droppedSecrets } = extractRows(s.data, detection);
    out.push({
      sheet: s.sheet, kind: detection.kind, rows, droppedSecrets,
      secretColumns: detection.secretColumns, ignoredColumns: detection.ignoredColumns,
    });
  }
  return out;
}

// Every distinct "Lokasi" text with its row count.
export function locationValues(found) {
  const map = new Map();
  for (const sheet of found || []) {
    for (const row of sheet.rows) {
      const text = row.location === null || row.location === undefined ? '' : String(row.location).trim();
      if (!text) continue;
      map.set(text, (map.get(text) || 0) + 1);
    }
  }
  return [...map.entries()].map(([text, rows]) => ({ text, rows })).sort((a, b) => a.text.localeCompare(b.text, 'id'));
}

// Default mapping: a text equal (case and spaces ignored) to an active location
// of the company maps there; everything else is "Bukan PFN — lewati" (null).
export function defaultLocationMap(values, locations) {
  const map = {};
  for (const { text } of values || []) {
    const match = (locations || []).find((l) => l.isActive !== false && normalizeHeader(l.name) === normalizeHeader(text));
    map[text] = match ? Number(match.id) : null;
  }
  return map;
}

// The request body for preview/apply: one array per kind (merged across sheets).
export function importBody(found, locationMap, updates) {
  const body = { locationMap: { ...(locationMap || {}) } };
  for (const sheet of found || []) {
    body[sheet.kind] = [...(body[sheet.kind] || []), ...sheet.rows];
  }
  if (updates && updates.length) body.updates = [...updates];
  return body;
}

export const ACTION_LABELS = { new: 'Baru', exists: 'Sudah ada', different: 'Berbeda', skip: 'Dilewati' };
export const actionStatus = (action) => ({ new: 'import_new', exists: 'import_exists', different: 'import_different', skip: 'import_skip' }[action] || 'import_exists');
export const PREVIEW_FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'new', label: 'Baru' },
  { key: 'exists', label: 'Sudah ada' },
  { key: 'different', label: 'Berbeda' },
  { key: 'skip', label: 'Dilewati' },
];
export const filterPreview = (rows, key) => (!key || key === 'all' ? rows || [] : (rows || []).filter((r) => r.action === key));

export function previewCounts(preview) {
  const lines = [];
  for (const kind of ['isp', 'network', 'cctv']) {
    const c = preview?.counts?.[kind];
    if (!c || !c.rows) continue;
    lines.push({
      label: IMPORT_KIND_LABELS[kind],
      value: `${formatNumber(c.rows)} baris — ${formatNumber(c.new)} baru, ${formatNumber(c.exists)} sudah ada, ${formatNumber(c.different)} berbeda, ${formatNumber(c.skip)} dilewati`,
    });
  }
  const skipped = Object.entries(preview?.skippedByLocation || {});
  if (skipped.length) lines.push({ label: 'Dilewati per lokasi', value: skipped.map(([t, n]) => `${t} ${formatNumber(n)}`).join(', ') });
  return lines;
}

export function applyLines(result) {
  if (!result) return [];
  const lines = [];
  for (const kind of ['isp', 'network', 'cctv']) {
    lines.push({ label: `${IMPORT_KIND_LABELS[kind]} baru`, value: formatNumber(result.created?.[kind] || 0) });
    if (result.updated?.[kind]) lines.push({ label: `${IMPORT_KIND_LABELS[kind]} diperbarui`, value: formatNumber(result.updated[kind]) });
  }
  lines.push({ label: 'Tidak berubah', value: formatNumber(result.unchanged || 0) });
  lines.push({ label: 'Dilewati', value: formatNumber(result.skipped || 0) });
  return lines;
}
