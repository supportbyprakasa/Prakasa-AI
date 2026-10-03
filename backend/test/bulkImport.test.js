const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');
const pool = require('../src/db/pool');
const { runBulkImport, ImportRowError } = require('../src/services/bulkImport.service');

const schema = z.object({ name: z.string().min(1).max(10), entityId: z.number().int().positive() });

function fakeConnection() {
  const state = { inserts: [], committed: false, rolledBack: false, released: false };
  return {
    state,
    async beginTransaction() {},
    async commit() { state.committed = true; },
    async rollback() { state.rolledBack = true; },
    release() { state.released = true; },
  };
}

test('schema errors are reported per row and nothing is written', async (t) => {
  const connection = fakeConnection();
  t.mock.method(pool, 'getConnection', async () => connection);
  const result = await runBulkImport({
    rows: [
      { rowNumber: 2, values: { name: 'Gudang', entityId: 1 } },
      { rowNumber: 3, values: { name: '', entityId: 'x' } },
    ],
    schema,
    insertRow: async () => { throw new Error('must not insert'); },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.rowErrors.map((e) => [e.rowNumber, e.field]), [[3, 'name'], [3, 'entityId']]);
  assert.equal(connection.state.committed, false);
});

test('domain and duplicate errors roll back every row in the batch', async (t) => {
  const connection = fakeConnection();
  t.mock.method(pool, 'getConnection', async () => connection);
  const inserted = [];
  const result = await runBulkImport({
    rows: [
      { rowNumber: 2, values: { name: 'A', entityId: 1 } },
      { rowNumber: 3, values: { name: 'B', entityId: 9 } },
      { rowNumber: 4, values: { name: 'C', entityId: 1 } },
    ],
    schema,
    insertRow: async (_conn, data) => {
      if (data.entityId === 9) throw new ImportRowError('entityId', 'Entity tidak ditemukan');
      if (data.name === 'C') throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
      inserted.push(data.name);
      return 1;
    },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.rowErrors, [
    { rowNumber: 3, field: 'entityId', message: 'Entity tidak ditemukan' },
    { rowNumber: 4, field: null, message: 'Data sudah ada (duplikat)' },
  ]);
  assert.equal(connection.state.rolledBack, true);
  assert.equal(connection.state.committed, false);
  assert.equal(connection.state.released, true);
});

test('a clean batch commits and reports the created count', async (t) => {
  const connection = fakeConnection();
  t.mock.method(pool, 'getConnection', async () => connection);
  let nextId = 10;
  const result = await runBulkImport({
    rows: [{ rowNumber: 2, values: { name: 'A', entityId: 1 } }, { rowNumber: 3, values: { name: 'B', entityId: 1 } }],
    schema,
    insertRow: async () => nextId++,
  });
  assert.deepEqual(result, { ok: true, created: 2, ids: [10, 11] });
  assert.equal(connection.state.committed, true);
});

test('empty and oversized batches are rejected before touching the database', async (t) => {
  t.mock.method(pool, 'getConnection', async () => { throw new Error('must not connect'); });
  await assert.rejects(runBulkImport({ rows: [], schema, insertRow: async () => 1 }), { code: 'IMPORT_EMPTY' });
  const many = Array.from({ length: 3 }, (_, i) => ({ rowNumber: i + 2, values: { name: 'A', entityId: 1 } }));
  await assert.rejects(runBulkImport({ rows: many, schema, insertRow: async () => 1, maxRows: 2 }), { code: 'IMPORT_TOO_LARGE' });
});
