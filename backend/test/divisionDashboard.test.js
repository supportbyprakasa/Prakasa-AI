const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const svc = require('../src/services/divisionDashboard.service');
const registry = require('../src/management/registry');

// Dashboard divisi (migration 116): who sees which division, which modules a
// division shows and how they are scoped, and the 12-month window.

test.after(() => pool.end());

test('twelve months up to the current WIB month, oldest first', () => {
  const months = svc.lastMonths(12, new Date(Date.UTC(2026, 9, 1)));
  assert.equal(months.length, 12);
  assert.equal(months[0].key, '2025-11');
  assert.equal(months[11].key, '2026-10');
  assert.equal(months[11].end, '2026-10-31');
  assert.equal(months[3].label, 'Feb 2026');
  assert.equal(months[3].end, '2026-02-28');
});

test('counts add up across divisions; rates and averages are the plain mean', () => {
  assert.equal(svc.combine({ cumulative: true }, [3, null, 4]), 7);
  assert.equal(svc.combine({ cumulative: false }, [80, 90, null]), 85);
  assert.equal(svc.combine({ cumulative: true }, [null]), null);
});

test('each division shows its own modules; People & Culture runs IT, GA and onboarding for the whole company', () => {
  const keys = new Set(registry.providers().map((p) => p.key));
  for (const [code, scopes] of Object.entries(svc.DIVISION_PROVIDERS)) {
    for (const key of Object.keys(scopes)) assert.ok(keys.has(key), `${code}: provider ${key} exists`);
    assert.equal(scopes.approvals, 'division', code);
    assert.equal(scopes.project_tracker, 'division', code);
  }
  assert.deepEqual(svc.providerScopes({ code: 'people_culture' }), { hrga: 'entity', it: 'entity', ga: 'entity', approvals: 'division', project_tracker: 'division' });
  assert.equal(svc.providerScopes({ code: 'warehouse' }).warehouse, 'division');
  assert.equal(svc.providerScopes({ code: 'warehouse' }).sales, undefined, 'no Sales figures on the Warehouse dashboard');
  const mo = svc.providerScopes({ code: 'management_office' });
  assert.ok(Object.values(mo).every((s) => s === 'entity') && Object.keys(mo).length === keys.size, 'Management Office sees every module, company-wide');
});

test('access: Supervisor/Head their own division only; management any division or the whole company', async (t) => {
  t.mock.method(pool, 'query', async (sql, args) => [[{ id: args[0], name: `Divisi ${args[0]}`, code: args[0] === 5 ? 'sales' : 'warehouse' }]]);
  const head = { entityId: 1, departmentId: 5, permissions: ['division_dashboard.view'] };
  assert.deepEqual(await svc.resolveDivision(head, null), { id: 5, name: 'Divisi 5', code: 'sales' });
  await assert.rejects(svc.resolveDivision(head, '9'), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(svc.resolveDivision(head, 'all'), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(svc.resolveDivision({ entityId: 1, departmentId: 5, permissions: [] }, null), (e) => e.code === 'FORBIDDEN', 'a member has no division dashboard');
  await assert.rejects(svc.resolveDivision({ entityId: 1, departmentId: null, permissions: ['division_dashboard.view'] }, null), (e) => e.code === 'NO_DEPARTMENT');
  const mo = { entityId: 1, departmentId: 7, permissions: ['management_dashboard.view'] };
  assert.equal((await svc.resolveDivision(mo, '9')).id, 9);
  assert.deepEqual(await svc.resolveDivision(mo, 'all'), { id: null, name: 'Seluruh perusahaan', code: 'all' });
});

test('a figure behind a permission is not computed for someone without it; series only for the division\'s modules', async (t) => {
  t.mock.method(pool, 'query', async (sql, args) => {
    if (/FROM departments WHERE id = \?/.test(sql)) return [[{ id: 4, name: 'Procurement', code: 'procurement' }]];
    return [[]];
  });
  const priced = registry.kpis().find((k) => k.key === 'procurement_po_value_month');
  const called = [];
  t.mock.method(priced, 'value', async () => { called.push(1); return { value: 1 }; });
  const out = await svc.build({ entityId: 1, departmentId: 4, permissions: ['division_dashboard.view'] }, {});
  const card = out.kpis.find((k) => k.key === 'procurement_po_value_month');
  assert.equal(card.restricted, true);
  assert.equal(called.length, 0);
  assert.ok(out.kpis.every((k) => ['procurement', 'accurate', 'approvals', 'project_tracker'].includes(k.provider)));
  assert.equal(out.metrics.some((m) => m.key === 'procurement_po_value'), false, 'purchase value series hidden without procurement.price.view');
  assert.equal(out.months.length, 12);
  assert.deepEqual(out.divisions, [], 'only management gets the division picker');
});
