import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRupiah, formatRupiahShort, daysAgoText, monthLabel, periodRange, monthBars, orderTotals, orderChannelFor,
  CUSTOMER_STATUS_LABEL, listTitle, todayIso, splitServerErrors,
} from '../src/pages/sales/salesModel.js';
import { statusLabel, statusTone } from '../src/components/statusTone.js';

test('rupiah is written the Indonesian way, in full and short', () => {
  assert.equal(formatRupiah(104121408.72), 'Rp 104.121.409');
  assert.equal(formatRupiah(-11330.88), '-Rp 11.331');
  assert.equal(formatRupiah(null), '');
  assert.equal(formatRupiahShort(104121408.72), 'Rp 104,1 jt');
  assert.equal(formatRupiahShort(2169862820), 'Rp 2,17 M');
  assert.equal(formatRupiahShort(85000), 'Rp 85 rb');
  assert.equal(formatRupiahShort(0), 'Rp 0');
  assert.equal(formatRupiahShort(undefined), '');
});

test('days since an event read naturally', () => {
  assert.equal(daysAgoText(0), 'Hari ini');
  assert.equal(daysAgoText(12), '12 hari lalu');
  assert.equal(daysAgoText(null), '');
});

test('period presets are whole calendar months in local time', () => {
  const today = new Date(2026, 8, 29);
  assert.deepEqual(periodRange('this_month', today), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(periodRange('last_month', today), { from: '2026-08-01', to: '2026-08-31' });
  assert.deepEqual(periodRange('last_3_months', today), { from: '2026-07-01', to: '2026-09-30' });
  assert.deepEqual(periodRange('this_year', today), { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(periodRange('all', today), { from: '', to: '' });
  assert.deepEqual(periodRange('this_month', new Date(2026, 0, 15)), { from: '2026-01-01', to: '2026-01-31' });
  assert.equal(periodRange('kemarin', today), null);
});

test('monthly bars show every month in the window, gaps as zero', () => {
  const rows = monthBars([
    { month: '2026-07', revenue: 500, orders: 5, newCustomers: 1 },
    { month: '2026-09', revenue: 1000, orders: 8, newCustomers: 2 },
  ], { count: 3, today: new Date(2026, 8, 29) });
  assert.deepEqual(rows.map((r) => [r.month, r.label, r.revenue, r.pct]), [
    ['2026-07', 'Jul 2026', 500, 50],
    ['2026-08', 'Agu 2026', 0, 0],
    ['2026-09', 'Sep 2026', 1000, 100],
  ]);
  assert.equal(monthLabel('2026-13'), '');
  assert.equal(monthLabel('2026-00'), '');
  assert.equal(monthLabel('Sep'), '');
  assert.ok(monthBars([], { count: 2 }).every((r) => r.pct === 0), 'no data is no bar, never NaN');
});

test('order totals match the server: goods plus delivery, PPN recorded on taxable lines', () => {
  const t = orderTotals([
    { qty: '10', unitPrice: '30000', taxable: true },
    { qty: 2, unitPrice: 70000.5 },
    { qty: '', unitPrice: '' },
  ], '50000');
  assert.equal(t.subtotal, 440001);
  assert.equal(t.deliveryFee, 50000);
  assert.equal(t.totalAmount, 490001);
  assert.equal(t.taxAmount, 33000);
  assert.deepEqual(t.lines.map((l) => l.lineTotal), [300000, 140001, 0]);
  assert.equal(orderChannelFor('TokoPedia'), 'e-Commerce');
  assert.equal(orderChannelFor('Lainnya'), 'GT');
});

test('customer statuses and funnel stages take their tone from the shared status table', () => {
  assert.deepEqual(Object.keys(CUSTOMER_STATUS_LABEL), ['aktif', 'dormant', 'lost']);
  assert.equal(statusTone('aktif'), 'success');
  assert.equal(statusTone('dormant'), 'warning');
  assert.equal(statusTone('lost'), 'error');
  for (const stage of ['prospek', 'belum_order', 'order_pertama']) assert.notEqual(statusLabel(stage), stage, stage);
  assert.equal(statusTone('order_pertama'), 'info');
});

test('amounts are spelled out in Indonesian for invoices and kwitansi', async () => {
  const { terbilang, dueDate } = await import('../src/pages/sales/salesModel.js');
  assert.equal(terbilang(0), 'Nol rupiah');
  assert.equal(terbilang(11), 'Sebelas rupiah');
  assert.equal(terbilang(115), 'Seratus lima belas rupiah');
  assert.equal(terbilang(1000), 'Seribu rupiah');
  assert.equal(terbilang(90000), 'Sembilan puluh ribu rupiah');
  assert.equal(terbilang(1089000), 'Satu juta delapan puluh sembilan ribu rupiah');
  assert.equal(terbilang(2169862820), 'Dua miliar seratus enam puluh sembilan juta delapan ratus enam puluh dua ribu delapan ratus dua puluh rupiah');
  assert.equal(terbilang(1011000.4), 'Satu juta sebelas ribu rupiah');
  assert.equal(dueDate('2026-09-30T00:00:00.000Z', 14), '2026-10-14');
  assert.equal(dueDate('2026-09-30', null), null);
  assert.equal(dueDate(null, 14), null);
});

test('sold quantities stay per unit and are never added up', async () => {
  const { formatQtyByUnit } = await import('../src/pages/sales/salesModel.js');
  assert.equal(formatQtyByUnit([{ unit: 'Ctns', qty: 6000 }, { unit: 'TetraPk', qty: 411 }]), '6.000 Ctns + 411 TetraPk');
  assert.equal(formatQtyByUnit([{ unit: 'Pcs', qty: 12 }]), '12 Pcs');
  assert.equal(formatQtyByUnit([]), '0');
  assert.equal(formatQtyByUnit(undefined), '0');
});

test('sold quantity reads in the base unit once units are known; per unit otherwise', async () => {
  const { soldQty } = await import('../src/pages/sales/salesModel.js');
  assert.deepEqual(soldQty({ qtyByUnit: [{ unit: 'TetraPk', qty: 6408 }, { unit: 'Ctns', qty: 3 }], baseQty: { qty: 6426, unit: 'TetraPk' } }),
    { main: '6.426 TetraPk', detail: '6.408 TetraPk + 3 Ctns' });
  assert.deepEqual(soldQty({ qtyByUnit: [{ unit: 'Bag', qty: 16000 }], baseQty: { qty: 16000, unit: 'Bag' } }), { main: '16.000 Bag', detail: '' });
  assert.deepEqual(soldQty({ qtyByUnit: [{ unit: 'Ctns', qty: 2 }, { unit: 'Pcs', qty: 5 }], baseQty: null }), { main: '2 Ctns + 5 Pcs', detail: '' });
});

test('a list panel names its size once it is known; today is a local calendar day', () => {
  assert.equal(listTitle('Customer', 1234), 'Customer (1.234)');
  assert.equal(listTitle('Customer', 1234, true), 'Customer');
  assert.equal(listTitle('Customer', undefined), 'Customer');
  assert.equal(todayIso(new Date(2026, 8, 30, 23, 59)), '2026-09-30');
});

test('server field errors land on visible fields; the rest become a message', () => {
  const err = (fieldErrors, formErrors = []) => ({ response: { data: { error: { message: 'Input tidak valid', details: { fieldErrors, formErrors } } } } });
  const visible = ['customer', 'items', 'orderDate'];
  const aliases = { customerId: 'customer', lines: 'items' };
  assert.deepEqual(
    splitServerErrors(err({ customerId: ['Pilih customer'], lines: ['Qty harus lebih dari 0'] }), visible, { aliases, fallback: 'Gagal' }),
    { fields: { customer: 'Pilih customer', items: 'Qty harus lebih dari 0' }, message: null },
  );
  // A key with no field on screen is never swallowed.
  assert.deepEqual(
    splitServerErrors(err({ orderDate: ['Isi tanggal'], ownerUserId: ['Bukan akun sales'] }), visible, { aliases, fallback: 'Gagal' }),
    { fields: { orderDate: 'Isi tanggal' }, message: 'Gagal: Bukan akun sales' },
  );
  assert.equal(splitServerErrors(err({}, ['Tanggal kirim sebelum tanggal order']), visible, { fallback: 'Gagal' }).message, 'Gagal: Tanggal kirim sebelum tanggal order');
  assert.equal(splitServerErrors(err({}), visible, { fallback: 'Gagal' }).message, 'Input tidak valid');
  assert.equal(splitServerErrors(new Error('network'), visible, { fallback: 'Gagal' }).message, 'Gagal');
});

test('F01: an order is Lunas only when invoiced and paid; the export says the same words', async () => {
  const m = await import('../src/pages/sales/salesModel.js');
  assert.equal(m.orderBillingStatus({ billingStatus: 'not_invoiced', outstandingAmount: 0 }), 'not_invoiced');
  assert.equal(m.orderBillingText({ billingStatus: 'not_invoiced', outstandingAmount: 0 }), 'Belum difakturkan');
  assert.equal(m.orderBillingText({ billingStatus: 'partly_billed', invoiceCoverage: 40 }), 'Faktur lunas · SO ditagih 40%');
  assert.equal(m.orderBillingText({ billingStatus: 'unknown' }), 'Data pembayaran belum tersedia');
  // An older response without billingStatus never reads zero as Lunas.
  assert.equal(m.orderBillingStatus({ invoiceNumbers: '', outstandingAmount: 0 }), 'not_invoiced');
  assert.equal(m.orderBillingStatus({ invoiceNumbers: 'INV-1', outstandingAmount: null }), 'unknown');
  assert.equal(m.orderBillingStatus({ invoiceNumbers: 'INV-1', outstandingAmount: 0 }), 'paid');
  assert.equal(m.orderBillingStatus({ invoiceNumbers: 'INV-1', outstandingAmount: 5 }), 'unpaid');
});

test('F10: the scope line follows the response — a member never reads "seluruh perusahaan"', async () => {
  const m = await import('../src/pages/sales/salesModel.js');
  assert.match(m.salesScopeText({ viewAll: true, names: [] }), /seluruh perusahaan/);
  const own = m.salesScopeText({ viewAll: false, names: ['BUDI'] });
  assert.doesNotMatch(own, /seluruh perusahaan/);
  assert.match(own, /data Anda saja.*BUDI/);
  const unmapped = m.salesScopeText({ viewAll: false, names: [] });
  assert.match(unmapped, /belum dipetakan/);
  assert.match(unmapped, /Bukan omzet perusahaan/);
  assert.match(m.salesScopeText(null), /dimuat/);
});
