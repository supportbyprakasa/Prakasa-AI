import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changeOf, changeText, emptyReason, kpiCards, latestValue, monthOptions, motionSeries, platformRows, productChange,
  productRows, qtyText, receivableBars, receivableStatus, revenueBars, shipmentStatus, trendCards,
} from '../src/pages/retail/retailModel.js';

// Retail Commerce page model (migration 120).

const months = [
  { key: '2026-08', label: 'Agu 2026' }, { key: '2026-09', label: 'Sep 2026' }, { key: '2026-10', label: 'Okt 2026' },
];
const platform = (channel, label, revenue, extra = {}) => ({
  channel, label, revenue, orders: 2, invoices: 2, aov: revenue / 2, returns: 0, returnRate: 0, share: null,
  revenueThisMonth: 0, revenueLastMonth: 0,
  receivable: { amount: 0, invoices: 0, overdue: 0, overdueInvoices: 0, oldestDue: null },
  shipments: { open: 0, late: 0, oldest: null },
  series: { revenue: [revenue, 0, 0], orders: [1, 1, 0], invoices: [2, 0, 0], returns: [0, 0, 0] },
  ...extra,
});
const overview = {
  connected: true,
  months,
  rules: { shipSlaDays: 2 },
  latestMonth: { key: '2026-08', label: 'Agu 2026' },
  windowRevenue: 1000,
  kpis: {
    revenueThisMonth: 0, revenueLastMonth: 0, revenueChange: 0, invoicesThisMonth: 0, ordersThisMonth: 0, ordersLastMonth: 2,
    aovThisMonth: null, returnsThisMonth: 0, returnRateThisMonth: null, dpInvoicesThisMonth: 0,
    receivable: { amount: 1500000000, invoices: 18, overdue: 1500000000, overdueInvoices: 18 },
    shipments: { open: 2, late: 2, oldest: '2026-09-14' },
  },
  platforms: [
    platform('Shopee', 'Shopee', 800, { share: 80, receivable: { amount: 1200, invoices: 9, overdue: 1200, overdueInvoices: 9 } }),
    platform('TokoPedia', 'Tokopedia', 200, { share: 20, receivable: { amount: 300, invoices: 9, overdue: 0, overdueInvoices: 0 } }),
  ],
  totals: { revenue: [1000, 0, 0], orders: [2, 2, 0], invoices: [4, 0, 0], returns: [0, 0, 0] },
};

test('empty reasons explain the hold in plain words', () => {
  assert.match(emptyReason('not_approved').title, /batch Accurate/);
  assert.match(emptyReason('app_mode').description, /Accurate/);
  assert.match(emptyReason('no_department').title, /Retail Commerce/);
  assert.equal(emptyReason(undefined).title, emptyReason('not_approved').title);
});

test('change between months: percent when last month had sales, amount otherwise', () => {
  assert.deepEqual(changeOf(150, 100), { change: 50, pct: 50, direction: 'up' });
  assert.deepEqual(changeOf(null, 100), { change: null, pct: null, direction: null });
  assert.equal(changeText(150, 100), '+50% dari bulan lalu');
  assert.equal(changeText(80, 100), '-20% dari bulan lalu');
  assert.equal(changeText(3000000, 0), '+Rp 3 jt dari bulan lalu');
  assert.equal(changeText(5, 5), 'Sama dengan bulan lalu');
});

test('KPI cards: unbilled month says when the last invoice was, alarms on late SOs and overdue money', () => {
  const cards = kpiCards(overview);
  assert.deepEqual(cards.map((c) => c.key), ['revenue_month', 'revenue_last_month', 'orders_month', 'aov_month', 'returns_month', 'receivable', 'unshipped']);
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c]));
  assert.equal(byKey.revenue_month.note, 'Ditagih bulanan · belum ada faktur bulan ini · terakhir Agu 2026');
  assert.equal(byKey.revenue_month.empty, true);
  assert.equal(byKey.aov_month.value, null);
  assert.equal(byKey.receivable.alert, true);
  assert.match(byKey.receivable.note, /18 faktur · 18 lewat jatuh tempo \(Rp 1,5 M\)/);
  assert.equal(byKey.unshipped.alert, true);
  assert.equal(byKey.unshipped.note, '2 lewat janji kirim (2×24 jam)');
  for (const c of cards.filter((x) => ['revenue_month', 'aov_month', 'receivable'].includes(x.key))) assert.equal(c.unit, 'rupiah');
  assert.deepEqual(kpiCards(null), []);
});

test('KPI cards: a billed month compares with last month', () => {
  const billed = { ...overview, kpis: { ...overview.kpis, invoicesThisMonth: 2, revenueThisMonth: 120, revenueLastMonth: 100, aovThisMonth: 60, returnRateThisMonth: 2.5 } };
  const byKey = Object.fromEntries(kpiCards(billed).map((c) => [c.key, c]));
  assert.equal(byKey.revenue_month.note, '+20% dari bulan lalu');
  assert.equal(byKey.returns_month.note, '2,5% dari nilai faktur');
});

test('platform bars for BarList: revenue with its share, receivables red when overdue', () => {
  assert.deepEqual(revenueBars(overview.platforms).map((b) => [b.key, b.value, b.display]), [['Shopee', 800, 'Rp 800'], ['TokoPedia', 200, 'Rp 200']]);
  assert.equal(revenueBars(overview.platforms)[1].note, '20% dari total');
  const debts = receivableBars(overview.platforms);
  assert.deepEqual(debts.map((d) => [d.label, d.value, d.tone]), [['Shopee', 1200, 'error'], ['Tokopedia', 300, 'default']]);
  assert.equal(debts[1].note, '9 faktur · 0 lewat jatuh tempo');
  assert.deepEqual(receivableBars([]), []);
});

test('motion chart: one revenue series per platform plus orders; the unbilled month is no figure, not a drop', () => {
  const race = motionSeries(overview);
  assert.deepEqual(race.map((s) => s.key), ['revenue_Shopee', 'revenue_TokoPedia', 'orders']);
  assert.deepEqual(race[0].values, [800, 0, null]);
  assert.deepEqual(race[0].targets, []);
  assert.equal(race[0].unit, 'rupiah');
  assert.deepEqual(race[2].values, [2, 2, 0]);
  for (const s of race) assert.deepEqual(Object.keys(s).sort(), ['better', 'key', 'label', 'targets', 'unit', 'values']);
});

test('trend cards leave out measures that stayed zero', () => {
  const cards = trendCards(overview);
  assert.deepEqual(cards.map((c) => c.key), ['revenue', 'revenue_Shopee', 'revenue_TokoPedia', 'orders']);
  assert.deepEqual(cards[0].values, [1000, 0, null]);
  assert.deepEqual(latestValue(cards[0].values, months), { value: 0, month: 'Sep 2026' });
  assert.deepEqual(latestValue([null, null], months), { value: null, month: null });
});

test('platform rows carry the comparison figures', () => {
  const rows = platformRows(overview.platforms);
  assert.equal(rows[1].id, 'TokoPedia');
  assert.equal(rows[1].label, 'Tokopedia');
  assert.equal(rows[0].receivable, 1200);
  assert.equal(platformRows([{ channel: null, label: 'Lainnya', revenue: 1 }])[0].id, 'other');
});

test('products: quantities per unit or in the base unit, change vs last month', () => {
  assert.equal(qtyText({ baseQty: { qty: 24, unit: 'Pcs' }, qtyByUnit: [{ unit: 'Box', qty: 2 }] }), '24 Pcs');
  assert.equal(qtyText({ baseQty: null, qtyByUnit: [{ unit: 'Box', qty: 2 }, { unit: 'Pcs', qty: 12 }] }), '2 Box + 12 Pcs');
  assert.equal(qtyText({ qtyByUnit: [] }), '—');
  assert.deepEqual(productChange({ isNew: true }), { text: 'Baru bulan ini', tone: 'good' });
  assert.deepEqual(productChange({ isNew: false, changePct: 6.2 }), { text: '+6,2%', tone: 'good' });
  assert.deepEqual(productChange({ isNew: false, changePct: -8.4 }), { text: '-8,4%', tone: 'bad' });
  assert.deepEqual(productChange({ isNew: false, changePct: null }), { text: '—', tone: 'flat' });
  const [row] = productRows([{ code: 'MKR-1', name: 'A', qtyByUnit: [{ unit: 'Pcs', qty: 3 }], platforms: [{ channel: 'TokoPedia', label: 'Tokopedia' }] }]);
  assert.equal(row.id, 'MKR-1');
  assert.equal(row.platformText, 'Tokopedia');
  assert.equal(row.qty, '3 Pcs');
});

test('statuses use the shared status map', () => {
  assert.deepEqual(shipmentStatus({ late: true, daysLate: 15, judged: true }), { status: 'flow_so_late', label: 'Lewat 15 hari' });
  assert.equal(shipmentStatus({ late: false, judged: false }).status, 'pending');
  assert.equal(shipmentStatus({ late: false, judged: true, state: 'partial' }).label, 'Terkirim sebagian');
  assert.deepEqual(receivableStatus({ daysOverdue: 31 }), { status: 'overdue', label: 'Lewat 31 hari' });
  assert.equal(receivableStatus({ daysOverdue: 0 }).status, 'unpaid');
});

test('month options newest first', () => {
  assert.deepEqual(monthOptions(months).map((m) => m.value), ['2026-10', '2026-09', '2026-08']);
});
