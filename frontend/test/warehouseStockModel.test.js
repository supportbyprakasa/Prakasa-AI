import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STOCK_FILTERS, STOCK_STATUS, asOfText, chipLabel, perWarehouseText, stockCheckLines, stockText,
} from '../src/pages/warehouse/warehouseStockModel.js';
import { statusLabel, statusTone } from '../src/components/statusTone.js';

test('stock reads as Accurate writes it, never re-summed across units', () => {
  assert.equal(stockText(120, '5 Ctns'), '5 Ctns');
  assert.equal(stockText(1234.5, null), '1.234,5');
  assert.equal(stockText(null, null), '0');
  assert.equal(perWarehouseText([{ warehouse: 'Gudang Utama', qty: 100, qtyAllUnits: '4 Ctns' }, { warehouse: 'Transit', qty: 20 }]), 'Gudang Utama: 4 Ctns · Transit: 20');
  assert.equal(perWarehouseText([]), '—');
});

test('Ada / Habis / Minus use the shared status table', () => {
  assert.deepEqual(Object.values(STOCK_STATUS).map((s) => [statusTone(s), statusLabel(s)]), [['success', 'Ada'], ['default', 'Habis'], ['error', 'Minus'], ['warning', 'Menipis']]);
  assert.deepEqual(STOCK_FILTERS.map((f) => chipLabel(f, { total: 1738, ada: 576, habis: 1024, minus: 138, menipis: 12 })),
    ['Semua (1.738)', 'Ada (576)', 'Habis (1.024)', 'Minus (138)', 'Menipis (12)']);
  assert.equal(chipLabel(STOCK_FILTERS[1], undefined), 'Ada');
});

test('the stock always says which approved pull it is from', () => {
  assert.equal(asOfText({ ready: false }), null);
  const text = asOfText({ ready: true, asOf: { pulledAt: '2026-09-29T13:00:00Z', approvedAt: '2026-09-29T14:00:00Z', approvedBy: 'Head Warehouse' } });
  assert.match(text, /^Stok dari Accurate · ditarik .+ · disetujui Head Warehouse \(.+\)$/);
});

test('the approver sees how well stock per gudang adds up, and the minus count', () => {
  const lines = stockCheckLines({
    stock_sum: { items: 1738, matched: 1728, mismatched: 10, unstable: 2, sample: ['A', 'B', 'C', 'D'] },
    negative_total: 138, negative_positions: 196, complete: true,
  });
  assert.deepEqual(lines, [
    { label: 'Stok per gudang vs total Accurate', value: '1.728 dari 1.738 barang cocok, 10 tidak cocok (mis. A, B, C), 2 berubah saat ditarik' },
    { label: 'Stok minus di Accurate', value: '138 barang · 196 posisi gudang' },
  ]);
  assert.equal(stockCheckLines({ stock_sum: { items: 1, matched: 1, mismatched: 0, unstable: 0 }, complete: false }).at(-1).label, 'Bacaan Accurate');
  assert.deepEqual(stockCheckLines(undefined), []);
  const unread = stockCheckLines({ stock_sum: { items: 1, matched: 1 }, unread_documents: { wh_transfer: 1, wh_receipt: 2 } }).at(-1);
  assert.deepEqual(unread, { label: 'Dokumen belum terbaca', value: '3 dokumen — tidak ikut batch ini, dibaca lagi pada tarikan berikutnya' });
});

test('documents read the way the Warehouse speaks: route, transit, kind, references', async () => {
  const m = await import('../src/pages/warehouse/warehouseStockModel.js');
  assert.equal(m.docTypeLabel('delivery', { delivery: 68 }), 'Surat jalan (68)');
  assert.equal(m.docTypeLabel('transfer'), 'Pindah gudang');
  assert.equal(m.adjustmentKindLabel('opening'), 'Saldo awal');
  assert.equal(m.transferStatus({ transferType: 'TRANSFER_OUT', outStatus: 'SENDING' }), 'in_transit');
  assert.equal(m.transferStatus({ transferType: 'TRANSFER_OUT', outStatus: 'FULL_RECEIVED' }), 'received');
  assert.deepEqual([statusTone('in_transit'), statusLabel('in_transit')], ['info', 'Dalam perjalanan']);
  assert.equal(m.routeText({ fromWarehouse: 'WH A', toWarehouse: 'WH B' }), 'WH A → WH B');
  assert.equal(m.referenceText({ soNumbers: ['SO1'], poNumbers: [] }), 'SO1');
  assert.equal(m.referenceText({}), '—');
  assert.equal(m.lineQtyText({ qty: 1200, unit: 'Pcs' }), '1.200 Pcs');
});

test('days of cover reads plainly, and is unknown until there is history', async () => {
  const { coverText } = await import('../src/pages/warehouse/warehouseStockModel.js');
  assert.equal(coverText(null), '—');
  assert.equal(coverText(3.4), '± 3 hari');
  assert.equal(coverText(120), '> 90 hari');
  assert.equal(coverText(6.6), '± 6 hari', 'never ± 7 next to a Menipis badge');
});

test('an unknown cover says why', async () => {
  const { coverReasonText } = await import('../src/pages/warehouse/warehouseStockModel.js');
  assert.equal(coverReasonText('no_outflow'), 'Tidak ada barang keluar 30 hari terakhir');
  assert.equal(coverReasonText('history'), 'Belum cukup riwayat (butuh 7 hari)');
  assert.equal(coverReasonText(null), '—');
});

test('an item\'s units read as base-unit ratios', async () => {
  const { unitsText } = await import('../src/pages/warehouse/warehouseStockModel.js');
  assert.equal(unitsText({ base: 'Pack', others: [{ name: 'Ctns', ratio: 6 }] }), '1 Ctns = 6 Pack');
  assert.equal(unitsText({ base: 'Pcs', others: [] }), 'Pcs');
  assert.equal(unitsText(null), '—');
});

test('the shipping schedule and the stock card read plainly', async () => {
  const m = await import('../src/pages/warehouse/warehouseStockModel.js');
  assert.equal(m.shippingChipLabel('short', { short: 2 }), 'Stok kurang (2)');
  assert.equal(m.shipLateText({ daysLate: 3 }), 'Lewat 3 hari');
  assert.equal(m.shipLateText({ daysLate: 0 }), '');
  assert.equal(m.movementTypeLabel('delivery'), 'Surat jalan');
  assert.equal(m.movementDirectionText({ direction: 'move', from: 'WH A', to: 'WH B' }), 'Pindah WH A → WH B');
  assert.equal(m.movementDirectionText({ direction: 'out' }), 'Keluar');
});

test('Janji kirim: the late chip, a deep-linked filter, and where the promise comes from', async () => {
  const m = await import('../src/pages/warehouse/warehouseStockModel.js');
  assert.equal(m.shippingChipLabel('late', { late: 2 }), 'Lewat janji kirim (2)');
  assert.equal(m.shippingFilterFrom('late'), 'late');
  assert.equal(m.shippingFilterFrom('x'), 'all');
  assert.equal(m.shippingFilterFrom(null), 'all');
  assert.equal(m.promiseSourceText({ promisedDate: '2026-10-03', promiseSource: 'so' }), 'Tgl kirim di SO');
  assert.equal(m.promiseSourceText({ promisedDate: '2026-10-03', promiseSource: 'standard', slaDays: 2 }), 'standar 2×24 jam');
  // A Friday SO: SO date + 2 days is a Sunday, so the standard promise moved to Monday.
  assert.equal(m.promiseSourceText({ date: '2026-10-02', promisedDate: '2026-10-05', promiseSource: 'standard', slaDays: 2, promiseShifted: true }), 'standar 2×24 jam, digeser ke Senin');
  assert.equal(m.promiseSourceText({ date: '2026-10-02', promisedDate: '2026-10-07', promiseSource: 'so', slaDays: 2, promiseShifted: false }), 'Tgl kirim di SO');
  assert.equal(m.promiseSourceText({}), '');
  assert.equal(m.legacySoText({ legacy: true }, '22 Sep 2026'), 'SO lama (sebelum 22 Sep 2026), tidak dieskalasi');
  assert.equal(m.legacySoText({ legacy: false }, '22 Sep 2026'), '');
});
