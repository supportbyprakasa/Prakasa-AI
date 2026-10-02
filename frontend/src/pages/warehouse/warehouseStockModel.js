// Stock from Accurate on the Warehouse page — pure helpers (quantities only).

import { formatDate, formatDateTime } from '../../components/format.js';
import { numberLocale } from '../../i18n/language.js';

// Filter chips and the StatusBadge status of each (tones live in statusTone.js).
export const STOCK_FILTERS = [
  { key: '', label: 'Semua', count: 'total' },
  { key: 'ada', label: 'Ada', count: 'ada' },
  { key: 'habis', label: 'Habis', count: 'habis' },
  { key: 'minus', label: 'Minus', count: 'minus' },
  { key: 'menipis', label: 'Menipis', count: 'menipis' },
];
export const STOCK_STATUS = { ada: 'in_stock', habis: 'out_of_stock', minus: 'negative_stock', menipis: 'low_stock' };

// How long the stock lasts at the last 30 days' outflow; unknown until there
// are 7 days of approved history.
// An item's units: "1 Ctns = 6 Pack", or the base unit alone; — before any approved units.
export function unitsText(units) {
  if (!units?.base) return '—';
  if (!units.others?.length) return units.base;
  return units.others.map((u) => `1 ${u.name} = ${idNumber.format(u.ratio)} ${units.base}`).join(' · ');
}

// Why the cover is unknown: too little approved history, or nothing went out.
export function coverReasonText(reason) {
  if (reason === 'no_outflow') return 'Tidak ada barang keluar 30 hari terakhir';
  if (reason === 'history') return 'Belum cukup riwayat (butuh 7 hari)';
  return '—';
}

export function coverText(daysCover) {
  if (daysCover === null || daysCover === undefined) return '—';
  if (daysCover >= 90) return '> 90 hari';
  // Rounded down: never "± 7 hari" next to a Menipis (< 7 days) badge.
  return `± ${idNumber.format(Math.max(0, Math.floor(daysCover)))} hari`;
}

const idNumber = new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 4 });

// Accurate's own wording ("5 Ctns 3 Pcs") when it has one — never re-summed across units.
export function stockText(qty, qtyAllUnits) {
  if (qtyAllUnits) return qtyAllUnits;
  return idNumber.format(Number(qty) || 0);
}

export function perWarehouseText(warehouses) {
  if (!warehouses?.length) return '—';
  return warehouses.map((w) => `${w.warehouse}: ${stockText(w.qty, w.qtyAllUnits)}`).join(' · ');
}

export function chipLabel(filter, counts) {
  const n = counts?.[filter.count];
  return n === undefined || n === null ? filter.label : `${filter.label} (${idNumber.format(n)})`;
}

// "Per …, disetujui …" — the stock shown is always as of an approved pull.
export function asOfText(status) {
  if (!status?.ready || !status.asOf) return null;
  const { pulledAt, approvedAt, approvedBy } = status.asOf;
  const pulled = pulledAt ? `ditarik ${formatDateTime(pulledAt)}` : null;
  const approved = approvedBy ? `disetujui ${approvedBy}${approvedAt ? ` (${formatDateTime(approvedAt)})` : ''}` : null;
  return ['Stok dari Accurate', pulled, approved].filter(Boolean).join(' · ');
}

// The check shown to the approver of a Warehouse batch (counts only).
export function stockCheckLines(checks) {
  if (!checks?.stock_sum) return [];
  const s = checks.stock_sum;
  const parts = [`${idNumber.format(s.matched)} dari ${idNumber.format(s.items)} barang cocok`];
  if (s.mismatched) parts.push(`${idNumber.format(s.mismatched)} tidak cocok${s.sample?.length ? ` (mis. ${s.sample.slice(0, 3).join(', ')})` : ''}`);
  if (s.unstable) parts.push(`${idNumber.format(s.unstable)} berubah saat ditarik`);
  const lines = [{ label: 'Stok per gudang vs total Accurate', value: parts.join(', ') }];
  if (checks.negative_total !== undefined) {
    lines.push({ label: 'Stok minus di Accurate', value: `${idNumber.format(checks.negative_total)} barang · ${idNumber.format(checks.negative_positions || 0)} posisi gudang` });
  }
  if (checks.complete === false) lines.push({ label: 'Bacaan Accurate', value: 'Tidak lengkap — stok yang tidak terbaca tidak dinolkan' });
  const unread = Object.values(checks.unread_documents || {}).reduce((n, v) => n + Number(v || 0), 0);
  if (unread) lines.push({ label: 'Dokumen belum terbaca', value: `${idNumber.format(unread)} dokumen — tidak ikut batch ini, dibaca lagi pada tarikan berikutnya` });
  return lines;
}

// ------------------------------------------------------------------ documents (stage 2)

export const DOC_TYPES = [
  { key: 'delivery', label: 'Surat jalan' },
  { key: 'receipt', label: 'Penerimaan' },
  { key: 'transfer', label: 'Pindah gudang' },
  { key: 'adjustment', label: 'Penyesuaian' },
];
const ADJUSTMENT_KIND = { opening: 'Saldo awal', opname: 'Stok opname', correction: 'Koreksi', adjustment: 'Penyesuaian' };

export function docTypeLabel(type, counts) {
  const entry = DOC_TYPES.find((d) => d.key === type);
  const n = counts?.[type];
  return entry ? (n === undefined || n === null ? entry.label : `${entry.label} (${idNumber.format(n)})`) : type;
}

export function adjustmentKindLabel(kind) {
  return ADJUSTMENT_KIND[kind] || kind || '—';
}

// A transfer sent out and not yet received sits in transit.
export function transferStatus(doc) {
  if (doc.transferType === 'TRANSFER_OUT' && doc.outStatus === 'SENDING') return 'in_transit';
  return 'received';
}

export function routeText(doc) {
  return `${doc.fromWarehouse || '—'} → ${doc.toWarehouse || '—'}`;
}

export function referenceText(doc) {
  const refs = [...(doc.soNumbers || []), ...(doc.poNumbers || [])];
  return refs.length ? refs.join(', ') : '—';
}

export function lineQtyText(line) {
  const qty = idNumber.format(Number(line.qty) || 0);
  return line.unit ? `${qty} ${line.unit}` : qty;
}

// What the Warehouse documents tabs say while there is nothing to show yet.
export function documentsNotice(status) {
  if (!status?.documents || status.documents.ready) return null;
  if (!status.documents.enabled) {
    return { title: 'Dokumen gudang dari Accurate belum aktif', body: 'Surat jalan, penerimaan, pindah gudang dan penyesuaian tampil di sini setelah fitur ini dinyalakan dan batch pertamanya disetujui.' };
  }
  return { title: 'Dokumen gudang menunggu persetujuan', body: 'Dokumen dari Accurate tampil setelah Supervisor atau Head Warehouse menyetujui batch pertamanya.' };
}

// Export dates as plain calendar dates (the API sends midnight UTC).
export const dateOnly = (value) => (value ? String(value).slice(0, 10) : '');
// A calendar date for people: "29 Sep 2026", "—" when there is none.
export const dayText = (value) => formatDate(dateOnly(value));

// ------------------------------------------------------------------ shipping schedule (program 2.2)

export const SHIPPING_FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'short', label: 'Stok kurang' },
  { key: 'late', label: 'Lewat janji kirim' },
];
export const shippingFilterFrom = (value) => (SHIPPING_FILTERS.some((f) => f.key === value) ? value : 'all');
export const SHIPPING_STOCK = { enough: 'stock_enough', short: 'stock_short' };

export function shippingChipLabel(key, counts) {
  const entry = SHIPPING_FILTERS.find((f) => f.key === key);
  const n = counts?.[key];
  return n === undefined || n === null ? entry.label : `${entry.label} (${idNumber.format(n)})`;
}

export const shipLateText = (so) => (so?.daysLate > 0 ? `Lewat ${idNumber.format(so.daysLate)} hari` : '');

// An SO from before the go-live date: listed, never escalated or counted in OTIF.
export const legacySoText = (so, otifFrom) => (so?.legacy ? `SO lama (sebelum ${otifFrom || '22 Sep'}), tidak dieskalasi` : '');

// Where the promise ("Janji kirim", program 3.4) comes from: Accurate's Tgl
// kirim when Sales set it after the SO date, otherwise the standard — moved to
// Monday when it fell on a Sunday (promiseShifted, sent by the server).
export function promiseSourceText(so) {
  if (!so?.promisedDate) return '';
  if (so.promiseSource === 'so') return 'Tgl kirim di SO';
  const standard = so.slaDays ? `standar ${idNumber.format(so.slaDays)}×24 jam` : 'standar dari tanggal SO';
  return so.promiseShifted ? `${standard}, digeser ke Senin` : standard;
}

// ------------------------------------------------------------------ stock card

const MOVE_LABEL = { receipt: 'Penerimaan', delivery: 'Surat jalan', transfer: 'Pindah gudang', adjustment: 'Penyesuaian' };
export const movementTypeLabel = (type) => MOVE_LABEL[type] || type;

export function movementDirectionText(m) {
  if (m.direction === 'move') return `Pindah ${m.from || '-'} → ${m.to || '-'}`;
  if (m.direction === 'in') return 'Masuk';
  if (m.direction === 'out') return 'Keluar';
  return '—';
}
