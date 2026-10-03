// Data Accurate waiting for the division's approval: labels and the
// before/after comparison the approver reads before deciding.

import {
  EMPTY, formatDate, formatMoney, formatQty,
} from '../../components/format.js';

export const RECORD_LABEL = {
  customer: 'Pelanggan', item: 'Barang', sales_order: 'Sales order', sales_invoice: 'Faktur',
  delivery_order: 'Surat jalan', sales_receipt: 'Penerimaan', sales_return: 'Retur penjualan',
  wh_warehouse: 'Gudang', wh_stock_total: 'Stok barang', wh_stock: 'Stok per gudang',
  wh_transfer: 'Pindah gudang', wh_adjustment: 'Penyesuaian stok', wh_receipt: 'Penerimaan barang', wh_delivery: 'Surat jalan (gudang)',
  wh_item_unit: 'Satuan barang', wh_so_open: 'SO belum terkirim',
  pc_vendor: 'Pemasok', pc_po: 'Purchase order',
  fin_purchase_invoice: 'Faktur pembelian', fin_purchase_payment: 'Pembayaran pembelian',
};
// Nothing is ever deleted: a document gone from Accurate is marked, not removed.
export const ACTION_LABEL = { create: 'Baru', update: 'Berubah', missing: 'Tidak ada lagi' };
// Tones from components/statusTone.js (batch_create / batch_update / batch_missing).
export const ACTION_STATUS = { create: 'batch_create', update: 'batch_update', missing: 'batch_missing', delete: 'batch_missing' };

export const BATCH_STATUS = {
  pending: { status: 'pending_approval', label: 'Menunggu persetujuan' },
  applied: { status: 'approved', label: 'Disetujui & diterapkan' },
  rejected: { status: 'rejected', label: 'Ditolak' },
  withdrawn: { status: 'cancelled', label: 'Ditarik kembali' },
};

// Every column a batch can carry (the mirror columns and each record type's
// `data` keys in backend services/salesAccurateBatches.service.js and
// services/accurate/*RecordTypes.js), in the order the approver reads them;
// test/accurateBatchModel.test.js checks that none is missing.
const FIELD_LABEL = {
  number: 'Nomor', name: 'Nama', customer_name: 'Pelanggan', trans_date: 'Tanggal', customer_no: 'ID pelanggan', salesman: 'Sales', status: 'Status',
  'data.so_numbers': 'SO', 'data.percent_shipped': '% terkirim', 'data.ship_date': 'Tgl kirim',
  'data.tax_amount': 'PPN', 'data.tax_dpp': 'DPP pajak (e-Faktur)', 'data.dp': 'Faktur uang muka',
  'data.category': 'Kategori', 'data.created': 'Dibuat',
  'data.lines': 'Barang', 'data.invoices': 'Faktur dibayar', 'data.bank': 'Kas/Bank', 'data.unit_price': 'Harga jual',
  'data.type': 'Jenis',
  'data.qty': 'Stok', 'data.qty_all_units': 'Stok (semua satuan)', 'data.warehouse': 'Gudang', 'data.upc': 'Barcode',
  'data.is_default': 'Gudang utama', 'data.is_scrap': 'Gudang barang rusak', 'data.item_id': 'ID barang', 'data.warehouse_id': 'ID gudang',
  'data.transfer_type': 'Jenis pindah', 'data.out_status': 'Status kirim', 'data.from_wh': 'Dari gudang', 'data.to_wh': 'Ke gudang',
  'data.transit_wh': 'Gudang transit', 'data.kind': 'Jenis penyesuaian', 'data.vendor_no': 'ID pemasok', 'data.vendor_name': 'Pemasok',
  'data.supplier_do': 'No. SJ pemasok', 'data.po_numbers': 'PO',
  'data.expected_date': 'Tgl diharapkan datang', 'data.percent_received': '% diterima', 'data.closed': 'Ditutup',
  'data.payment_term': 'Termin', 'data.term_days': 'Hari termin', 'data.currency': 'Mata uang',
  'data.base_unit': 'Satuan dasar', 'data.units': 'Satuan lain (per satuan dasar)',
  phone: 'Telepon', business_phone: 'Telepon usaha', email: 'Email', address: 'Alamat', city: 'Kota',
  channel: 'Channel', sales_person_name: 'Sales', customer_code: 'ID pelanggan',
  order_date: 'Tgl order', delivery_date: 'Tgl kirim', transaction_date: 'Tgl transaksi',
  do_numbers: 'Surat jalan', do_date: 'Tgl surat jalan', invoice_numbers: 'Invoice', invoice_date: 'Tgl invoice',
  due_date: 'Jatuh tempo', dpp_amount: 'DPP', total_amount: 'Total', outstanding_amount: 'Piutang',
  settled_amount: 'Dibayar', tax_amount: 'PPN', subtotal: 'Subtotal', delivery_fee: 'Ongkir', line_count: 'Jumlah baris',
  price: 'Harga', unit: 'Satuan', is_active: 'Aktif', category: 'Kategori', lines: 'Barang', notes: 'Catatan', segment: 'Segmen',
};

// A column nobody named yet still reads as words, never as a raw key.
export const FIELD_KEYS = Object.keys(FIELD_LABEL);
export const fieldLabel = (field) => {
  if (FIELD_LABEL[field]) return FIELD_LABEL[field];
  const words = String(field).replace(/^data\./, '').replace(/[_.]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Kolom lain';
};

// How each kind of value reads: dates, rupiah, quantities, yes/no, codes.
const DATE_FIELDS = new Set(['trans_date', 'due_date', 'data.created', 'data.ship_date', 'data.expected_date',
  'order_date', 'delivery_date', 'transaction_date', 'do_date', 'invoice_date']);
const MONEY_FIELDS = new Set(['dpp_amount', 'total_amount', 'outstanding_amount', 'data.tax_amount', 'data.tax_dpp', 'data.unit_price',
  'settled_amount', 'tax_amount', 'subtotal', 'delivery_fee', 'price']);
const QTY_FIELDS = new Set(['data.qty', 'line_count']);
const PERCENT_FIELDS = new Set(['data.percent_shipped', 'data.percent_received']);
const BOOLEAN_FIELDS = new Set(['data.closed', 'data.is_default', 'data.is_scrap', 'data.dp', 'is_active']);
const CODE_LABEL = {
  'data.kind': { opening: 'Saldo awal', opname: 'Stok opname', correction: 'Koreksi', adjustment: 'Penyesuaian' },
  // The two legs of a move through the transit warehouse (docs/accurate-divisi-rencana.md).
  'data.transfer_type': { TRANSFER_OUT: 'Kirim (keluar gudang)', TRANSFER_IN: 'Terima (masuk gudang)' },
  'data.out_status': { SENDING: 'Sedang dikirim', FULL_RECEIVED: 'Sudah diterima semua' },
};
// Fields whose shown value is interface text, not Accurate's own text.
const LABEL_VALUE_FIELDS = new Set([...BOOLEAN_FIELDS, ...Object.keys(CODE_LABEL), 'data.term_days']);
const yesNo = (value) => (value === true || value === 1 || value === '1' || value === 'true' ? 'Ya' : 'Tidak');

// A list of units reads as its ratios, so a changed ratio shows before → after.
const isUnitList = (value) => Array.isArray(value) && value.length > 0 && value.every((v) => v && typeof v === 'object' && 'name' in v && 'ratio' in v);
// Paid invoices on a receipt: "SI.2026.001 (Rp 1.000.000)".
const isInvoiceList = (value) => Array.isArray(value) && value.length > 0 && value.every((v) => v && typeof v === 'object' && 'number' in v && 'amount' in v);
function show(value, field = '') {
  if (value === null || value === undefined || value === '') return EMPTY;
  if (BOOLEAN_FIELDS.has(field)) return yesNo(value);
  if (isUnitList(value)) return value.map((u) => `1 ${u.name} = ${formatQty(u.ratio)}`).join(', ');
  if (isInvoiceList(value)) return value.map((i) => `${i.number} (${formatMoney(i.amount)})`).join(', ');
  if (Array.isArray(value)) return value.every((v) => typeof v !== 'object') ? (value.join(', ') || EMPTY) : `${value.length} baris`;
  if (typeof value === 'object') return `${Object.keys(value).length} isian`;
  let text = null;
  if (DATE_FIELDS.has(field)) text = formatDate(value);
  else if (MONEY_FIELDS.has(field)) text = formatMoney(value);
  else if (QTY_FIELDS.has(field)) text = formatQty(value);
  else if (PERCENT_FIELDS.has(field)) text = formatQty(value) === EMPTY ? EMPTY : `${formatQty(value)}%`;
  else if (field === 'data.term_days') text = formatQty(value) === EMPTY ? EMPTY : `${formatQty(value)} hari`;
  else if (CODE_LABEL[field]) text = CODE_LABEL[field][value] || null;
  // An unreadable value still shows as it came, never as an empty dash.
  return text && text !== EMPTY ? text : String(value);
}

const same = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b) || (a && typeof a === 'object') || (b && typeof b === 'object')) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '';
  // Accurate and MySQL disagree on number formatting ("1000.00" vs 1000).
  if (!Number.isNaN(Number(a)) && !Number.isNaN(Number(b)) && String(a).trim() !== '' && String(b).trim() !== '') return Number(a) === Number(b);
  return String(a) === String(b);
};

// The fields a change actually touches, as { field, label, before, after }.
const ORDER = FIELD_KEYS;
const rank = (field) => (ORDER.includes(field) ? ORDER.indexOf(field) : ORDER.length);

// `data` holds the extra fields; its keys starting with "_" are bookkeeping.
function flatten(row) {
  if (!row) return {};
  const { data, ...rest } = row;
  const extra = data && typeof data === 'object'
    ? Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [`data.${k}`, v]))
    : {};
  return { ...rest, ...extra };
}

export function changedFields(beforeRow, afterRow) {
  const b = flatten(beforeRow);
  const a = flatten(afterRow);
  return Object.keys(a)
    .filter((field) => !same(b[field], a[field]))
    .sort((x, y) => rank(x) - rank(y))
    .map((field) => ({ field, label: fieldLabel(field), before: show(b[field], field), after: show(a[field], field) }));
}

const CREATE_SHOWN = 6;

// The same line in pieces, for the language switch: a `note` (interface text
// only), or `changes` as { field, label, value } — the label is interface
// text, the value is record data from Accurate — plus `more` hidden columns.
export function describeChangeParts(item, { full = false } = {}) {
  if (item.action === 'missing' || item.action === 'delete') {
    return { note: 'Tidak ada lagi (atau bukan dokumen final) di Accurate — hanya ditandai, tidak ada data yang dihapus' };
  }
  const changes = changedFields(item.action === 'create' ? {} : item.before, item.after);
  if (!changes.length) return { note: 'Tidak ada perbedaan' };
  // `translate`: the value is itself a label of the app ("Ya", "Stok opname",
  // "30 hari"), so `values` (before, after — or the new value alone) are
  // translated one by one; any other value is Accurate's own text.
  const parts = changes.map((c) => ({
    field: c.field,
    label: c.label,
    value: item.action === 'create' ? c.after : `${c.before} → ${c.after}`,
    ...(LABEL_VALUE_FIELDS.has(c.field) ? { translate: true, values: item.action === 'create' ? [c.after] : [c.before, c.after] } : {}),
  }));
  // New records carry every column; the grid shows the first few, the export all.
  const cut = !full && item.action === 'create' && parts.length > CREATE_SHOWN;
  return { changes: cut ? parts.slice(0, CREATE_SHOWN) : parts, more: cut ? parts.length - CREATE_SHOWN : 0 };
}

// One line per item for the grid (full detail stays in the export).
export function describeChange(item, options) {
  const { note, changes, more } = describeChangeParts(item, options);
  if (note) return note;
  const text = changes.map((c) => `${c.label}: ${c.value}`).join(' · ');
  return more ? `${text} · +${more} kolom lain (lihat ekspor)` : text;
}

// "Sales order: 12 baru, 3 berubah" lines from the batch summary.
export function summaryLines(summary) {
  return Object.entries(summary?.counts || {}).map(([type, c]) => ({
    type,
    label: RECORD_LABEL[type] || type,
    text: [c.create && `${c.create} baru`, c.update && `${c.update} berubah`, c.missing && `${c.missing} tidak ada lagi`].filter(Boolean).join(', ') || '—',
  }));
}
