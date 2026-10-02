const test = require('node:test');
const assert = require('node:assert/strict');
const { pool, dbReady, inRolledBackTransaction, makeUser, makeLocation, makeResource, tag } = require('./fixtures/gaDb');
const { validateProvider } = require('../src/management/contract');
const ga = require('../src/management/providers/ga');
const requests = require('../src/services/gaRequests.service');

// Layanan GA reports into management (§3.6), and Operasional GA (migration
// 114) with it: four escalations, five metrics, two KPIs — each scoped in SQL
// (requests by the requester's division, operations by People & Culture).

test.after(() => pool.end());

const PERIOD = { start: '2026-10-01', end: '2026-10-31' };

test('provider: contract, keys that fit their columns, nav paths /ga and /ga/operations', () => {
  assert.doesNotThrow(() => validateProvider(ga));
  assert.equal(ga.key, 'ga');
  assert.deepEqual(ga.navPaths, ['/ga', '/ga/operations']);
  assert.deepEqual(ga.escalations.map((e) => e.key), ['ga_request_overdue', 'ga_maintenance_overdue', 'ga_contract_ending', 'ga_bill_overdue']);
  assert.deepEqual(ga.metrics.map((m) => m.key), ['ga_requests_done', 'ga_requests_on_time', 'ga_resolution_days', 'ga_upkeep_done', 'ga_upkeep_on_time']);
  assert.deepEqual(ga.kpis.map((k) => k.key), ['ga_open_requests', 'ga_upkeep_overdue']);
  for (const e of ga.escalations) assert.ok(e.key.length <= 32, e.key);
  const on = ga.metrics.find((m) => m.key === 'ga_requests_on_time');
  assert.equal(on.emptyIsZero, undefined, 'a rate over nothing is unknown, not 0%');
});

test('provider: the division filter reaches the SQL, bound after the entity, in every capability', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args = []) => {
    calls.push({ sql, args });
    if (/any_data/.test(sql)) return [[{ any_data: 1 }]];
    return [[]];
  });
  const run = async (fn) => { calls.length = 0; await fn(); return calls.filter((c) => !/any_data/.test(c.sql)); };
  for (const e of ga.escalations) {
    const [c] = await run(() => e.list(1, { departmentId: 9 }));
    assert.match(c.sql, /\.department_id = \?/, e.key);
    assert.deepEqual(c.args.slice(0, 2), [1, 9], e.key);
  }
  for (const m of ga.metrics) {
    const [c] = await run(() => m.actuals(1, PERIOD, { departmentId: 9 }));
    assert.match(c.sql, /[rm]\.department_id = \?/, m.key);
    assert.deepEqual(c.args.slice(0, 2), [1, 9], m.key);
  }
  for (const k of ga.kpis) {
    const [c] = await run(() => k.value(1, { departmentId: 9 }));
    assert.match(c.sql, /\.department_id = \?/, k.key);
    assert.deepEqual(c.args, [1, 9], k.key);
  }
  // Entity-wide: no division filter at all.
  const [all] = await run(() => ga.escalations[0].list(1, { departmentId: null }));
  assert.doesNotMatch(all.sql, /department_id = \?/);
});

test('provider: no alarm while the entity has never used Layanan GA', async (t) => {
  t.mock.method(pool, 'query', async () => [[{ any_data: 0 }]]);
  for (const k of ga.kpis) {
    const out = await k.value(1, { departmentId: null });
    assert.equal(out.value, null);
    assert.equal(out.alert, false);
  }
});

test('db: overdue requests show for their division and entity-wide, never for another; locate matches', async (t) => {
  if (!(await dbReady())) return t.skip('no database with migration 109');
  await inRolledBackTransaction(t, async (conn) => {
    const loc = await makeLocation(conn);
    const staff = await makeUser(conn, { name: 'Staf', division: 'warehouse', roles: ['warehouse.member'] });
    const ga2 = await makeUser(conn, { name: 'GA', division: 'people_culture', roles: ['people_culture.member'] });
    const r = await requests.create(staff.user, { requestType: 'atk', locationId: loc, items: [{ itemName: 'Kertas', qty: 1, unit: 'rim' }] });
    await conn.query('UPDATE ga_requests SET due_at = UTC_TIMESTAMP() - INTERVAL 3 DAY WHERE id = ?', [r.id]);
    const wh = staff.user.departmentId;
    const [[sales]] = await conn.query("SELECT id FROM departments WHERE entity_id = 1 AND code = 'sales'");

    const overdue = await ga.escalations[0].list(1, { departmentId: wh });
    const item = overdue.find((x) => x.sourceId === r.id);
    assert.ok(item);
    assert.equal(item.link, `/ga/requests/${r.id}`);
    assert.ok(item.daysLate >= 2);
    assert.ok((await ga.escalations[0].list(1, { departmentId: null })).some((x) => x.sourceId === r.id));
    assert.equal((await ga.escalations[0].list(1, { departmentId: sales.id })).some((x) => x.sourceId === r.id), false);
    assert.deepEqual(await ga.escalations[0].locate(r.id), { entityId: 1, departmentId: wh });

    const open = await ga.kpis[0].value(1, { departmentId: wh });
    assert.ok(open.value >= 1 && open.alert === true);

    // Finish it (late): done metric counts it, on-time rate is below 100 %.
    const started = await requests.setStatus(ga2.user, r.id, { status: 'in_progress', version: (await requests.get(ga2.user, r.id)).version });
    await requests.setStatus(ga2.user, r.id, { status: 'done', note: 'Diantar', version: started.version });
    const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    const period = { start: today, end: today };
    assert.ok((await ga.metrics[0].actuals(1, period, { departmentId: wh })).get(wh) >= 1);
    assert.ok((await ga.metrics[1].actuals(1, period, { departmentId: wh })).get(wh) < 100);
    assert.ok((await ga.metrics[2].actuals(1, period, { departmentId: wh })).get(wh) >= 0);
  });
});
