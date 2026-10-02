import { formatDate as formatDay, formatMoney } from '../../components/format.js';
import { numberLocale } from '../../i18n/language.js';

// A calendar date for people ("7 Okt 2026", "—" when there is none). The API
// sends dates at midnight UTC, so only the day part is read.
export const formatDate = (value) => formatDay(value ? String(value).slice(0, 10) : value);

// Procurement from Accurate (program 2.1): PO states, how quantities and dates
// read, and the checks an approver sees on a Procurement batch. Quantities are
// shown in each line's own unit and never added across units.
const idNumber = new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 4 });
const idPercent = new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 1 });
const idDecimal = new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 2 });

export const PO_STATES = [
  { key: 'all', label: 'Semua' },
  { key: 'open', label: 'Menunggu barang' },
  { key: 'partial', label: 'Sebagian diterima' },
  { key: 'late', label: 'Terlambat' },
  { key: 'received', label: 'Diterima' },
  { key: 'closed', label: 'Ditutup' },
  { key: 'legacy', label: 'PO lama' },
];
export const PO_STATUS = { open: 'po_open', partial: 'po_partial', late: 'po_late', received: 'po_received', closed: 'po_closed', legacy: 'po_legacy' };
export const isPoState = (key) => PO_STATES.some((s) => s.key === key);

export const VENDOR_FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'active', label: 'Aktif 90 hari' },
  { key: 'late', label: 'Ada PO terlambat' },
  { key: 'no_po', label: 'Tanpa PO' },
  { key: 'inactive', label: 'Nonaktif' },
];

export function chipLabel(state, counts) {
  const entry = PO_STATES.find((s) => s.key === state);
  const n = counts?.[state];
  return n === undefined || n === null ? entry.label : `${entry.label} (${idNumber.format(n)})`;
}

// "Terlambat 3 hari" — or, without Accurate's Tgl kirim, "(perkiraan)".
export function dueMeta(order) {
  if (!order) return '';
  if (order.state === 'late' && order.daysLate > 0) return `Terlambat ${idNumber.format(order.daysLate)} hari`;
  return order.estimated ? '(perkiraan) 14 hari dari tanggal PO' : '';
}

export const receivedText = (order) => `${idPercent.format(Number(order?.percentReceived || 0))}%`;

export function qtyText(qty, unit) {
  if (qty === null || qty === undefined) return '—';
  return `${idNumber.format(qty)}${unit ? ` ${unit}` : ''}`;
}

// "12 hari" — or "—" until a PO has been fully received with a receipt date.
export const daysText = (value) => (value === null || value === undefined ? '—' : `${idPercent.format(value)} hari`);

export const rateText = (value) => (value === null || value === undefined ? '—' : `${idPercent.format(value)}%`);

// "Rp 1.250.000" — the shared money format (components/format.js).
export const rupiah = (value) => formatMoney(value);

// Before the first approved batch, the pages say why they are empty.
export function procurementNotice(status) {
  if (!status || status.ready) return null;
  if (status.pending) {
    return { title: 'Data PO menunggu persetujuan', body: 'Data PO dan pemasok dari Accurate tampil setelah Head Procurement menyetujui batch pertamanya.' };
  }
  return { title: 'Data PO dari Accurate belum ada', body: 'Data tampil setelah batch pertama disetujui Head Procurement.' };
}

// What the approver of a Procurement batch reads next to the changes.
export function procurementCheckLines(checks) {
  const c = checks;
  if (!c?.po) return [];
  const p = c.po;
  const lines = [
    { label: 'Bacaan Accurate', value: c.complete ? 'Lengkap' : 'Tidak lengkap — tidak ada yang ditandai tidak ada lagi', translate: true },
    {
      label: 'PO final',
      translate: true,
      value: `${idNumber.format(p.final)} (menunggu ${idNumber.format(p.open)}, sebagian ${idNumber.format(p.partial)}, terlambat ${idNumber.format(p.late)}, `
        + `diterima ${idNumber.format(p.received)}, PO lama ${idNumber.format(p.legacy)}, tanpa tgl datang ${idNumber.format(p.no_expected_date)})`,
    },
  ];
  if (c.lines_match_subtotal?.checked) {
    lines.push({ label: 'Baris cocok dengan subtotal', value: `${idNumber.format(c.lines_match_subtotal.matched)} dari ${idNumber.format(c.lines_match_subtotal.checked)} PO` });
  }
  if (c.units_uncertain) lines.push({ label: 'Baris tanpa rasio satuan', value: idNumber.format(c.units_uncertain) });
  if (c.names_cleaned) lines.push({ label: 'Nama pemasok dibersihkan dari nomor/telepon', value: idNumber.format(c.names_cleaned) });
  const u = c.unmirrored || {};
  const names = { 'purchase-requisition': 'permintaan barang', 'purchase-return': 'retur', 'vendor-claim': 'klaim', 'roll-over': 'roll-over', 'vendor-price': 'harga pemasok' };
  const listed = Object.entries(names).filter(([k]) => u[k] !== undefined).map(([k, label]) => `${label} ${u[k] === null ? '?' : idNumber.format(u[k])}`);
  if (listed.length) lines.push({ label: 'Belum dicerminkan', value: listed.join(', ') });
  return lines;
}

// ------------------------------------------------------------------ Harga beli (program 3.1)

export const PRICE_TRENDS = [
  { key: 'all', label: 'Semua' },
  { key: 'up', label: 'Naik' },
  { key: 'down', label: 'Turun' },
  { key: 'single', label: 'Hanya 1 harga' },
];

export function trendChipLabel(key, counts) {
  const entry = PRICE_TRENDS.find((t) => t.key === key);
  const n = counts?.[key];
  return n === undefined || n === null ? entry.label : `${entry.label} (${idNumber.format(n)})`;
}

// "+12,5%" / "−3%" / "—": the move from the same vendor's previous price.
export function changeText(pct) {
  if (pct === null || pct === undefined) return '—';
  if (pct === 0) return '0%';
  return `${pct > 0 ? '+' : '−'}${idPercent.format(Math.abs(pct))}%`;
}
// The StatusBadge status of a move (its tone lives in statusTone.js): up is a
// warning, down is good news.
export const changeStatus = (pct) => (pct > 0 ? 'price_up' : pct < 0 ? 'price_down' : 'price_same');

// ------------------------------------------------------------------ Saran pesan ulang (program 3.1)

// `timed`: needs the daily outflow, so it can only be counted once the stock
// has MIN_HISTORY_DAYS of history ("Habis, perlu dicek" needs none).
export const REORDER_URGENCIES = [
  { key: 'all', label: 'Semua saran', count: 'total' },
  { key: 'critical', label: 'Habis sebelum barang datang', count: 'critical', timed: true },
  { key: 'reorder', label: 'Pesan sekarang', count: 'reorder', timed: true },
  { key: 'out', label: 'Habis, perlu dicek', count: 'out' },
];
export const REORDER_STATUS = { critical: 'reorder_critical', reorder: 'reorder_now', out: 'reorder_check' };
export const isReorderUrgency = (key) => REORDER_URGENCIES.some((u) => u.key === key);

// Not counted yet: stock not approved, or (for a timed count) too little history.
const tooEarly = (readiness, rules) => (readiness?.historyDays ?? 0) < (rules?.minHistoryDays ?? 7);

// "Habis sebelum barang datang (3)" — without a number while it cannot be
// counted yet, never a "(0)" that only means "not known yet".
export function reorderChipLabel(key, counts, readiness, rules) {
  const entry = REORDER_URGENCIES.find((u) => u.key === key);
  const n = counts?.[entry.count];
  if (!readiness?.stockReady || (entry.timed && tooEarly(readiness, rules))) return entry.label;
  return n === undefined || n === null ? entry.label : `${entry.label} (${idNumber.format(n)})`;
}

// A count on the Procurement day ("Perlu dipesan" = everything the saran list
// holds; "Habis sebelum barang datang" is timed). `link`: the number opens the list.
export function reorderTodayCount(meta, key, { timed = false } = {}) {
  const readiness = meta?.readiness;
  if (!readiness?.stockReady) return { text: '—', link: false };
  if (timed && tooEarly(readiness, meta.rules)) return { text: `mulai ${formatDate(readiness.coverFrom)}`, link: false };
  return { text: `${idNumber.format(Number(meta.counts?.[key] || 0))} barang`, link: true };
}

// What an empty saran list says.
export function reorderEmptyText(readiness, rules, urgency = 'all') {
  if (!readiness?.stockReady) return 'Menunggu stok disetujui Warehouse';
  const entry = REORDER_URGENCIES.find((u) => u.key === urgency);
  if (entry?.timed && tooEarly(readiness, rules)) return `Laju keluar dihitung mulai ${formatDate(readiness.coverFrom)}`;
  return 'Tidak ada barang yang perlu dipesan';
}

// "25 Ctn" — or, for an item nobody can size yet, "Tentukan manual".
export const suggestionText = (s) => (s ? `${idNumber.format(s.units)} ${s.unit || 'satuan dasar'}` : 'Tentukan manual');

// "= 300 Pcs · cukup ± 35 hari" (the base part only when the purchase unit differs).
export function suggestionMeta(s, baseUnit) {
  if (!s) return '';
  const parts = [];
  if (s.ratio !== 1) parts.push(`= ${idNumber.format(s.baseQty)} ${baseUnit || 'satuan dasar'}`);
  if (s.coverAfterDays !== null && s.coverAfterDays !== undefined) parts.push(`cukup ± ${idNumber.format(Math.floor(s.coverAfterDays))} hari`);
  return parts.join(' · ');
}

export function leadTimeText(lead) {
  if (!lead) return '—';
  return lead.source === 'vendor'
    ? `${idNumber.format(lead.days)} hari (rata-rata ${idNumber.format(lead.samples)} PO)`
    : `${idNumber.format(lead.days)} hari (perkiraan)`;
}

export const dailyOutText = (v, unit) => (v === null || v === undefined ? '' : `keluar ± ${idDecimal.format(v)} ${unit || 'satuan dasar'}/hari`);

export function coverDaysText(days, reason) {
  if (days === null || days === undefined) {
    if (reason === 'history') return 'Belum cukup riwayat';
    if (reason === 'no_outflow') return 'Tidak ada barang keluar 30 hari';
    return '—';
  }
  return days > 90 ? '> 90 hari' : `± ${idNumber.format(Math.floor(days))} hari`;
}

// "1 PO, 1 terlambat · PO lama 2 (tidak dihitung)"
export function onOrderMeta(o) {
  if (!o) return '';
  const parts = [];
  if (o.pos) parts.push(`${idNumber.format(o.pos)} PO${o.latePos ? `, ${idNumber.format(o.latePos)} terlambat` : ''}`);
  if (o.legacyPos) parts.push(`PO lama ${idNumber.format(o.legacyPos)} (tidak dihitung)`);
  return parts.join(' · ');
}

// Why the tab is empty or thin, until stock, history and POs are approved.
export function reorderNotice(readiness, rules) {
  if (!readiness) return null;
  if (!readiness.stockReady) {
    return readiness.stockPending
      ? { tone: 'info', title: 'Stok menunggu persetujuan Warehouse', body: 'Saran pesan ulang dihitung dari stok total setelah batch Warehouse disetujui.' }
      : { tone: 'info', title: 'Stok dari Accurate belum ada', body: 'Saran tampil setelah batch stok pertama disetujui Warehouse.' };
  }
  if (readiness.historyDays < (rules?.minHistoryDays ?? 7)) {
    return {
      tone: 'info',
      title: `Laju keluar dihitung mulai ${formatDate(readiness.coverFrom)}`,
      body: 'Sampai saat itu hanya barang habis yang rutin dibeli yang ditampilkan; jumlah pesannya ditentukan manual.',
    };
  }
  if (!readiness.poReady) {
    return { tone: 'warning', title: 'Data PO belum disetujui', body: 'PO yang sedang berjalan belum terhitung, jadi saran bisa lebih besar dari seharusnya.' };
  }
  return null;
}

export function reorderRulesText(rules, readiness) {
  if (!rules) return '';
  // Four sentences joined with " · ": each is a whole string, so each has its
  // own translation (the language switch translates the parts one by one).
  const rule = `Pesan bila stok + PO berjalan < keluar per hari × (waktu datang + ${rules.safetyDays} hari stok pengaman); jumlah = sampai cukup waktu datang + ${rules.safetyDays} + ${rules.orderCycleDays} hari, dibulatkan ke atas per satuan beli`;
  const lead = readiness?.receiptsReady
    ? `waktu datang = rata-rata pemasok (min. ${rules.minLeadSamples} PO), selain itu ${rules.defaultLeadDays} hari (perkiraan)`
    : `waktu datang ${rules.defaultLeadDays} hari (perkiraan) sampai penerimaan gudang disetujui`;
  const legacy = 'PO lama tidak dihitung';
  const totals = 'stok total saja, tanpa stok per gudang.';
  return [rule, lead, legacy, totals].join(' · ');
}
