// Pencocokan barang masuk/keluar ↔ dokumen Accurate (program 3.2): how the tab
// reads. Pure helpers; tones live in components/statusTone.js. Quantities only,
// in base units; never a price (D1).
import { dayText as formatDate } from './warehouseStockModel.js';
import { numberLocale } from '../../i18n/language.js';

const idNumber = new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 4 });

export const RECON_FILTERS = [
  { key: 'open', label: 'Perlu dicek' },
  { key: 'qty_diff', label: 'Selisih jumlah' },
  { key: 'app_only', label: 'Belum di Accurate' },
  { key: 'acc_only', label: 'Belum di aplikasi' },
  { key: 'uncomparable', label: 'Belum bisa dibandingkan' },
  { key: 'waiting', label: 'Menunggu data Accurate' },
  { key: 'explained', label: 'Dijelaskan' },
  { key: 'matched', label: 'Cocok' },
  { key: 'all', label: 'Semua' },
];
export const DIRECTION_FILTERS = [
  { key: '', label: 'Masuk & keluar' },
  { key: 'inbound', label: 'Barang masuk' },
  { key: 'outbound', label: 'Barang keluar' },
];
export const DIRECTION_LABEL = { inbound: 'Barang masuk', outbound: 'Barang keluar' };
export const RECON_STATUS = {
  matched: 'recon_matched', qty_diff: 'recon_qty_diff', app_only: 'recon_app_only', acc_only: 'recon_acc_only', uncomparable: 'recon_uncomparable',
  waiting: 'recon_waiting',
};
export const isReconFilter = (key) => RECON_FILTERS.some((f) => f.key === key);
export const isDirection = (key) => key === 'inbound' || key === 'outbound';
// A difference the Accurate data does not cover yet (`judged` false: a Warehouse
// batch waits for approval, or pulls stopped). An Accurate document the app
// lacks is always judged; a match needs no judging.
export const isReconWaiting = (g) => Boolean(g) && g.judged === false && !g.explained && !['matched', 'acc_only'].includes(g.status);
export const reconStatusKey = (g) => {
  if (g?.explained) return 'recon_explained';
  if (isReconWaiting(g)) return RECON_STATUS.waiting;
  return RECON_STATUS[g?.status] || 'recon_uncomparable';
};
// Whether the group reaches Pusat Eskalasi once it is old enough — the same
// picks as the management provider: not explained, judged, and not a unit
// Accurate has not approved yet or a document a waiting movement references.
export function reconEscalates(g) {
  if (!g || g.explained || isReconWaiting(g)) return false;
  if (g.status === 'uncomparable') return Boolean(g.missingItemLines);
  if (g.status === 'acc_only') return !g.pendingMovements;
  return g.status === 'app_only' || g.status === 'qty_diff';
}

export function reconChipLabel(key, counts) {
  const entry = RECON_FILTERS.find((f) => f.key === key);
  const n = counts?.[key];
  return n === undefined || n === null ? entry.label : `${entry.label} (${idNumber.format(n)})`;
}

const KIND_TEXT = { number: 'nomor dokumen', supplier_do: 'No. SJ pemasok', reference: 'nomor PO/SO', manual: 'dipasangkan manual' };
export const matchKindText = (kinds) => (kinds || []).map((k) => KIND_TEXT[k] || k).join(', ');

// One line that says what is wrong (or right) with a group.
export function reconReasonText(g) {
  if (!g) return '';
  if (isReconWaiting(g)) return `${statusReason(g)} · data Accurate baru sampai ${g.dataThrough ? formatDate(g.dataThrough) : '—'}`;
  return statusReason(g);
}

function statusReason(g) {
  const dirLabel = (DIRECTION_LABEL[g.direction] || 'pergerakan').toLowerCase();
  switch (g.status) {
    case 'app_only':
      return String(g.groupKey || '').startsWith('m-') ? 'Tanpa nomor referensi — pasangkan manual' : 'Belum ada dokumen Accurate dengan referensi ini';
    case 'acc_only':
      return g.pendingMovements ? 'Ada pergerakan menunggu approval dengan referensi ini' : `Belum dicatat sebagai ${dirLabel} di aplikasi`;
    case 'qty_diff':
      return `${idNumber.format(g.diffItems)} barang beda jumlah`;
    case 'uncomparable':
      return g.missingItemLines
        ? `${idNumber.format(g.missingItemLines)} baris tanpa kode barang`
        : `${idNumber.format(g.unknownLines)} baris dengan satuan belum dikenal`;
    case 'matched':
      return `Cocok lewat ${matchKindText(g.matchKinds) || 'nomor dokumen'}`;
    default:
      return '';
  }
}

// "+2 Pcs" / "−1 Pcs" (Accurate minus the app), in base units.
export function itemDiffText(item) {
  if (!item || item.diff === null || item.diff === undefined) return '—';
  const unit = item.baseUnit || 'satuan dasar';
  if (item.diff === 0) return `0 ${unit}`;
  return `${item.diff > 0 ? '+' : '−'}${idNumber.format(Math.abs(item.diff))} ${unit}`;
}
export const qtyBaseText = (qty, unit) => (qty === null || qty === undefined ? '—' : `${idNumber.format(qty)} ${unit || 'satuan dasar'}`);

export const reconUrl = (direction, groupKey) => `/warehouse?tab=recon&direction=${direction}&group=${encodeURIComponent(groupKey)}`;

// "3 hari" — and "· belum dieskalasi" while it is not in Pusat Eskalasi: inside
// the grace period (it is escalated on the day it is `graceDays` old), or not
// escalated at all yet (`escalates` false, e.g. still waiting for Accurate data).
export function ageText(daysOpen, graceDays = 2, escalates = true) {
  if (daysOpen === null || daysOpen === undefined) return '—';
  const base = daysOpen <= 0 ? 'Hari ini' : `${idNumber.format(daysOpen)} hari`;
  return daysOpen < graceDays || !escalates ? `${base} · belum dieskalasi` : base;
}

// The movement card (barang masuk/keluar detail): where this movement stands against Accurate.
export function reconCardText(recon) {
  if (!recon?.inScope) {
    if (recon?.reason === 'outside_window') return `Lebih dari ${idNumber.format(recon.windowDays || 180)} hari lalu — diselesaikan lewat stock opname.`;
    if (recon?.reason === 'before_recon_from') return `Di luar periode pencocokan (sebelum ${formatDate(recon.reconFrom)}).`;
    return 'Dicocokkan setelah disetujui.';
  }
  if (!recon.docsReady) return 'Dokumen gudang dari Accurate belum disetujui.';
  const docs = recon.docNumbers?.length ? `Dokumen Accurate: ${recon.docNumbers.join(', ')}.` : 'Belum ada dokumen Accurate yang cocok.';
  if (!isReconWaiting(recon)) return docs;
  return `${docs} Data Accurate baru lengkap sampai ${recon.dataThrough ? formatDate(recon.dataThrough) : '—'}; dicek lagi setelah datanya lengkap.`;
}

export const groupTitle = (g) => g?.referenceNo || g?.docNumbers?.[0] || (g?.firstMovementId ? `#${g.firstMovementId}` : '—');

export function lineReason(line) {
  if (!line?.itemNo && !line?.sku) return 'Tanpa kode barang';
  if (line.qtyBase === null || line.qtyBase === undefined) return 'Satuan belum dikenal';
  return '';
}

// Why the tab is empty or partly blind, before the data exists.
export function readinessNotices(readiness) {
  if (!readiness) return [];
  const out = [];
  if (!readiness.documents) {
    out.push({ tone: 'info', title: 'Dokumen gudang dari Accurate belum disetujui', body: 'Pencocokan berjalan setelah Supervisor atau Head Warehouse menyetujui batch pertama yang berisi penerimaan dan surat jalan.' });
  } else if (!readiness.inboundFrom && !readiness.outboundFrom) {
    out.push({ tone: 'info', title: `Belum ada barang masuk/keluar yang disetujui sejak ${formatDate(readiness.reconFrom)}`, body: 'Dokumen Accurate mulai dicocokkan sejak pergerakan pertama disetujui di aplikasi.' });
  }
  if (readiness.documents && !readiness.units) {
    out.push({ tone: 'info', title: 'Satuan barang belum disetujui', body: 'Jumlah hanya bisa dibandingkan bila satuannya pernah dipakai di dokumen Accurate untuk barang itu.' });
  }
  return out;
}

// Differences held back because the Accurate data does not cover them yet.
export function waitingNotice(readiness, counts) {
  if (!counts?.waiting) return null;
  const through = readiness?.dataThrough ? ` baru lengkap sampai ${formatDate(readiness.dataThrough)}` : ' belum lengkap';
  return {
    tone: 'info',
    title: `${idNumber.format(counts.waiting)} selisih menunggu data Accurate`,
    body: `Data gudang dari Accurate${through}: ada batch Warehouse yang menunggu persetujuan, atau tarikan data belum berjalan. Selisih ini dicek lagi setelah datanya lengkap dan belum dieskalasi.`,
  };
}

export function reconFootnote(readiness) {
  // Each part is its own string: the parts are translated one by one.
  const parts = ['Dicocokkan dengan dokumen Accurate yang sudah disetujui', 'jumlah dalam satuan dasar, tanpa harga'];
  if (readiness?.windowDays) parts.push(`${idNumber.format(readiness.windowDays)} hari terakhir (lebih lama diselesaikan lewat stock opname)`);
  if (readiness?.inboundFrom) parts.push(`penerimaan dicek sejak ${formatDate(readiness.inboundFrom)}`);
  if (readiness?.outboundFrom) parts.push(`surat jalan sejak ${formatDate(readiness.outboundFrom)}`);
  return `${parts.join(' · ')}.`;
}
