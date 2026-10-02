const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const activityLog = require('../src/services/activityLog.service');
const ctrl = require('../src/controllers/departments.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('partial update only writes the fields that were sent', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push([String(sql), args]); return [{ affectedRows: 1 }]; });
  t.mock.method(activityLog, 'log', async () => {});
  const res = responseDouble();
  await ctrl.update({ params: { id: '7' }, body: { name: 'Gudang Baru' }, user: { sub: 1 } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  const update = calls.find(([sql]) => sql.startsWith('UPDATE departments'));
  assert.match(update[0], /SET name = \? WHERE/);
  assert.deepEqual(update[1], ['Gudang Baru', '7']);
});

test('a division still used by users or roles cannot be deleted', async (t) => {
  const writes = [];
  t.mock.method(pool, 'query', async (sql) => {
    const s = String(sql);
    if (s.includes('FROM users')) return [[{ total: 3 }]];
    if (s.includes('FROM roles')) return [[{ total: 2 }]];
    writes.push(s);
    return [{ affectedRows: 1 }];
  });
  const res = responseDouble();
  await ctrl.remove({ params: { id: '7' }, user: { sub: 1 } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'DEPARTMENT_IN_USE');
  assert.match(res.body.error.message, /3 pengguna/);
  assert.deepEqual(writes, []);
});

test('import rejects rows for an unknown entity and duplicate names', async (t) => {
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, args) {
      const s = String(sql);
      if (s.includes('FROM entities')) return [[...(args[0] === 1 ? [{ id: 1 }] : [])]];
      // Mirrors the case-insensitive column collation: "warehouse" matches existing "Warehouse".
      if (s.includes('FROM departments')) return [[...(String(args[1]).toLowerCase() === 'warehouse' ? [{ id: 5 }] : [])]];
      return [{ insertId: 30 }];
    },
  };
  t.mock.method(pool, 'getConnection', async () => connection);
  const res = responseDouble();
  await ctrl.importRows({
    body: { rows: [
      { rowNumber: 2, values: { entityId: 1, name: 'Legal' } },
      { rowNumber: 3, values: { entityId: 99, name: 'QA' } },
      { rowNumber: 4, values: { entityId: 1, name: 'warehouse' } },
    ] },
    user: { sub: 1, entityId: 1 },
  }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.body.error.details.rowErrors, [
    { rowNumber: 3, field: 'entityId', message: 'Entity tidak ditemukan' },
    { rowNumber: 4, field: 'name', message: 'Divisi "warehouse" sudah ada di entity ini' },
  ]);
});
