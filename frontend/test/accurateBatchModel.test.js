import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changedFields, describeChange, fieldLabel, summaryLines, ACTION_STATUS, BATCH_STATUS, FIELD_KEYS,
} from '../src/pages/sales/accurateBatchModel.js';
import { STATUS_LABELS, statusTone } from '../src/components/statusTone.js';

test('only fields that really change are shown — number formatting is not a change', () => {
  assert.deepEqual(changedFields({ total_amount: '1089000.00', phone: '0812' }, { total_amount: 1089000, phone: '0813' }), [
    { field: 'phone', label: 'Telepon', before: '0812', after: '0813' },
  ]);
  assert.deepEqual(changedFields({ notes: null }, { notes: '' }), []);
});

test('each item reads as one line the approver can check', () => {
  assert.equal(describeChange({ action: 'update', before: { invoice_numbers: null }, after: { invoice_numbers: 'SI64' } }), 'Invoice: — → SI64');
  assert.equal(describeChange({ action: 'create', before: null, after: { name: 'Toko Baru', lines: [{}, {}] } }), 'Nama: Toko Baru · Barang: 2 baris');
  assert.match(describeChange({ action: 'missing' }), /hanya ditandai, tidak ada data yang dihapus/);
  assert.equal(
    describeChange({ action: 'update', before: { outstanding_amount: 999, data: { so_numbers: ['SO1'], _last_update: 'a' } }, after: { outstanding_amount: 0, data: { so_numbers: ['SO1'], _last_update: 'b' } } }),
    'Piutang: Rp 999 → Rp 0',
    'bookkeeping (_last_update) is not shown as a change',
  );
  assert.equal(describeChange({ action: 'create', after: { number: 'SI1', data: { so_numbers: ['SO1', 'SO2'] } } }), 'Nomor: SI1 · SO: SO1, SO2');
  const wide = { action: 'create', after: { name: 'A', city: 'B', channel: 'GT', phone: '1', email: 'e', address: 'x', segment: 's', notes: 'n' } };
  assert.match(describeChange(wide), /^Nama: A · Telepon: 1 · .* \+2 kolom lain \(lihat ekspor\)$/);
  assert.doesNotMatch(describeChange(wide, { full: true }), /kolom lain/);
});

test('the summary lists each kind of data with its counts', () => {
  assert.deepEqual(summaryLines({ counts: { sales_invoice: { create: 12, update: 3, missing: 1 } } }), [
    { type: 'sales_invoice', label: 'Faktur', text: '12 baru, 3 berubah, 1 tidak ada lagi' },
  ]);
});

test('batch statuses use tones that exist', () => {
  for (const { status } of Object.values(BATCH_STATUS)) assert.notEqual(statusTone(status), undefined);
});

test('each kind of change reads with its own shared status (new, changed, gone)', () => {
  for (const status of Object.values(ACTION_STATUS)) assert.ok(STATUS_LABELS[status], `${status} is in statusTone.js`);
  assert.equal(statusTone(ACTION_STATUS.create), 'success');
  assert.equal(statusTone(ACTION_STATUS.missing), 'error');
});

test('values read as dates, rupiah, quantities and Ya/Tidak, never raw', () => {
  assert.equal(
    describeChange({ action: 'create', after: { number: 'SO.1', trans_date: '2026-09-18', total_amount: 12500000 } }),
    'Nomor: SO.1 · Tanggal: 18 Sep 2026 · Total: Rp 12.500.000',
  );
  assert.equal(
    describeChange({ action: 'update', before: { data: { qty: 1200.5, closed: false, percent_shipped: 40 } }, after: { data: { qty: 1000, closed: true, percent_shipped: 100 } } }),
    '% terkirim: 40% → 100% · Stok: 1.200,5 → 1.000 · Ditutup: Tidak → Ya',
  );
  assert.equal(describeChange({ action: 'create', after: { data: { kind: 'opname', transfer_type: 'TRANSFER_OUT', out_status: 'SENDING' } } }),
    'Jenis pindah: Kirim (keluar gudang) · Status kirim: Sedang dikirim · Jenis penyesuaian: Stok opname');
  assert.equal(describeChange({ action: 'create', after: { data: { invoices: [{ number: 'SI1', amount: 1500 }], term_days: 30 } } }),
    'Faktur dibayar: SI1 (Rp 1.500) · Hari termin: 30 hari');
  // An unknown code keeps its value; an unknown column still reads as words.
  assert.equal(describeChange({ action: 'create', after: { data: { out_status: 'OTHER' } } }), 'Status kirim: OTHER');
  assert.equal(fieldLabel('data.new_field'), 'New field');
});

test('every column a batch can carry has an Indonesian label', () => {
  // Mirror columns + each record type's data keys (backend salesAccurateBatches.service.js,
  // services/accurate/warehouseRecordTypes.js, procurementRecordTypes.js).
  const columns = ['number', 'name', 'trans_date', 'due_date', 'customer_no', 'customer_name', 'channel', 'salesman', 'status',
    'dpp_amount', 'total_amount', 'outstanding_amount'];
  const dataKeys = ['category', 'created', 'percent_shipped', 'tax_amount', 'ship_date', 'closed', 'tax_dpp', 'so_numbers', 'lines', 'dp',
    'bank', 'invoices', 'type', 'unit_price', 'is_default', 'is_scrap', 'qty', 'qty_all_units', 'upc', 'item_id', 'warehouse_id', 'warehouse',
    'transfer_type', 'out_status', 'from_wh', 'to_wh', 'transit_wh', 'kind', 'vendor_no', 'vendor_name', 'supplier_do', 'po_numbers',
    'base_unit', 'units', 'expected_date', 'percent_received', 'payment_term', 'term_days', 'currency'];
  for (const key of [...columns, ...dataKeys.map((k) => `data.${k}`)]) assert.ok(FIELD_KEYS.includes(key), `${key} has a label`);
});
