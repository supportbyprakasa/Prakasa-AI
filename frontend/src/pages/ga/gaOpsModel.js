import { formatDate, formatMoney, formatNumber } from '../../components/format.js';
import { MONTHS_SHORT as MONTHS } from '../../i18n/names.js';

// Operasional GA (migration 114): office operations run by GA inside People &
// Culture — scheduled upkeep, service/lease contracts and utility bills. Labels
// mirror backend/src/config/gaOps.js.

export const TABS = [
  { k: 'maintenance', l: 'Perawatan berkala' },
  { k: 'contracts', l: 'Kontrak & sewa' },
  { k: 'bills', l: 'Tagihan utilitas' },
];
export const tabFrom = (value) => (TABS.some((t) => t.k === value) ? value : 'maintenance');

export const ENDPOINTS = { maintenance: '/ga/ops/maintenance', contracts: '/ga/ops/contracts', bills: '/ga/ops/bills' };
export const RECORD_LABELS = { maintenance: 'Jadwal perawatan', contracts: 'Kontrak', bills: 'Tagihan' };
export const ADD_LABELS = { maintenance: 'Tambah jadwal perawatan', contracts: 'Tambah kontrak', bills: 'Catat tagihan' };

export const CATEGORY_LABELS = {
  ac: 'AC', apar: 'APAR (pemadam api)', genset: 'Genset', lift: 'Lift', pest_control: 'Pengendalian hama',
  water: 'Air & pompa', electrical: 'Listrik & panel', building: 'Gedung', other: 'Lainnya',
};
// Usual interval per kind of upkeep, offered when a schedule is added (editable).
export const DEFAULT_INTERVAL_DAYS = {
  ac: 90, apar: 180, genset: 30, lift: 30, pest_control: 30, water: 90, electrical: 180, building: 180, other: 90,
};
export const CONTRACT_KIND_LABELS = {
  building_lease: 'Sewa gedung', cleaning: 'Kebersihan', security: 'Keamanan', pest_control: 'Pengendalian hama',
  waste: 'Sampah', maintenance: 'Perawatan', other: 'Lainnya',
};
export const UTILITY_LABELS = { electricity: 'Listrik', water: 'Air', gas: 'Gas', other: 'Lainnya' };
export const UTILITY_UNITS = { electricity: 'kWh', water: 'm³', gas: 'm³', other: '' };
export const RESULT_LABELS = { ok: 'Baik', follow_up: 'Perlu tindak lanjut' };

const options = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }));

/** "2026-09" → "Sep 2026". */
export function formatPeriod(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

/** Next month back to 24 months ago, newest first, as Select options. */
export function periodOptions(today, current = '') {
  const [y, m] = String(today).slice(0, 7).split('-').map(Number);
  const out = [];
  for (let i = -1; i < 24; i += 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const value = d.toISOString().slice(0, 7);
    out.push({ value, label: formatPeriod(value) });
  }
  if (current && !out.some((o) => o.value === current)) out.push({ value: current, label: formatPeriod(current) });
  return out;
}

// ------------------------------------------------------------ state of a row
export function stateOf(kind, r) {
  if (kind === 'maintenance') {
    if (r.status === 'retired') return 'upkeep_retired';
    if (r.overdue) return 'upkeep_overdue';
    return r.dueSoon ? 'upkeep_soon' : 'upkeep_ok';
  }
  if (kind === 'contracts') {
    if (r.status === 'ended') return 'contract_ended';
    if (r.lapsed) return 'contract_lapsed';
    return r.ending ? 'contract_ending' : 'contract_active';
  }
  if (r.paidOn) return 'bill_paid';
  if (r.overdue) return 'bill_overdue';
  return r.dueSoon ? 'bill_soon' : 'bill_unpaid';
}

export const STATE_LABELS = {
  upkeep_ok: 'Sesuai jadwal', upkeep_soon: 'Segera', upkeep_overdue: 'Lewat jadwal', upkeep_retired: 'Tidak dipakai',
  contract_active: 'Aktif', contract_ending: 'Segera berakhir', contract_lapsed: 'Lewat masa kontrak', contract_ended: 'Selesai',
  bill_paid: 'Dibayar', bill_unpaid: 'Belum dibayar', bill_soon: 'Segera jatuh tempo', bill_overdue: 'Lewat jatuh tempo',
};
const STATE_ORDER = Object.keys(STATE_LABELS);

/** Filter chips: the states present in the rows, in a fixed order. */
export function stateChips(kind, rows) {
  const present = new Set(rows.map((r) => stateOf(kind, r)));
  return STATE_ORDER.filter((k) => present.has(k)).map((k) => ({ key: k, label: STATE_LABELS[k] }));
}

// The same title as parts for <Mixed>: names are record data, the utility and
// the period are labels.
export function rowTitleParts(kind, r) {
  const own = (text) => (text ? { text, data: true } : null);
  if (!r) return [];
  if (kind === 'maintenance') return [own(r.name)];
  if (kind === 'contracts') return [own(r.vendorName)];
  return [UTILITY_LABELS[r.utility], formatPeriod(r.period), own(r.locationName)];
}

export function rowTitle(kind, r) {
  if (!r) return '';
  if (kind === 'maintenance') return r.name;
  if (kind === 'contracts') return r.vendorName;
  return [UTILITY_LABELS[r.utility], formatPeriod(r.period), r.locationName].filter(Boolean).join(' · ');
}

// ------------------------------------------------------------ form fields
export function formFields(kind, today) {
  if (kind === 'maintenance') {
    return [
      { name: 'name', label: 'Nama', type: 'text', required: true, max: 150, hint: 'Misalnya: AC ruang rapat lantai 2' },
      { name: 'category', label: 'Jenis perawatan', type: 'select', required: true, options: options(CATEGORY_LABELS) },
      { name: 'locationId', label: 'Lokasi', type: 'location', required: true },
      { name: 'vendorName', label: 'Vendor', type: 'text', max: 150 },
      { name: 'intervalDays', label: 'Interval (hari)', type: 'number', required: true, hint: 'Misalnya 90 untuk servis AC tiap 3 bulan' },
      { name: 'lastDoneOn', label: 'Perawatan terakhir', type: 'date' },
      { name: 'nextDueOn', label: 'Jadwal berikutnya', type: 'date', hint: 'Kosongkan: dihitung dari perawatan terakhir (atau hari ini) + interval' },
      { name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'active', label: 'Aktif' }, { value: 'retired', label: 'Tidak dipakai' }], editOnly: true },
      { name: 'notes', label: 'Catatan', type: 'textarea', max: 500 },
    ];
  }
  if (kind === 'contracts') {
    return [
      { name: 'vendorName', label: 'Vendor', type: 'text', required: true, max: 150 },
      { name: 'kind', label: 'Jenis', type: 'select', required: true, options: options(CONTRACT_KIND_LABELS) },
      { name: 'description', label: 'Keterangan', type: 'text', max: 190, hint: 'Misalnya: 4 petugas kebersihan, Senin–Sabtu' },
      { name: 'locationId', label: 'Lokasi', type: 'location' },
      { name: 'startOn', label: 'Mulai', type: 'date' },
      { name: 'endOn', label: 'Berakhir', type: 'date' },
      { name: 'noticeDays', label: 'Pengingat sebelum berakhir (hari)', type: 'number', required: true, hint: 'Eskalasi muncul sejak tanggal ini agar sempat memutuskan perpanjang atau ganti vendor' },
      { name: 'monthlyCost', label: 'Biaya per bulan (Rp)', type: 'number' },
      { name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'active', label: 'Aktif' }, { value: 'ended', label: 'Selesai' }], editOnly: true },
      { name: 'notes', label: 'Catatan', type: 'textarea', max: 500 },
    ];
  }
  return [
    { name: 'utility', label: 'Jenis', type: 'select', required: true, options: options(UTILITY_LABELS) },
    { name: 'locationId', label: 'Lokasi', type: 'location', required: true },
    { name: 'customerNumber', label: 'ID pelanggan / nomor meter', type: 'text', max: 60, hint: 'Dari tagihan PLN/PDAM — membedakan dua meter di satu lokasi' },
    { name: 'period', label: 'Periode', type: 'select', required: true, options: periodOptions(today) },
    { name: 'amount', label: 'Jumlah tagihan (Rp)', type: 'number', required: true },
    { name: 'usageAmount', label: 'Pemakaian', type: 'number', hint: 'kWh untuk listrik, m³ untuk air/gas' },
    { name: 'dueOn', label: 'Jatuh tempo', type: 'date' },
    { name: 'paidOn', label: 'Tanggal dibayar', type: 'date', hint: 'Pembayaran diajukan lewat Finance; isi setelah lunas' },
    { name: 'notes', label: 'Catatan', type: 'textarea', max: 500 },
  ];
}

const NUMBER_FIELDS = new Set(['intervalDays', 'noticeDays', 'monthlyCost', 'amount', 'usageAmount', 'locationId']);
const str = (v) => (v === null || v === undefined ? '' : String(v));

export function formValues(kind, row, today) {
  if (row) {
    const out = {};
    for (const f of formFields(kind, today)) out[f.name] = str(row[f.name]);
    return out;
  }
  if (kind === 'maintenance') return { name: '', category: '', locationId: '', vendorName: '', intervalDays: '', lastDoneOn: '', nextDueOn: '', status: 'active', notes: '' };
  if (kind === 'contracts') return { vendorName: '', kind: '', description: '', locationId: '', startOn: '', endOn: '', noticeDays: '60', monthlyCost: '', status: 'active', notes: '' };
  return { utility: '', locationId: '', customerNumber: '', period: String(today).slice(0, 7), amount: '', usageAmount: '', dueOn: '', paidOn: '', notes: '' };
}

const isNumber = (v) => v !== '' && Number.isFinite(Number(v));

export function formErrors(kind, values, editing, today) {
  const errors = {};
  for (const f of formFields(kind, today)) {
    if (f.editOnly && !editing) continue;
    const v = str(values[f.name]).trim();
    if (f.required && !v) errors[f.name] = `${f.label} wajib diisi.`;
    else if (v && f.type === 'number' && (!isNumber(v) || Number(v) < 0)) errors[f.name] = 'Isi angka 0 atau lebih.';
  }
  if (kind === 'maintenance' && !errors.intervalDays && values.intervalDays) {
    const n = Number(values.intervalDays);
    if (!Number.isInteger(n) || n < 1 || n > 1830) errors.intervalDays = 'Interval 1–1830 hari.';
  }
  if (kind === 'maintenance' && values.lastDoneOn && values.lastDoneOn > today) errors.lastDoneOn = 'Tidak boleh di masa depan.';
  if (kind === 'contracts' && !errors.noticeDays && values.noticeDays && (!Number.isInteger(Number(values.noticeDays)) || Number(values.noticeDays) > 365)) {
    errors.noticeDays = 'Isi 0–365 hari.';
  }
  if (kind === 'contracts' && values.startOn && values.endOn && values.endOn < values.startOn) errors.endOn = 'Tidak boleh sebelum tanggal mulai.';
  if (kind === 'bills' && values.paidOn && values.paidOn > today) errors.paidOn = 'Tidak boleh di masa depan.';
  return errors;
}

/** The API body: every field for a new row; for an edit only what changed, plus version. */
export function formBody(kind, values, row, today) {
  const body = {};
  for (const f of formFields(kind, today)) {
    if (f.editOnly && !row) continue;
    const raw = str(values[f.name]).trim();
    let value;
    if (raw === '') value = null;
    else value = NUMBER_FIELDS.has(f.name) ? Number(raw) : raw;
    if (row) {
      if (str(row[f.name]) !== str(value)) body[f.name] = value;
    } else if (value !== null) body[f.name] = value;
  }
  if (row) body.version = row.version;
  return body;
}

// ------------------------------------------------------------ detail and history
export function detailItems(kind, r) {
  if (kind === 'maintenance') {
    return [
      { label: 'Jenis perawatan', value: CATEGORY_LABELS[r.category] || r.category, translate: true },
      { label: 'Lokasi', value: r.locationName },
      { label: 'Vendor', value: r.vendorName },
      { label: 'Interval', value: `${formatNumber(r.intervalDays)} hari`, translate: true },
      { label: 'Perawatan terakhir', value: formatDate(r.lastDoneOn) },
      { label: 'Jadwal berikutnya', value: formatDate(r.nextDueOn) },
      { label: 'Catatan', value: r.notes },
    ];
  }
  if (kind === 'contracts') {
    return [
      { label: 'Jenis', value: CONTRACT_KIND_LABELS[r.kind] || r.kind },
      { label: 'Keterangan', value: r.description },
      { label: 'Lokasi', value: r.locationName },
      { label: 'Masa kontrak', value: [formatDate(r.startOn), formatDate(r.endOn)].filter((v) => v && v !== '—').join(' – ') },
      { label: 'Pengingat mulai', value: r.decisionOn ? `${formatDate(r.decisionOn)} (${r.noticeDays} hari sebelum berakhir)` : '', translate: true },
      { label: 'Biaya per bulan', value: r.monthlyCost != null ? formatMoney(r.monthlyCost) : '' },
      { label: 'Catatan', value: r.notes },
    ];
  }
  const unit = UTILITY_UNITS[r.utility];
  return [
    { label: 'Jenis', value: UTILITY_LABELS[r.utility] || r.utility, translate: true },
    { label: 'Lokasi', value: r.locationName },
    { label: 'ID pelanggan', value: r.customerNumber },
    { label: 'Periode', value: formatPeriod(r.period) },
    { label: 'Jumlah tagihan', value: formatMoney(r.amount) },
    { label: 'Pemakaian', value: r.usageAmount != null ? `${formatNumber(r.usageAmount)}${unit ? ` ${unit}` : ''}` : '' },
    { label: 'Jatuh tempo', value: formatDate(r.dueOn) },
    { label: 'Dibayar', value: formatDate(r.paidOn) },
    { label: 'Catatan', value: r.notes },
  ];
}

export function logErrors(values, today) {
  const errors = {};
  if (!values.doneOn) errors.doneOn = 'Tanggal dikerjakan wajib diisi.';
  else if (values.doneOn > today) errors.doneOn = 'Tidak boleh di masa depan.';
  if (values.cost !== '' && values.cost !== undefined && (!isNumber(values.cost) || Number(values.cost) < 0)) errors.cost = 'Isi angka 0 atau lebih.';
  return errors;
}

export function logBody(values) {
  return {
    doneOn: values.doneOn,
    result: values.result || 'ok',
    ...(values.cost !== '' && values.cost !== undefined ? { cost: Number(values.cost) } : {}),
    ...(String(values.note || '').trim() ? { note: String(values.note).trim() } : {}),
  };
}

/** Page summary line (header banner): what needs GA's attention now. */
export function attentionText(s) {
  if (!s) return '';
  const parts = [];
  if (s.maintenanceOverdue) parts.push(`${formatNumber(s.maintenanceOverdue)} perawatan lewat jadwal`);
  if (s.contractsEnding) parts.push(`${formatNumber(s.contractsEnding)} kontrak segera berakhir`);
  if (s.billsOverdue) parts.push(`${formatNumber(s.billsOverdue)} tagihan lewat jatuh tempo`);
  return parts.join(' · ');
}

export function tabCount(s, k) {
  if (!s) return undefined;
  if (k === 'maintenance') return s.maintenanceOverdue + s.maintenanceDueSoon || undefined;
  if (k === 'contracts') return s.contractsEnding || undefined;
  return s.billsOverdue || undefined;
}
