import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {
  FLOW_TABS, PERIOD_PRESETS, PURCHASE_TARGET_LINK, RECEIVABLE_AGING_LINK, allowedLink, coverageWarning, daysText, dueSourceText,
  filterProducts, filterSlow, flowTabs, isPreset, monthText,
  normalizeMargin, normalizePurchaseFlow, normalizeSalesFlow, normalizeSlowMovers, pctText, pendingText, periodText,
  productCounts, productStatus, qtyText, relevantPending, shareText, slowChipLabel, slowCounts, stepGapText,
} from '../src/pages/advanced/managementFlowModel.js';
import { readTargetParams } from '../src/pages/advanced/targetsModel.js';
import { PERIOD_OPTIONS, periodRange } from '../src/pages/sales/salesModel.js';
import { STATUS_LABELS, statusTone } from '../src/components/statusTone.js';
import { hasRouteAccess } from '../src/components/navigation.js';

const require = createRequire(import.meta.url);
const { STANDARD_ROLES } = require('../../backend/src/config/standardOrganization.js');
const perms = (key) => STANDARD_ROLES.find((r) => r.key === key).permissions;

test('tabs follow the audience: flows for management, margin with prices, slow movers with stock', () => {
  assert.deepEqual(flowTabs(perms('management_office.supervisor')).map((t) => t.k), ['sales', 'purchase', 'margin', 'slow']);
  assert.deepEqual(flowTabs(perms('management_office.head')).map((t) => t.k), ['sales', 'purchase', 'margin', 'slow']);
  assert.deepEqual(flowTabs(['management_dashboard.view', 'warehouse.stock.view']).map((t) => t.k), ['sales', 'purchase', 'slow'], 'no margin without procurement.price.view');
  assert.deepEqual(flowTabs(['management_dashboard.view', 'procurement.price.view']).map((t) => t.k), ['sales', 'purchase', 'margin'], 'no slow movers without warehouse.stock.view');
  assert.deepEqual(flowTabs(['management_dashboard.division', 'procurement.price.view', 'warehouse.stock.view']), [], 'a division Head gets nothing');
  assert.deepEqual(flowTabs(null), []);
  assert.equal(FLOW_TABS.find((t) => t.k === 'margin').l, 'Perkiraan margin (harga PO)');
});

test('only management reaches /management/flow; division Heads are sent home', () => {
  assert.equal(hasRouteAccess('/management/flow', perms('management_office.supervisor')), true);
  assert.equal(hasRouteAccess('/management/flow', perms('management_office.head')), true);
  for (const key of ['warehouse.head', 'sales.head', 'procurement.head']) {
    assert.equal(hasRouteAccess('/management/flow', perms(key)), false, key);
    assert.equal(hasRouteAccess('/management', perms(key)), true, `${key} keeps the dashboard`);
  }
});

test('a card links only to a page the user may open: no Umur piutang for the Management Office', () => {
  for (const key of ['management_office.supervisor', 'management_office.head']) {
    assert.equal(allowedLink(RECEIVABLE_AGING_LINK, perms(key)), null, `${key} has no Data Sales (sales.order.view)`);
    assert.equal(hasRouteAccess('/sales/orders', perms(key)), false, key);
    assert.equal(allowedLink('/escalations?source=flow_do_not_invoiced', perms(key)), '/escalations?source=flow_do_not_invoiced', key);
    assert.equal(allowedLink(PURCHASE_TARGET_LINK, perms(key)), PURCHASE_TARGET_LINK, key);
    assert.equal(allowedLink('/procurement/orders?state=late', perms(key)), '/procurement/orders?state=late', key);
  }
  assert.equal(allowedLink(RECEIVABLE_AGING_LINK, ['management_dashboard.view', 'sales.order.view']), RECEIVABLE_AGING_LINK);
  assert.equal(allowedLink('/procurement/orders?state=late', ['management_dashboard.view']), null, 'no procurement.view, no link');
  for (const bad of [null, '', 'https://evil.test/x', '//evil.test/x', 'javascript:alert(1)']) assert.equal(allowedLink(bad, perms('management_office.head')), null, String(bad));
});

test('the purchase flow links to Target & realisasi on Procurement', () => {
  assert.equal(PURCHASE_TARGET_LINK, '/targets?modul=procurement');
  assert.equal(readTargetParams(new URLSearchParams(PURCHASE_TARGET_LINK.split('?')[1])).module, 'procurement');
});

test('where the promise of a late SO comes from, a Sunday moved to Monday', () => {
  assert.equal(dueSourceText({ dueEstimated: false }), 'Tgl kirim di SO');
  assert.equal(dueSourceText({ dueEstimated: true, dueShifted: false }), 'standar 2×24 jam dari tanggal SO');
  // A Friday SO: SO date + 2 days is a Sunday.
  assert.equal(dueSourceText({ orderedOn: '2026-09-25', dueOn: '2026-09-28', dueEstimated: true, dueShifted: true }), 'standar 2×24 jam dari tanggal SO, digeser ke Senin');
  const flow = normalizeSalesFlow({ stuck: { notShipped: { count: 1, items: [{ soNumber: 'SO1', dueEstimated: true, dueShifted: true }] } } });
  assert.equal(dueSourceText(flow.stuck.notShipped.items[0]), 'standar 2×24 jam dari tanggal SO, digeser ke Senin');
});

test('"Surat jalan belum difaktur" opens a Data Sales period that reaches back past the billing window', () => {
  const provider = fs.readFileSync(path.join(import.meta.dirname, '../../backend/src/management/providers/flow.js'), 'utf8');
  const { BILL_WINDOW_DAYS, BILL_GRACE_DAYS } = require('../../backend/src/services/flowRules.js');
  const periode = /\/sales\/orders\?tab=do&periode=([a-z0-9_]+)&q=/.exec(provider)?.[1];
  assert.ok(PERIOD_OPTIONS.some((o) => o.value === periode), `${periode} is a Data Sales period`);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (let i = 0; i < 731; i += 1) {
    const today = new Date(2026, 0, 1 + i);
    const range = periodRange(periode, today);
    const oldest = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - BILL_WINDOW_DAYS - BILL_GRACE_DAYS));
    assert.ok(range.from <= oldest && range.to >= iso(today), `${iso(today)}: ${range.from}..${range.to}`);
  }
});

test('period presets', () => {
  assert.deepEqual(PERIOD_PRESETS.map((p) => p.key), ['month', 'prev', '3m', 'ytd']);
  assert.equal(isPreset('3m'), true);
  assert.equal(isPreset('week'), false);
  assert.equal(periodText({ from: '2026-07-01', to: '2026-09-30' }), '1 Jul 2026 – 30 Sep 2026');
  assert.equal(monthText('2026-09'), 'Sep 2026');
});

test('texts are Indonesian and a missing number reads "—", never 0', () => {
  assert.equal(daysText(null), '—');
  assert.equal(daysText(0.44), '0,4 hari');
  assert.equal(pctText(93.64), '93,6%');
  assert.equal(pctText(undefined), '—');
  assert.equal(shareText(3, 0), '—');
  assert.equal(shareText(1, 4), '25%');
  assert.equal(stepGapText({ count: 97, medianDays: 1, avgDays: 0.4, p90Days: 3 }), 'median 1 hari · rata-rata 0,4 · p90 3 · 97 SO');
  assert.equal(stepGapText({ count: 0, medianDays: null }), 'Belum ada data');
  assert.equal(stepGapText(undefined), 'Belum ada data');
  assert.equal(pendingText(['sales', 'warehouse']), 'Data Accurate Sales dan Warehouse masih menunggu persetujuan — angka di sini belum memuatnya.');
  assert.equal(pendingText([]), '');
  assert.deepEqual(relevantPending(['procurement', 'sales', 'warehouse'], 'sales'), ['sales']);
  assert.deepEqual(relevantPending(['procurement', 'sales', 'warehouse'], 'purchase'), ['procurement', 'warehouse']);
});

test('normalizers keep null as null and drop malformed rows', () => {
  const sales = normalizeSalesFlow({
    ready: true, stages: { total: '4', paid: null }, steps: [{ key: 'bill_to_paid', count: 2, medianDays: null }, null, { label: 'no key' }],
    byDivision: [null, { departmentId: 5, departmentName: 'Sales', total: 3 }],
    stuck: { notShipped: { count: 60, items: [{ soNumber: 'SO.1', daysLate: '8', percentShipped: '0.0000' }, { noNumber: true }] }, overdue: { count: 2, amount: null } },
  });
  assert.equal(sales.stages.total, 4);
  assert.equal(sales.stages.paid, 0);
  assert.equal(sales.steps.length, 1);
  assert.equal(sales.steps[0].medianDays, null);
  assert.equal(sales.byDivision.length, 1);
  assert.equal(sales.stuck.notShipped.count, 60);
  assert.deepEqual(sales.stuck.notShipped.items.map((i) => [i.soNumber, i.daysLate, i.percentShipped]), [['SO.1', 8, 0]]);
  assert.equal(sales.stuck.overdue.amount, null);
  assert.equal(normalizeSalesFlow(null).ready, false);

  const buy = normalizePurchaseFlow({ ready: true, stages: { received: '255', bogus: 3 }, onTime: { pct: null }, stuck: [{ state: 'late', count: '2', link: 'https://x' }, { state: 'nope' }] });
  assert.equal(buy.stages.received, 255);
  assert.equal(buy.stages.bogus, undefined);
  assert.equal(buy.onTime.pct, null);
  assert.deepEqual(buy.stuck, [{ state: 'late', count: 2, link: null }]);

  const m = normalizeMargin({ summary: { revenue: '100', marginPct: null }, products: [null, { itemCode: 'A', margin: null, coverage: 'weird' }], divisionOptions: [{ id: '5', name: 'Sales' }, { name: 'x' }] });
  assert.equal(m.summary.revenue, 100);
  assert.equal(m.summary.marginPct, null);
  assert.equal(m.products.length, 1);
  assert.equal(m.products[0].margin, null);
  assert.equal(m.products[0].coverage, 'no_price');
  assert.deepEqual(m.divisionOptions, [{ id: 5, name: 'Sales' }]);

  const slow = normalizeSlowMovers({ ready: true, prices: false, valueTotals: { dead: 5 }, items: [{ itemNo: 'A', status: 'not_moving', value: 99, out30d: null }, { itemNo: 'B', status: 'weird' }, { status: 'slow_moving' }] });
  assert.equal(slow.items.length, 1);
  assert.equal(slow.items[0].value, null, 'no rupiah without prices, whatever the payload says');
  assert.equal(slow.items[0].out30d, null);
  assert.equal(slow.valueTotals, null);
});

test('the coverage warning appears only below the threshold', () => {
  assert.equal(coverageWarning({ coveragePct: 93.6 }), '');
  assert.equal(coverageWarning({ coveragePct: null }), '');
  assert.match(coverageWarning({ coveragePct: 25.6 }), /^74,4% omzet belum punya harga beli/);
  assert.match(coverageWarning({ coveragePct: 85 }, 90), /^15% omzet/);
});

test('product status priority: loss, then no price, no unit, partial, later PO', () => {
  assert.equal(productStatus({ margin: -1, coverage: 'partial', costAfter: true }), 'margin_negative');
  assert.equal(productStatus({ margin: null, coverage: 'no_price' }), 'cost_missing');
  assert.equal(productStatus({ margin: null, coverage: 'no_unit' }), 'unit_missing');
  assert.equal(productStatus({ margin: 5, coverage: 'partial', costAfter: true }), 'cost_partial');
  assert.equal(productStatus({ margin: 5, coverage: 'ok', costAfter: true }), 'cost_after');
  assert.equal(productStatus({ margin: 5, coverage: 'ok' }), null);
  for (const s of ['margin_negative', 'cost_missing', 'unit_missing', 'cost_partial', 'cost_after', 'slow_moving', 'not_moving', 'never_sold', 'flow_so_late', 'flow_so_legacy', 'flow_not_billed', 'flow_not_billed_old']) {
    assert.ok(STATUS_LABELS[s], `${s} has an Indonesian label`);
    assert.ok(['default', 'info', 'warning', 'success', 'error'].includes(statusTone(s)), s);
  }
  assert.equal(statusTone('margin_negative'), 'error');
  assert.equal(statusTone('not_moving'), 'error');
});

test('product and slow-mover filters, counts and quantities never summed across units', () => {
  const products = [
    { itemCode: 'A', margin: -5, coverage: 'ok' },
    { itemCode: 'B', margin: null, coverage: 'no_price' },
    { itemCode: 'C', margin: 7, coverage: 'partial' },
    { itemCode: 'D', margin: 7, coverage: 'ok' },
  ];
  assert.deepEqual(filterProducts(products, 'negative').map((p) => p.itemCode), ['A']);
  assert.deepEqual(filterProducts(products, 'uncovered').map((p) => p.itemCode), ['B', 'C']);
  assert.equal(filterProducts(products, 'all').length, 4);
  assert.deepEqual(productCounts(products), { all: 4, negative: 1, uncovered: 2 });
  assert.equal(qtyText({ qtyByUnit: [{ unit: 'Pcs', qty: 6000 }, { unit: 'Ctn', qty: 411 }] }), '6.000 Pcs + 411 Ctn');
  assert.equal(qtyText({ qtyByUnit: [] }), '—');

  const items = [{ status: 'slow_moving' }, { status: 'not_moving' }, { status: 'never_sold' }, { status: 'never_sold' }];
  assert.deepEqual(slowCounts(items), { all: 4, slow: 1, dead: 1, never: 2 });
  assert.equal(filterSlow(items, 'never').length, 2);
  assert.equal(filterSlow(items, 'all').length, 4);
  assert.equal(slowChipLabel('dead', slowCounts(items), { slowDays: 60, deadDays: 90 }), 'Tidak laku ≥ 90 hari (1)');
  assert.equal(slowChipLabel('slow', slowCounts(items), { slowDays: 60, deadDays: 90 }), 'Lambat laku 60–89 hari (1)');
});

test('the flow pages use shared components only and publish no AI context', () => {
  const dir = path.join(import.meta.dirname, '../src/pages/advanced');
  const files = ['ManagementFlow.jsx', ...fs.readdirSync(path.join(dir, 'flow')).filter((f) => f.endsWith('.jsx')).map((f) => `flow/${f}`)];
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /<button|<input|<table|<select|style=\{\{/, f);
    assert.doesNotMatch(src, /usePublishPrakasaAIContext/, f);
  }
  const margin = fs.readFileSync(path.join(dir, 'flow/MarginEstimate.jsx'), 'utf8');
  assert.match(margin, /Tidak termasuk rebate\/program prinsipal di luar PO; bukan HPP akuntansi Accurate/);
  assert.match(margin, /Perkiraan margin \(harga PO\)/);
});
