const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const checklists = require('../src/controllers/warehouseChecklists.controller');
const incidents = require('../src/controllers/warehouseIncidents.controller');

// Checklists and incidents belong to the signed-in user's company and to the
// Warehouse division — never to whatever company the request names.

const user = { sub: 7, entityId: 1 };

function fakeDb(t) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM departments/.test(sql)) return [[{ id: 9 }]];
    if (/^\s*INSERT INTO (warehouse_checklists|warehouse_incidents)/.test(sql)) return [{ insertId: 55 }];
    if (/^\s*UPDATE/.test(sql)) return [{ affectedRows: args[args.length - 1] === 1 ? 1 : 0 }];
    return [[]];
  });
  return calls;
}

function run(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; resolve(this); return this; },
    };
    Promise.resolve(handler(req, res, reject)).catch(reject);
  });
}

test('lists only the user\'s company, whatever the query asks for', async (t) => {
  const calls = fakeDb(t);
  await run(checklists.list, { user, query: { entityId: '2' } });
  await run(incidents.list, { user, query: { entityId: '2', status: 'open' } });
  const lists = calls.filter((c) => /^\s*SELECT id, entity_id/.test(c.sql));
  assert.equal(lists.length, 2);
  for (const c of lists) {
    assert.match(c.sql, /WHERE entity_id = \?/);
    assert.equal(c.args[0], 1);
    assert.ok(!c.args.includes('2'), 'the requested company is ignored');
  }
});

test('a new checklist or incident gets the user\'s company and the Warehouse division', async (t) => {
  const calls = fakeDb(t);
  const res1 = await run(checklists.create, { user, body: { entityId: 2, departmentId: 3, checklistDate: '2026-09-29', title: 'Buka gudang', items: [] } });
  const res2 = await run(incidents.create, { user, body: { entityId: 2, departmentId: 3, incidentDate: '2026-09-29', category: 'Rusak', description: 'Dus penyok' } });
  assert.equal(res1.statusCode, 201);
  assert.equal(res2.statusCode, 201);
  const inserts = calls.filter((c) => /^\s*INSERT INTO warehouse_/.test(c.sql));
  assert.deepEqual(inserts.map((c) => c.args.slice(0, 2)), [[1, 9], [1, 9]]);
});

test('completing or resolving only reaches the user\'s own company', async (t) => {
  const calls = fakeDb(t);
  await run(checklists.complete, { user, params: { id: '5' }, body: { items: [] } });
  await run(incidents.resolve, { user, params: { id: '6' }, body: { resolution: 'Diganti' } });
  const updates = calls.filter((c) => /^\s*UPDATE/.test(c.sql));
  assert.equal(updates.length, 2);
  for (const c of updates) {
    assert.match(c.sql, /WHERE id=\? AND entity_id=\?/);
    assert.equal(c.args[c.args.length - 1], 1);
  }
  const other = await run(incidents.resolve, { user: { sub: 7, entityId: 2 }, params: { id: '6' }, body: {} });
  assert.equal(other.statusCode, 404);
});
