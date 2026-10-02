const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { validateProvider } = require('../src/management/contract');
const finance = require('../src/management/providers/finance');

const PERIOD = { start: '2026-09-01', end: '2026-09-30' };

const overdueRow = {
  id: 41, title: 'Sewa gudang Oktober', request_number: 'PR-202609-0001', status: 'approved',
  total_amount: '12500000.00', currency: 'IDR', payee_name: 'PT Gudang Jaya',
  department_id: 9, department_name: 'Warehouse', owner_name: 'Sari', days_late: 16, since: '2026-09-13',
};
const processingRow = {
  id: 42, title: 'Reimburse perjalanan', request_number: 'RB-202609-0002', status: 'processing',
  total_amount: '850000.00', currency: 'IDR', payee_name: null,
  department_id: 3, department_name: 'Finance', owner_name: null, days_late: 2, since: '2026-09-27',
};
const summaryRow = {
  pending: '2', pending_amount: '4000000.00', approved: '3', approved_amount: '15000000.00',
  approved_overdue: '1', paid_this_month: '5', paid_this_month_amount: '22000000.00',
};

// Answers every provider query; `calls` records the SQL so the tests can prove
// the division filter reached the database.
function fakeQuery(calls, { lateRows = [overdueRow, processingRow], paidRows = [], summary = summaryRow, located = null } = {}) {
  return async (sql, args) => {
    calls.push({ sql, args });
    if (/WHERE f\.id = \?/.test(sql)) return [located ? [located] : []];
    if (/ORDER BY days_late/.test(sql)) return [lateRows];
    if (/GROUP BY f\.department_id/.test(sql)) return [paidRows];
    return [[summary]];
  };
}

async function callEverything(departmentId) {
  const opts = { departmentId };
  for (const source of finance.escalations) await source.list(1, opts);
  for (const metric of finance.metrics) await metric.actuals(1, PERIOD, opts);
  for (const kpi of finance.kpis) await kpi.value(1, opts);
}

test('the finance provider satisfies the management contract', () => {
  const provider = validateProvider(finance);
  assert.deepEqual(provider.navPaths, ['/finance/payment-requests']);
  for (const item of [...provider.escalations, ...provider.metrics]) assert.match(item.key, /^finance_/);
  for (const kpi of provider.kpis) assert.match(kpi.key, /^finance_/);
  assert.ok(provider.metrics.some((m) => m.unit === 'rupiah'));
  // Every rupiah figure is gated by finance.view; the on-time rate is not money.
  for (const metric of provider.metrics.filter((m) => m.unit === 'rupiah')) assert.equal(metric.permission, 'finance.view', metric.key);
  for (const kpi of provider.kpis) assert.equal(kpi.permission, 'finance.view', `${kpi.key} shows rupiah in its sub line`);
  for (const source of provider.escalations) assert.ok(source.key.length <= 32, source.key);
});

test('it never reports a waiting approval — that belongs to the approvals provider', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  for (const source of finance.escalations) await source.list(1, {});
  for (const { sql } of calls) {
    assert.doesNotMatch(sql, /a\.status IN \([^)]*(pending|revision_requested)/, 'no escalation on an undecided approval');
  }
  const unapplied = calls.find((c) => /f\.status = 'pending_approval'/.test(c.sql));
  assert.match(unapplied.sql, /a\.status IN \('approved', 'rejected'\)/, 'only decided approvals');
});

test('escalations map rows to the Pusat Eskalasi shape with severity and an in-app link', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const source = finance.escalations.find((s) => s.key === 'finance_payment_overdue');
  const items = await source.list(1, { departmentId: null });
  assert.equal(items.length, 2);
  const [late, recent] = items;
  assert.equal(late.sourceId, 41);
  assert.equal(late.title, 'Sewa gudang Oktober');
  assert.equal(late.reference, 'PR-202609-0001');
  assert.equal(late.severity, 'high', '16 days past the due date');
  assert.equal(late.daysLate, 16);
  assert.equal(late.departmentId, 9);
  assert.equal(late.ownerName, 'Sari');
  assert.equal(late.link, '/finance/payment-requests/41');
  assert.match(late.context, /Disetujui, belum dibayar/);
  assert.doesNotMatch(late.context, /Rp/, 'an escalation text cannot be gated, so it never shows the amount');
  assert.match(late.context, /PT Gudang Jaya/);
  assert.equal(late.since, new Date('2026-09-13').toISOString());
  assert.equal(recent.severity, 'medium');
  assert.match(recent.context, /Sedang diproses/);
});

test('the overdue source only takes unpaid requests past their date', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await finance.escalations.find((s) => s.key === 'finance_payment_overdue').list(1, {});
  const { sql } = calls[0];
  assert.match(sql, /f\.status IN \('approved', 'processing'\)/);
  assert.match(sql, /COALESCE\(f\.due_date, f\.requested_payment_date\) < DATE_SUB\(DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\), INTERVAL 0 DAY\)/);
  assert.match(sql, /f\.deleted_at IS NULL/);
});

test('locate returns the entity and division of a request, or null', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([], { located: { entity_id: 1, department_id: 9 } }));
  for (const source of finance.escalations) {
    assert.deepEqual(await source.locate(41), { entityId: 1, departmentId: 9 });
  }
  t.mock.restoreAll();
  t.mock.method(pool, 'query', fakeQuery([]));
  for (const source of finance.escalations) assert.equal(await source.locate(999), null);
  t.mock.restoreAll();
  t.mock.method(pool, 'query', fakeQuery([], { located: { entity_id: 1, department_id: null } }));
  assert.deepEqual(await finance.escalations[0].locate(43), { entityId: 1, departmentId: null });
});

test('a division Head is filtered in SQL on every query', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await callEverything(3);
  assert.ok(calls.length >= finance.escalations.length + finance.metrics.length + finance.kpis.length);
  for (const { sql, args } of calls) {
    assert.match(sql, /f\.entity_id = \? AND f\.department_id = \?/, sql);
    assert.equal(args[0], 1, 'entity first');
    assert.equal(args[1], 3, 'then the caller division');
    assert.match(sql, /f\.deleted_at IS NULL/, 'soft-deleted rows excluded');
  }
});

test('the entity-wide view carries no division filter', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await callEverything(null);
  for (const { sql, args } of calls) {
    assert.doesNotMatch(sql, /department_id = \?/, sql);
    assert.match(sql, /f\.entity_id = \?/);
    assert.equal(args[0], 1);
    assert.match(sql, /f\.deleted_at IS NULL/);
  }
});

test('metrics return a Map per division, with no rate over nothing', async (t) => {
  const calls = [];
  const paidRows = [
    { department_id: 9, paid_amount: '12500000.00', with_deadline: '4', on_time: '3' },
    { department_id: 3, paid_amount: '850000.00', with_deadline: '0', on_time: '0' },
    { department_id: null, paid_amount: '100.00', with_deadline: '1', on_time: '1' },
  ];
  t.mock.method(pool, 'query', fakeQuery(calls, { paidRows }));
  const amount = await finance.metrics.find((m) => m.key === 'finance_paid_amount').actuals(1, PERIOD, {});
  assert.ok(amount instanceof Map);
  assert.deepEqual([...amount.entries()], [[9, 12500000], [3, 850000]], 'rows without a division are not attributed');

  const rate = await finance.metrics.find((m) => m.key === 'finance_paid_on_time_rate').actuals(1, PERIOD, {});
  assert.equal(rate.get(9), 75);
  assert.equal(rate.get(3), null, 'no dated payment → unknown, not 0%');

  const { sql, args } = calls[0];
  assert.match(sql, /f\.status = 'paid'/);
  assert.match(sql, /f\.paid_at BETWEEN \? - INTERVAL 7 HOUR AND \? - INTERVAL 7 HOUR/);
  assert.deepEqual(args.slice(-2), ['2026-09-01', '2026-09-30 23:59:59']);
});

test('KPIs keep the old dashboard numbers as { value, sub, alert }', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const byKey = Object.fromEntries(await Promise.all(finance.kpis.map(async (k) => [k.key, await k.value(1, {})])));
  for (const result of Object.values(byKey)) assert.deepEqual(Object.keys(result).sort(), ['alert', 'sub', 'value']);
  assert.deepEqual(byKey.finance_pending, { value: 2, sub: 'Rp 4.000.000 menunggu', alert: false });
  assert.deepEqual(byKey.finance_approved_unpaid, { value: 3, sub: 'Rp 15.000.000 belum dibayar · 1 lewat jatuh tempo', alert: true });
  assert.deepEqual(byKey.finance_paid_this_month, { value: 5, sub: 'Rp 22.000.000 dibayar', alert: false });
});

test('an empty entity reads as zero, without alerts', async (t) => {
  const empty = {
    pending: null, pending_amount: '0', approved: null, approved_amount: '0',
    approved_overdue: null, paid_this_month: null, paid_this_month_amount: '0',
  };
  t.mock.method(pool, 'query', fakeQuery([], { summary: empty }));
  const approved = await finance.kpis.find((k) => k.key === 'finance_approved_unpaid').value(1, {});
  assert.deepEqual(approved, { value: 0, sub: 'Rp 0 belum dibayar', alert: false });
});

test('legacy fix: "paid this month" also checks the year', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await finance.kpis.find((k) => k.key === 'finance_paid_this_month').value(1, {});
  const { sql } = calls[0];
  const paidCount = sql.split('\n').find((line) => /AS paid_this_month,?$/.test(line.trim()));
  assert.ok(paidCount, 'the paid-this-month expression is present');
  // Year and month together, on the WIB calendar.
  assert.match(paidCount, /DATE_FORMAT\(f\.paid_at \+ INTERVAL 7 HOUR, '%Y-%m'\) = DATE_FORMAT\(DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\), '%Y-%m'\)/);
});

test('legacy fix: the pending amount sums only requests waiting for approval', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await finance.kpis.find((k) => k.key === 'finance_pending').value(1, {});
  const { sql } = calls[0];
  assert.match(sql, /SUM\(CASE WHEN f\.status = 'pending_approval' AND [^)]+\) = 'IDR' THEN f\.total_amount ELSE 0 END\), 0\) AS pending_amount/);
  assert.doesNotMatch(sql, /SUM\(f?\.?total_amount\)/, 'no unconditional sum over every row');
});
