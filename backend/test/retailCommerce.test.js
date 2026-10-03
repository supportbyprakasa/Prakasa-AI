const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const registry = require('../src/management/registry');
const { validateProvider, permitted } = require('../src/management/contract');
const provider = require('../src/management/providers/retailCommerce');
const sales = require('../src/management/providers/sales');
const retail = require('../src/services/retailCommerce.service');
const router = require('../src/routes/retailCommerce.routes');

// Retail Commerce (migration 120): marketplace performance from the approved
// Accurate mirror, scoped to the Retail Commerce department, revenue on DPP.

const RC_DEPT = 8;
const PERIOD = { start: '2026-09-01', end: '2026-09-30' };
const user = { sub: 3, entityId: 1, permissions: ['retail.insight.view'] };

// A pool double: the RC department, an approved Sales/RC batch (or none), and
// empty results for everything else. Records every query.
function mockPool(t, { approved = true, rows = () => null } = {}) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args = []) => {
    if (/FROM sales_accurate_batches/.test(sql)) return [[{ n: approved ? 1 : 0 }]];
    if (/FROM departments WHERE entity_id = \? AND code = \?/.test(sql)) return [[{ id: RC_DEPT, name: 'Retail Commerce' }]];
    calls.push({ sql, args });
    const custom = rows(sql, args);
    if (custom) return custom;
    return [[]];
  });
  return calls;
}

// ------------------------------------------------------------------ provider

test('provider: contract, RC keys of its own, nav path /retail-commerce, no escalation', () => {
  assert.doesNotThrow(() => validateProvider(provider));
  assert.equal(provider.key, 'retail_commerce');
  assert.equal(provider.label, 'Retail Commerce');
  assert.deepEqual(provider.navPaths, ['/retail-commerce', '/retail-commerce/pending']);
  // SO past the promise is escalated by Warehouse (warehouse_so_late) for every SO.
  assert.equal(provider.escalations, undefined);
  assert.deepEqual(provider.metrics.map((m) => m.key), ['rc_marketplace_revenue', 'rc_orders', 'rc_return_rate']);
  assert.deepEqual(provider.kpis.map((k) => k.key), ['rc_unshipped_orders', 'rc_return_rate', 'rc_marketplace_unpaid']);
  for (const m of provider.metrics) assert.ok(m.key.length <= 40, m.key);
  assert.equal(provider.metrics.find((m) => m.key === 'rc_return_rate').emptyIsZero, undefined, 'a rate over nothing is unknown, not 0%');
});

test('provider: registered once, no key shared with Sales or any other provider', () => {
  const all = registry.providers();
  assert.equal(all.filter((p) => p.key === 'retail_commerce').length, 1);
  const salesKeys = new Set([...sales.metrics, ...sales.kpis, ...sales.escalations].map((x) => x.key));
  for (const x of [...provider.metrics, ...provider.kpis]) assert.ok(!salesKeys.has(x.key), x.key);
  const otherMetrics = all.filter((p) => p.key !== 'retail_commerce').flatMap((p) => p.metrics.map((m) => m.key));
  for (const m of provider.metrics) assert.ok(!otherMetrics.includes(m.key), m.key);
});

test('provider: every rupiah figure sits behind retail.insight.view', () => {
  for (const x of [...provider.metrics, ...provider.kpis].filter((i) => i.unit === 'rupiah')) {
    const codes = [].concat(x.permission || []);
    assert.ok(codes.includes('retail.insight.view'), x.key);
    assert.equal(permitted(x, ['retail.insight.view']), true, x.key);
    assert.equal(permitted(x, ['management_dashboard.view']), false, x.key);
  }
});

test('provider: entity then division bound in SQL, always limited to the RC department', async (t) => {
  const calls = mockPool(t);
  const run = async (fn) => { calls.length = 0; await fn(); return calls; };
  for (const m of provider.metrics) {
    const [c] = await run(() => m.actuals(1, PERIOD, { departmentId: RC_DEPT }));
    assert.match(c.sql, /rcd\.code = 'retail_commerce'/, m.key);
    assert.match(c.sql, /\.department_id = \?/, m.key);
    assert.deepEqual(c.args.slice(0, 2), [1, RC_DEPT], m.key);
  }
  for (const k of provider.kpis) {
    const [c] = await run(() => k.value(1, { departmentId: RC_DEPT }));
    assert.match(c.sql, /rcd\.code = 'retail_commerce'/, k.key);
    assert.deepEqual(c.args, [1, RC_DEPT], k.key);
  }
  // The SO belongs to the SELLING division, not the shipping Warehouse.
  const [ship] = await run(() => provider.kpis[0].value(1, { departmentId: RC_DEPT }));
  assert.match(ship.sql, /x\.sales_department_id = \?/);
  // Company-wide: no division filter, but still only marketplace rows.
  const [all] = await run(() => provider.metrics[0].actuals(1, PERIOD, { departmentId: null }));
  assert.doesNotMatch(all.sql, /department_id = \?/);
  assert.match(all.sql, /rcd\.code = 'retail_commerce'/);
  assert.deepEqual(all.args, [1, PERIOD.start, PERIOD.end]);
});

test('provider: revenue is DPP net of returns (sales_revenue_accurate), never the VAT total', async (t) => {
  const calls = mockPool(t, { rows: (sql) => (/sales_revenue_accurate/.test(sql) ? [[{ department_id: RC_DEPT, revenue: '1500000.50', gross: '2000000', returns: '100000', invoices: 3 }]] : null) });
  const revenue = await provider.metrics[0].actuals(1, PERIOD, { departmentId: null });
  assert.equal(revenue.get(RC_DEPT), 1500000.5);
  assert.match(calls[0].sql, /FROM sales_revenue_accurate r/);
  assert.match(calls[0].sql, /SUM\(r\.amount\)/);
  assert.doesNotMatch(calls[0].sql, /total_amount/);
  const rate = await provider.metrics[2].actuals(1, PERIOD, { departmentId: null });
  assert.equal(rate.get(RC_DEPT), 5);
});

test('provider: before an approved Sales/RC batch nothing is computed — empty metrics, KPIs say why', async (t) => {
  const calls = mockPool(t, { approved: false });
  for (const m of provider.metrics) assert.equal((await m.actuals(1, PERIOD, { departmentId: null })).size, 0, m.key);
  for (const k of provider.kpis) {
    const out = await k.value(1, { departmentId: null });
    assert.equal(out.value, null, k.key);
    assert.equal(out.alert, false, k.key);
    assert.match(out.sub, /batch Accurate/, k.key);
  }
  assert.equal(calls.length, 0);
});

test('provider: KPI shapes — late SOs alert, no invoice this month is unknown, unpaid invoices', async (t) => {
  mockPool(t, {
    rows: (sql) => {
      if (/wh_so_fulfilment_accurate/.test(sql)) return [[{ open_orders: 3, late_orders: 2 }]];
      if (/sales_invoices_accurate/.test(sql)) return [[{ invoices: 4, amount: '900000', overdue: 1 }]];
      return null;
    },
  });
  assert.deepEqual(await provider.kpis[0].value(1, { departmentId: null }), {
    value: 2, sub: '3 SO belum terkirim penuh · janji 2×24 jam dari tanggal SO · SO rekap bulanan marketplace tidak dihitung', alert: true,
  });
  assert.equal((await provider.kpis[1].value(1, { departmentId: null })).value, null);
  const unpaid = await provider.kpis[2].value(1, { departmentId: null });
  assert.equal(unpaid.value, 900000);
  assert.equal(unpaid.alert, true);
});

// ------------------------------------------------------------------- service

test('service: platform labels come from the data, TokoPedia shown as Tokopedia', () => {
  assert.equal(retail.platformLabel('TokoPedia'), 'Tokopedia');
  assert.equal(retail.platformLabel('Shopee'), 'Shopee');
  assert.equal(retail.platformLabel('TikTok'), 'TikTok');
  assert.equal(retail.platformLabel(null), 'Lainnya');
});

test('service: months window and clamping', () => {
  const months = retail.monthsBack(12, new Date(Date.UTC(2026, 9, 1)));
  assert.equal(months.length, 12);
  assert.deepEqual(months[0], { key: '2025-11', label: 'Nov 2025', start: '2025-11-01', end: '2025-11-30' });
  assert.equal(months[11].key, '2026-10');
  assert.equal(retail.previousMonth('2026-01'), '2025-12');
  assert.equal(retail.clampMonths(undefined), 12);
  assert.equal(retail.clampMonths(1), 3);
  assert.equal(retail.clampMonths(99), 24);
});

test('service: every overview query is bound to the entity, then the RC department; revenue on DPP', async (t) => {
  const calls = mockPool(t);
  const out = await retail.overview(user, { months: 6 });
  assert.equal(out.connected, true);
  assert.deepEqual(out.department, { id: RC_DEPT, name: 'Retail Commerce' });
  assert.equal(calls.length, 5);
  for (const c of calls) {
    assert.deepEqual(c.args.slice(0, 2), [1, RC_DEPT], c.sql);
    assert.match(c.sql, /\.(sales_)?department_id = \?/);
  }
  const revenue = calls.find((c) => /sales_revenue_accurate/.test(c.sql));
  assert.match(revenue.sql, /SUM\(r\.amount\)/);
  assert.doesNotMatch(revenue.sql, /total_amount/);
  assert.match(calls.find((c) => /wh_so_fulfilment_accurate/.test(c.sql)).sql, /x\.sales_department_id = \?/);
});

test('service: no approved batch → every endpoint says so and reads nothing', async (t) => {
  const calls = mockPool(t, { approved: false });
  for (const fn of [retail.overview, retail.topProducts, retail.pendingShipments, retail.receivables]) {
    const out = await fn(user, {});
    assert.equal(out.connected, false, fn.name);
    assert.equal(out.reason, 'not_approved', fn.name);
  }
  assert.equal(calls.length, 0);
});

test('service: buildOverview — platforms, share, AOV, return rate, KPIs this/last month', () => {
  const months = retail.monthsBack(3, new Date(Date.UTC(2026, 9, 15)));
  const out = retail.buildOverview({
    months,
    revenueRows: [
      { month: '2026-08', channel: 'Shopee', revenue: 900, gross: 1000, returns: 100, invoices: 2 },
      { month: '2026-09', channel: 'Shopee', revenue: 500, gross: 500, returns: 0, invoices: 1 },
      { month: '2026-09', channel: 'TokoPedia', revenue: 200, gross: 200, returns: 0, invoices: 1 },
      { month: '2026-10', channel: 'TokoPedia', revenue: 400, gross: 400, returns: 0, invoices: 2 },
      { month: '2020-01', channel: 'Shopee', revenue: 99999, gross: 99999, returns: 0, invoices: 9 },
    ],
    orderRows: [{ month: '2026-10', channel: 'TokoPedia', orders: 3 }, { month: '2026-09', channel: 'Shopee', orders: 1 }],
    receivableRows: [{ channel: 'Shopee', invoices: 2, outstanding: 1100, overdue: 600, overdue_invoices: 1, oldest_due: '2026-08-31' }],
    shipmentRows: [{ channel: 'TokoPedia', open_orders: 2, late_orders: 1, oldest: '2026-09-14' }],
  });
  assert.deepEqual(out.platforms.map((p) => p.label), ['Shopee', 'Tokopedia']);
  const shopee = out.platforms[0];
  assert.equal(shopee.revenue, 1400);
  assert.equal(shopee.invoices, 3);
  assert.equal(shopee.aov, 466.67);
  assert.equal(shopee.returnRate, 6.7);
  assert.equal(shopee.share, 70);
  assert.deepEqual(shopee.series.revenue, [900, 500, 0]);
  assert.equal(out.platforms[1].channel, 'TokoPedia');
  assert.equal(out.platforms[1].shipments.late, 1);
  assert.equal(out.kpis.revenueThisMonth, 400);
  assert.equal(out.kpis.revenueLastMonth, 700);
  assert.equal(out.kpis.revenueChange, -300);
  assert.equal(out.kpis.ordersThisMonth, 3);
  assert.equal(out.kpis.aovThisMonth, 200);
  assert.equal(out.kpis.returnRateThisMonth, 0);
  assert.deepEqual(out.kpis.receivable, { amount: 1100, invoices: 2, overdue: 600, overdueInvoices: 1 });
  assert.deepEqual(out.kpis.shipments, { open: 2, late: 1, oldest: '2026-09-14' });
  assert.equal(out.latestMonth.key, '2026-10');
  assert.deepEqual(out.totals.revenue, [900, 700, 400]);
});

test('service: buildOverview with no sales — no AOV, unknown return rate, no latest month', () => {
  const out = retail.buildOverview({ months: retail.monthsBack(3), revenueRows: [], orderRows: [], receivableRows: [], shipmentRows: [] });
  assert.deepEqual(out.platforms, []);
  assert.equal(out.kpis.aovThisMonth, null);
  assert.equal(out.kpis.returnRateThisMonth, null);
  assert.equal(out.latestMonth, null);
});

test('service: top products rank with last month, base units, platforms deduplicated', async (t) => {
  const calls = mockPool(t, {
    rows: (sql) => {
      if (/MAX\(l\.trans_date\)/.test(sql)) return [[{ month: '2026-08' }]];
      if (/JSON_ARRAYAGG/.test(sql)) {
        return [[
          { code: 'A', name: 'Produk A', revenue: '300', units: [{ unit: 'Pcs', qty: 10 }], base_qty: null, base_unit: null, channels: 'Shopee,TokoPedia,Shopee' },
          { code: 'B', name: 'Produk B', revenue: '100', units: '[{"unit":"Box","qty":2}]', base_qty: '24', base_unit: 'Pcs', channels: 'Shopee' },
        ]];
      }
      if (/COUNT\(DISTINCT l\.item_code\)/.test(sql)) return [[{ revenue: '500', products: 7 }]];
      if (/item_code IN/.test(sql)) return [[{ code: 'A', revenue: '200' }]];
      return null;
    },
  });
  const out = await retail.topProducts(user, {});
  assert.equal(out.month.key, '2026-08');
  assert.equal(out.prevMonth.key, '2026-07');
  assert.equal(out.monthRevenue, 500);
  assert.equal(out.rows[0].changePct, 50);
  assert.equal(out.rows[0].share, 60);
  assert.deepEqual(out.rows[0].platforms.map((p) => p.label), ['Shopee', 'Tokopedia']);
  assert.equal(out.rows[1].isNew, true);
  assert.deepEqual(out.rows[1].baseQty, { qty: 24, unit: 'Pcs' });
  for (const c of calls) assert.deepEqual(c.args.slice(0, 2), [1, RC_DEPT], c.sql);
  const top = calls.find((c) => /JSON_ARRAYAGG/.test(c.sql));
  assert.deepEqual(top.args, [1, RC_DEPT, '2026-08-01', '2026-08-31', 1]);
  assert.match(top.sql, /LIMIT 15/);
});

test('service: pending shipments oldest first, limited, late only when the mirror can judge', async (t) => {
  const calls = mockPool(t, {
    rows: (sql) => {
      if (/COUNT\(\*\) AS n/.test(sql)) return [[{ n: 2 }]];
      if (/wh_so_fulfilment_accurate/.test(sql)) {
        return [[
          { id: 1, number: 'SO.1', trans_date: '2026-09-14', channel: 'TokoPedia', so_state: 'open', percent_shipped: 0, promised_date: '2026-09-16', promised_in_so: 0, judged: 1, dpp_amount: '1000', days_open: 17, days_late: 15, is_late: 1, is_recap: 0 },
          { id: 2, number: 'SO.2', trans_date: '2026-09-29', channel: 'Shopee', so_state: 'partial', percent_shipped: '50', promised_date: '2026-09-25', promised_in_so: 0, judged: 0, dpp_amount: null, days_open: 2, days_late: 6, is_late: 0, is_recap: 0 },
          { id: 3, number: 'SO.1/ECOM-PFN/IX/2026', trans_date: '2026-09-14', channel: 'Shopee', so_state: 'open', percent_shipped: 0, promised_date: '2026-09-16', promised_in_so: 0, judged: 1, dpp_amount: '5000', days_open: 17, days_late: 15, is_late: 0, is_recap: 1 },
        ]];
      }
      return null;
    },
  });
  const out = await retail.pendingShipments(user);
  assert.equal(out.total, 2);
  assert.equal(out.rows[0].platform, 'Tokopedia');
  assert.equal(out.rows[0].late, true);
  assert.equal(out.rows[0].daysLate, 15);
  assert.equal(out.rows[1].late, false);
  assert.equal(out.rows[1].amount, null);
  // A monthly marketplace recap SO is listed but never late (warehouseRules.lateSoSql).
  assert.equal(out.rows[2].late, false);
  assert.equal(out.rows[2].recap, true);
  const list = calls.find((c) => /ORDER BY/.test(c.sql));
  assert.ok(list.sql.includes(`${require('../src/services/warehouseRules').lateSoSql('x')} AS is_late`));
  assert.match(list.sql, /ORDER BY x\.trans_date, x\.id/);
  assert.match(list.sql, /LIMIT 50/);
  assert.match(list.sql, /so_state IN \('open', 'partial'\)/);
});

test('service: receivables are open RC invoices, oldest due first', async (t) => {
  const calls = mockPool(t, {
    rows: (sql) => {
      if (/COUNT\(\*\) AS n/.test(sql)) return [[{ n: 1 }]];
      if (/sales_invoices_accurate/.test(sql)) return [[{ id: 9, invoice_number: 'SI.1', trans_date: '2026-08-31', due_date: '2026-08-31', channel: 'Shopee', dpp_amount: '90', total_amount: '100', outstanding_amount: '60', days_overdue: 31 }]];
      return null;
    },
  });
  const out = await retail.receivables(user);
  assert.deepEqual(out.rows[0], {
    id: 9, number: 'SI.1', date: '2026-08-31', dueDate: '2026-08-31', channel: 'Shopee', platform: 'Shopee',
    dpp: 90, total: 100, outstanding: 60, paid: 40, daysOverdue: 31,
  });
  const list = calls.find((c) => /ORDER BY/.test(c.sql));
  assert.match(list.sql, /outstanding_amount > 0/);
  assert.match(list.sql, /ORDER BY i\.due_date, i\.id/);
});

// -------------------------------------------------------------------- routes

test('routes: every endpoint needs retail.insight.view', async () => {
  const paths = router.stack.filter((l) => l.route).map((l) => l.route.path);
  assert.deepEqual(paths, ['/overview', '/top-products', '/pending-shipments', '/receivables']);
  for (const layer of router.stack.filter((l) => l.route)) {
    const gate = layer.route.stack[0].handle;
    let status = null;
    let passed = false;
    const res = { status(code) { status = code; return this; }, json() { return this; } };
    gate({ user: { permissions: ['sales.order.view'] } }, res, () => { passed = true; });
    assert.equal(status, 403, layer.route.path);
    assert.equal(passed, false, layer.route.path);
    gate({ user: { permissions: ['retail.insight.view'] } }, res, () => { passed = true; });
    assert.equal(passed, true, layer.route.path);
  }
});
