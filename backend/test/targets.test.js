const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const targets = require('../src/services/targets.service');
const registry = require('../src/management/registry');
const ctrl = require('../src/controllers/managementDashboard.controller');
const router = require('../src/routes/managementDashboard.routes');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const metric = (key) => registry.metric(key);

test('periods parse to their first and last day, and default to the current quarter', () => {
  assert.deepEqual(targets.parsePeriod('2026-Q3'), {
    type: 'quarter', key: '2026-Q3', start: '2026-07-01', end: '2026-09-30', label: 'Kuartal 3 2026 (Jul–Sep)',
  });
  const feb = targets.parsePeriod('2028-02');
  assert.deepEqual([feb.start, feb.end], ['2028-02-01', '2028-02-29'], 'leap year February');
  assert.equal(targets.parsePeriod(null, new Date('2026-11-15T00:00:00Z')).key, '2026-Q4');
  for (const bad of ['2026-13', '2026-Q5', '26-Q1', 'kemarin', '1999-01']) {
    assert.throws(() => targets.parsePeriod(bad), (e) => e.status === 400, bad);
  }
});

test('elapsed share runs 0 → 1 across the period and is clamped outside it', () => {
  const q = targets.parsePeriod('2026-Q3');
  assert.equal(targets.elapsedShare(q, new Date('2026-06-01T00:00:00Z')), 0, 'not started');
  assert.equal(targets.elapsedShare(q, new Date('2026-12-01T00:00:00Z')), 1, 'finished');
  const mid = targets.elapsedShare(q, new Date('2026-08-15T00:00:00Z'));
  assert.ok(mid > 0.45 && mid < 0.55, `about half way, got ${mid}`);
});

test('achievement: more is better for output, less is better for delays', () => {
  assert.equal(targets.achievement(metric('issues_completed'), 10, 5), 50);
  assert.equal(targets.achievement(metric('issues_completed'), 10, 12), 120, 'over-delivery is visible');
  assert.equal(targets.achievement(metric('approval_days'), 2, 1), 100, 'faster than target is fully met');
  assert.equal(targets.achievement(metric('approval_days'), 2, 4), 50);
  assert.equal(targets.achievement(metric('overdue_open'), 0, 3), 0, 'target of zero overdue, three late');
  assert.equal(targets.achievement(metric('overdue_open'), 0, 0), 100);
  assert.equal(targets.achievement(metric('issues_completed'), 10, null), null, 'no data is not zero');
});

// A cumulative target judged against the full amount on day one would mark
// every division behind; it is judged against what should be done by now.
test('a growing count is judged by pace mid-period and by the total once it ends', () => {
  const m = metric('issues_completed');
  const half = targets.evaluate(m, 10, 5, 0.5);
  assert.equal(half.pacePct, 100);
  assert.equal(half.status, 'on_track', '5 of 10 at half time is on pace');
  assert.equal(targets.evaluate(m, 10, 3, 0.5).status, 'off_track');
  assert.equal(targets.evaluate(m, 10, 4.2, 0.5).status, 'at_risk');
  const ended = targets.evaluate(m, 10, 10, 1);
  assert.equal(ended.pacePct, null, 'no pace once the period is over');
  assert.equal(ended.status, 'achieved');
  assert.equal(targets.evaluate(m, 10, 9, 1).status, 'at_risk');
});

test('rates and averages are judged as they stand, never pro-rated', () => {
  const rate = targets.evaluate(metric('on_time_rate'), 90, 90, 0.1);
  assert.equal(rate.pacePct, null);
  assert.equal(rate.status, 'on_track');
  assert.equal(targets.evaluate(metric('approval_days'), 1, 3, 0.5).status, 'off_track');
  assert.equal(targets.evaluate(metric('on_time_rate'), null, 80, 0.5).status, 'no_target');
  assert.equal(targets.evaluate(metric('on_time_rate'), 90, null, 0.5).status, 'no_data');
});

function fakeQuery(calls) {
  return async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM departments d/.test(sql)) return [[{ id: 6, name: 'People & Culture' }, { id: 9, name: 'Warehouse' }]];
    if (/FROM division_targets t/.test(sql)) {
      return [[{ id: 1, department_id: 6, metric_key: 'issues_completed', target_value: '10.00', note: null, updated_at: null, updated_by_name: 'Wahyudi' }]];
    }
    if (/COUNT\(\*\) AS completed/.test(sql)) {
      return [[{ department_id: 6, completed: 4, points: '9.0', with_due: 4, on_time: 3 }]];
    }
    if (/AS overdue/.test(sql)) return [[{ department_id: 9, overdue: 2 }]];
    if (/FROM approval_requests a/.test(sql)) return [[{ department_id: 9, avg_days: '1.5' }]];
    return [[]];
  };
}

test('the matrix crosses every division with every metric, with live actuals', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const data = await targets.list(1, { period: '2026-Q3', today: new Date('2026-08-15T00:00:00Z') });
  // No permissions given means none held: a metric behind its own permission is left out.
  const open = registry.metrics().filter((m) => !m.permission);
  assert.equal(data.cells.length, 2 * open.length);
  assert.deepEqual(data.metrics.map((m) => m.key), open.map((m) => m.key));
  const cell = (dept, key) => data.cells.find((c) => c.departmentId === dept && c.metricKey === key);
  assert.equal(cell(6, 'issues_completed').target, 10);
  assert.equal(cell(6, 'issues_completed').actual, 4);
  assert.equal(cell(6, 'on_time_rate').actual, 75, '3 of 4 on time');
  assert.equal(cell(9, 'overdue_open').actual, 2);
  assert.equal(cell(9, 'approval_days').actual, 1.5);
  // A count with no rows is a real zero; a rate with no rows is unknown.
  assert.equal(cell(9, 'issues_completed').actual, 0);
  assert.equal(cell(9, 'on_time_rate').actual, null);
  assert.equal(data.period.ended, false);
});

test('a division Head reads only their division, filtered in SQL, and may not edit', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const res = responseDouble();
  await ctrl.targets({
    user: { sub: 8, entityId: 1, departmentId: 9, permissions: ['management_dashboard.division'] },
    query: { period: '2026-Q3' },
  }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.canEdit, false);
  assert.equal(res.body.data.scope.entityWide, false);
  const scoped = calls.filter((c) => /department_id = \?|d\.id = \?/.test(c.sql));
  assert.ok(scoped.length >= 4, 'divisions, targets and every actual are filtered');
  assert.ok(scoped.every((c) => c.args.includes(9)));
});

test('only the entity-wide view may set targets', () => {
  const layer = router.stack.find((l) => l.route?.path === '/targets' && l.route.methods.put);
  assert.ok(layer, 'PUT /targets exists');
  const gate = layer.route.stack[0].handle;
  const run = (permissions) => {
    const res = responseDouble();
    let passed = false;
    gate({ user: { permissions } }, res, () => { passed = true; });
    return passed ? 200 : res.statusCode;
  };
  assert.equal(run(['management_dashboard.view']), 200);
  assert.equal(run(['management_dashboard.division']), 403, 'a Head does not grade their own division');
});

test('saving validates the metric, the value and the division', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM departments WHERE id/.test(sql)) return [[{ id: 6 }]];
    return [[]];
  });
  const user = { sub: 2, entityId: 1 };
  const base = { departmentId: 6, metricKey: 'issues_completed', period: '2026-Q3' };
  await assert.rejects(() => targets.save(user, { ...base, metricKey: 'apa' }), (e) => e.status === 400);
  await assert.rejects(() => targets.save(user, { ...base, targetValue: -1 }), (e) => e.status === 400);
  await assert.rejects(() => targets.save(user, { ...base, targetValue: 'banyak' }), (e) => e.status === 400);
  await assert.rejects(
    () => targets.save(user, { ...base, metricKey: 'on_time_rate', targetValue: 101 }),
    (e) => e.status === 400,
    'a percentage cannot exceed 100',
  );
  const cleared = await targets.save(user, { ...base, targetValue: null });
  assert.equal(cleared.target, null, 'null clears the target');
});

// Sales and Finance report rupiah metrics; a quarterly revenue target is
// routinely several miliar, which the old Rp 1 miliar cap refused.
test('a rupiah target of several miliar is accepted; an absurd one is refused clearly', async (t) => {
  const writes = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    if (/FROM departments WHERE id/.test(sql)) return [[{ id: 5 }]];
    if (/INSERT INTO division_targets/.test(sql)) writes.push(args);
    return [[]];
  });
  const rupiah = registry.metrics().find((m) => m.unit === 'rupiah' && !m.permission);
  assert.ok(rupiah, 'a rupiah metric is registered');
  const user = { sub: 2, entityId: 1 };
  const saved = await targets.save(user, { departmentId: 5, metricKey: rupiah.key, period: '2026-Q4', targetValue: 7500000000 });
  assert.equal(saved.target, 7500000000);
  assert.equal(writes.length, 1);
  await assert.rejects(
    () => targets.save(user, { departmentId: 5, metricKey: rupiah.key, period: '2026-Q4', targetValue: 1e16 }),
    (e) => e.status === 400 && /terlalu besar/.test(e.message),
  );
});

// P1: "Nilai PO (sebelum PPN)" is purchase prices. Without procurement.price.view
// it is left out entirely — never queried, no cells, no stored target — and only
// named with the reason, so the page can say why it is missing.
function fakePriceQuery(calls) {
  return async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM departments d/.test(sql)) return [[{ id: 4, name: 'Procurement' }]];
    if (/FROM division_targets t/.test(sql)) {
      return [[{ id: 7, department_id: 4, metric_key: 'procurement_po_value', target_value: '777000000.00', note: 'Plafon belanja', updated_at: null, updated_by_name: 'MO' }]];
    }
    if (/FROM pc_po_prices_accurate v/.test(sql)) return [[{ department_id: 4, total: '654321000.00' }]];
    return [[]];
  };
}

async function targetsAs(t, permissions) {
  const calls = [];
  t.mock.method(pool, 'query', fakePriceQuery(calls));
  const res = responseDouble();
  await ctrl.targets({ user: { sub: 4, entityId: 1, departmentId: 6, permissions }, query: { period: '2026-Q3' } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  return { data: res.body.data, priceQueries: calls.filter((c) => /pc_po_price/.test(c.sql)) };
}

test('targets: no purchase-price rupiah without procurement.price.view — named, never valued', async (t) => {
  const { data, priceQueries } = await targetsAs(t, ['management_dashboard.view']);
  assert.ok(!data.metrics.some((m) => m.key === 'procurement_po_value'), 'not in the catalogue');
  assert.ok(!data.cells.some((c) => c.metricKey === 'procurement_po_value'), 'no cell');
  // Other modules' money figures sit behind their own permissions; this test is about purchase prices.
  assert.deepEqual(data.restricted.filter((r) => r.provider === 'procurement'), [{
    key: 'procurement_po_value', label: 'Nilai PO (sebelum PPN)', provider: 'procurement', providerLabel: 'Procurement',
    reason: 'Hanya untuk yang berwenang melihat harga beli',
  }]);
  assert.equal(priceQueries.length, 0, 'the price view is never queried');
  const body = JSON.stringify(data);
  assert.ok(!/654321000|777000000|Plafon belanja/.test(body), 'neither the actual nor the stored target leaks');
  assert.ok(data.metrics.some((m) => m.key === 'procurement_fill_rate'), 'the other Procurement metrics stay');
  assert.equal(data.canEdit, true);

  // A division Head without the permission (e.g. Finance Head) reads the same.
  const head = await targetsAs(t, ['management_dashboard.division']);
  assert.ok(!head.data.cells.some((c) => c.metricKey === 'procurement_po_value'));
  assert.equal(head.priceQueries.length, 0);
});

test('targets: with procurement.price.view the PO value is a metric like any other', async (t) => {
  const { data, priceQueries } = await targetsAs(t, ['management_dashboard.view', 'procurement.price.view']);
  assert.deepEqual(data.restricted.filter((r) => r.provider === 'procurement'), []);
  const cell = data.cells.find((c) => c.departmentId === 4 && c.metricKey === 'procurement_po_value');
  assert.equal(cell.actual, 654321000);
  assert.equal(cell.target, 777000000);
  assert.equal(cell.note, 'Plafon belanja');
  assert.equal(priceQueries.length, 1);
  assert.deepEqual(priceQueries[0].args.slice(0, 1), [1], 'entity bound first');
});

test('saving a PO value target needs procurement.price.view too', async (t) => {
  const writes = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    if (/FROM departments WHERE id/.test(sql)) return [[{ id: 4 }]];
    if (/INSERT INTO division_targets/.test(sql)) writes.push(args);
    return [[]];
  });
  const body = { departmentId: 4, metricKey: 'procurement_po_value', period: '2026-Q4', targetValue: 500000000 };
  await assert.rejects(
    () => targets.save({ sub: 2, entityId: 1, permissions: ['management_dashboard.view'] }, body),
    (e) => e.status === 403 && e.code === 'FORBIDDEN',
  );
  assert.equal(writes.length, 0);
  const saved = await targets.save({ sub: 2, entityId: 1, permissions: ['management_dashboard.view', 'procurement.price.view'] }, body);
  assert.equal(saved.target, 500000000);
  assert.equal(writes.length, 1);
});
