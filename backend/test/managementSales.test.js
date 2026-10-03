const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { validateProvider } = require('../src/management/contract');
const sales = require('../src/management/providers/sales');

// These tests describe the provider on reliable data (transactions entered in
// the app, or Accurate connected). The "not connected yet" hold has its own tests below.
process.env.SALES_TRANSACTION_SOURCE = 'app';

const PERIOD = { start: '2026-09-01', end: '2026-09-30' };
const source = (key) => sales.escalations.find((s) => s.key === key);
const metric = (key) => sales.metrics.find((m) => m.key === key);
const kpi = (key) => sales.kpis.find((k) => k.key === key);

const dormantCustomer = {
  id: 672, name: 'OLSE', customer_code: 'PFN-PR-HRC-TGR-0293', channel: 'FoodService',
  sales_person_name: 'Fajar', department_id: 5, department_name: 'Sales',
  dormant_since: '2026-08-31', days_late: 29,
};
// Answers every query the provider makes and records the SQL, so a test can
// assert the division filter reached the database rather than being applied later.
function fakeQuery(calls) {
  return async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM sales_customers(_accurate)? c/.test(sql) && /dormant_since/.test(sql)) return [[dormantCustomer]];
    if (/FROM sales_orders o/.test(sql) && /GROUP BY o\.department_id/.test(sql)) {
      return [[
        { department_id: 5, orders: 64, revenue: '104121408.72' },
        { department_id: 8, orders: 3, revenue: '900000.00' },
        { department_id: null, orders: 1, revenue: '100' },
      ]];
    }
    if (/noo_date BETWEEN/.test(sql)) return [[{ department_id: 5, n: 19 }]];
    if (/SUM\(x\.s = 'aktif'\)/.test(sql)) return [[{ aktif: '44', dormant: '12', lost: '323' }]];
    if (/FROM sales_orders o/.test(sql) && /AS revenue/.test(sql)) return [[{ orders: 64, revenue: '104121408.72' }]];
    if (/FROM sales_leads l/.test(sql)) return [[{ open_count: 312, cold: '192' }]];
    if (/AS invoices/.test(sql)) return [[{ invoices: 2, amount: '1067000' }]];
    if (/FROM sales_orders o/.test(sql) && /days_late/.test(sql)) {
      return [[{ id: 4219, invoice_numbers: 'SI65/HRC-PFN/IX/2026', order_number: 'SO65/HRC-PFN/IX/2026', customer_name: 'Toko Uji', sales_person_name: 'Fajar', outstanding_amount: '1067000', department_id: 5, department_name: 'Sales', due_date: '2026-08-20', days_late: 40 }]];
    }
    return [[]];
  };
}

async function runEverything(departmentId) {
  for (const s of sales.escalations) await s.list(1, { departmentId });
  for (const m of sales.metrics) await m.actuals(1, PERIOD, { departmentId });
  for (const k of sales.kpis) await k.value(1, { departmentId });
}

test('the Sales provider satisfies the management contract and claims every Sales page', () => {
  assert.doesNotThrow(() => validateProvider(sales));
  assert.deepEqual(sales.navPaths, ['/sales/pipeline', '/sales/customers', '/sales/leads', '/sales/orders']);
  for (const s of sales.escalations) assert.match(s.key, /^sales_/);
  for (const m of sales.metrics) assert.match(m.key, /^sales_/);
});

test('it reports the mirrored sales data, not the retired hand-typed deals', () => {
  const code = [...sales.escalations.map((s) => s.list), ...sales.metrics.map((m) => m.actuals), ...sales.kpis.map((k) => k.value)]
    .map((fn) => fn.toString()).join('\n');
  assert.doesNotMatch(code, /sales_pipeline/);
  assert.deepEqual(sales.metrics.map((m) => m.key), ['sales_revenue', 'sales_orders', 'sales_new_customers']);
});

test('a dormant customer is late from the day it stopped counting as active', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const [item] = await source('sales_customer_dormant').list(1, { departmentId: null });
  assert.deepEqual(item, {
    sourceId: 672, title: 'OLSE', reference: 'PFN-PR-HRC-TGR-0293',
    context: 'Belum order 59 hari — FoodService. Lost di 60 hari.',
    departmentId: 5, departmentName: 'Sales', ownerName: 'Fajar', severity: 'high', daysLate: 29,
    since: new Date('2026-08-31').toISOString(), link: '/sales/customers/672',
  });
  // Only the 30–59 day window: active customers are fine and Lost ones are past chasing here.
  assert.match(calls[0].sql, /BETWEEN 30 AND 59/);
  assert.match(calls[0].sql, /c\.deleted_at IS NULL/);
});

test('a division Head is filtered in SQL on every query, with their own division id', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await runEverything(5);
  // Before Tahap B data exists, the two Accurate-invoice escalations answer [] without querying.
  assert.equal(calls.length, sales.escalations.length - 2 + sales.metrics.length + sales.kpis.length);
  for (const { sql, args } of calls) {
    assert.match(sql, /\b[clob]\.department_id = \?/, sql);
    assert.equal(args[0], 1, 'entity first');
    assert.equal(args[1], 5, 'then the division');
    assert.match(sql, /\.entity_id = \?/);
  }
});

test('the company-wide view carries no division filter at all', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await runEverything(null);
  for (const { sql, args } of calls) {
    assert.doesNotMatch(sql, /department_id = \?/, sql);
    assert.equal(args[0], 1);
    assert.ok(!args.includes(5));
  }
});

test('soft-deleted rows are excluded wherever the table has deleted_at', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await runEverything(null);
  for (const { sql } of calls) {
    if (/FROM sales_(customers|orders|leads) [col]\b/.test(sql)) assert.match(sql, /\.deleted_at IS NULL/, sql);
  }
});

test('locate returns the record scope, or null when it does not exist', async (t) => {
  const tables = {
    sales_customer_dormant: 'sales_customers', sales_invoice_overdue: 'sales_orders',
    sales_accurate_invoice_overdue: 'sales_invoices_accurate', sales_invoice_not_exchanged: 'sales_invoices_accurate',
  };
  assert.deepEqual(Object.keys(tables).sort(), sales.escalations.map((s) => s.key).sort());
  let found = true;
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    return [found ? [{ entity_id: 1, department_id: 5 }] : []];
  });
  for (const s of sales.escalations) {
    found = true;
    assert.deepEqual(await s.locate(99), { entityId: 1, departmentId: 5 }, s.key);
    assert.match(calls.at(-1).sql, new RegExp(`FROM ${tables[s.key]} WHERE id = \\?`));
    assert.deepEqual(calls.at(-1).args, [99]);
    found = false;
    assert.equal(await s.locate(99), null, s.key);
  }
});

test('locate keeps a record without a division as company-wide only', async (t) => {
  t.mock.method(pool, 'query', async () => [[{ entity_id: '1', department_id: null }]]);
  assert.deepEqual(await source('sales_customer_dormant').locate(1), { entityId: 1, departmentId: null });
});

test('an invoice 30+ days late reaches management with what is still owed', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const [item] = await source('sales_invoice_overdue').list(1, { departmentId: null });
  assert.equal(item.title, 'Toko Uji');
  assert.equal(item.reference, 'SI65/HRC-PFN/IX/2026');
  assert.equal(item.context, 'Sisa tagihan Rp 1.067.000');
  assert.equal(item.severity, 'high');
  assert.equal(item.link, '/sales/orders/4219');
  assert.match(calls[0].sql, new RegExp(`INTERVAL ${sales.INVOICE_LATE_DAYS} DAY`));
  assert.deepEqual(await kpi('overdue_invoices').value(1, { departmentId: null }), { value: 1067000, sub: '2 invoice lewat jatuh tempo', alert: true });
});

test('revenue and order metrics count orders by transaction date inside the period', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const revenue = await metric('sales_revenue').actuals(1, PERIOD, { departmentId: null });
  assert.ok(revenue instanceof Map);
  assert.deepEqual([...revenue], [[5, 104121408.72], [8, 900000]], 'rows without a division are dropped');
  assert.match(calls[0].sql, /o\.transaction_date BETWEEN \? AND \?/);
  assert.match(calls[0].sql, /SUM\(o\.dpp_amount\)/, 'revenue is DPP, before PPN, like Accurate\'s sales report');
  assert.deepEqual(calls[0].args.slice(-2), ['2026-09-01', '2026-09-30']);
  const orders = await metric('sales_orders').actuals(1, PERIOD, { departmentId: null });
  assert.deepEqual([...orders], [[5, 64], [8, 3]]);
  const noo = await metric('sales_new_customers').actuals(1, PERIOD, { departmentId: null });
  assert.deepEqual([...noo], [[5, 19]]);
  assert.equal(metric('sales_revenue').unit, 'rupiah');
  for (const m of sales.metrics) {
    assert.equal(m.cumulative, true, m.key);
    assert.equal(m.emptyIsZero, true, m.key);
  }
});

test('KPIs report customers, revenue and prospects in { value, sub, alert }', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  assert.deepEqual(await kpi('active_customers').value(1, { departmentId: null }), {
    value: 44, sub: '12 dormant, 323 lost', alert: true,
  });
  assert.deepEqual(await kpi('revenue_this_month').value(1, { departmentId: null }), {
    value: 104121408.72, sub: '64 sales order · sebelum PPN', alert: false,
  });
  assert.deepEqual(await kpi('open_leads').value(1, { departmentId: null }), {
    value: 312, sub: `192 belum dikunjungi ulang ${sales.LEAD_FOLLOWUP_DAYS}+ hari`, alert: true,
  });
});

test('KPIs read an empty module as zeros, not as a failure', async (t) => {
  t.mock.method(pool, 'query', async () => [[{}]]);
  for (const k of sales.kpis) {
    const result = await k.value(1, { departmentId: 5 });
    assert.equal(result.value, 0, k.key);
    assert.equal(result.alert, false, k.key);
    assert.equal(typeof result.sub, 'string');
  }
});

test('until Accurate is connected, Sales escalations are held and KPIs are marked', async (t) => {
  process.env.SALES_TRANSACTION_SOURCE = 'accurate';
  t.after(() => { process.env.SALES_TRANSACTION_SOURCE = 'app'; });
  let connected = false;
  const calls = [];
  const base = fakeQuery(calls);
  t.mock.method(pool, 'query', async (sql, args) => {
    if (/FROM sales_accurate_batches/.test(sql)) return [[{ n: connected ? 1 : 0 }]];
    return base(sql, args);
  });
  // Every Sales escalation is built on transactions, so all of them are held.
  const held = sales.escalations;
  assert.equal(held.length, 4);
  for (const s of held) assert.deepEqual(await s.list(1, { departmentId: null }), [], s.key);
  const revenue = await kpi('revenue_this_month').value(1, { departmentId: null });
  assert.match(revenue.sub, /Belum tersambung Accurate/);
  assert.equal((await kpi('active_customers').value(1, { departmentId: null })).alert, false, 'no red alarm on old data');

  connected = true;
  const { NUMBERS_FROM_ACCURATE } = require('../src/services/salesSource');
  if (NUMBERS_FROM_ACCURATE) {
    assert.equal((await source('sales_customer_dormant').list(1, { departmentId: null })).length, 1, 'released once the numbers read the approved Accurate data');
    assert.doesNotMatch((await kpi('revenue_this_month').value(1, { departmentId: null })).sub, /Belum tersambung/);
  } else {
    // Tahap A: an approved batch fills the mirror, but the pages still show the old recap.
    assert.deepEqual(await source('sales_customer_dormant').list(1, { departmentId: null }), [], 'still held until Tahap B');
    assert.match((await kpi('revenue_this_month').value(1, { departmentId: null })).sub, /Belum tersambung/);
  }
});
