const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { validateProvider } = require('../src/management/contract');
const accurate = require('../src/management/providers/accurate');
const approvals = require('../src/management/providers/approvals');
const batches = require('../src/services/salesAccurateBatches.service');

// Data Accurate for every division: one escalation for a batch left waiting,
// scoped by the batch's division, and never listed twice.

const pending = accurate.escalations.find((s) => s.key === 'accurate_batch_pending');

test('the Data Accurate provider signs the management contract', () => {
  assert.doesNotThrow(() => validateProvider(accurate));
});

test('a batch of any division left waiting past a day reaches management, scoped to that division', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    return [[{ id: 12, item_count: 5400, department_id: 9, department_name: 'Warehouse', created_at: '2026-09-27 08:00:00', days_late: 1 }]];
  });
  const [item] = await pending.list(1, { departmentId: 9 });
  assert.equal(item.link, '/data-accurate/12');
  assert.equal(item.title, 'Data Accurate Warehouse');
  assert.match(item.context, /5400 perubahan belum disetujui — data Warehouse di aplikasi belum ikut diperbarui/);
  assert.doesNotMatch(item.context, /Sales/, 'not worded as a Sales problem');
  const query = calls[0];
  assert.match(query.sql, /b\.status = 'pending'/);
  assert.match(query.sql, /b\.department_id = \?/);
  assert.deepEqual(query.args, [1, 9]);
});

test('a waiting batch is flagged here only — approval_aged leaves Accurate batches out', async (t) => {
  assert.deepEqual(approvals.OWN_ESCALATION, [batches.REQUEST_TYPE]);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[]]; });
  await approvals.escalations.find((s) => s.key === 'approval_aged').list(1, { departmentId: null });
  assert.match(calls[0].sql, /\(a\.request_type IS NULL OR a\.request_type NOT IN \(\?\)\)/, 'approvals without a type are still escalated');
  assert.deepEqual(calls[0].args, [1, ['sales_accurate_sync']]);
});

test('the dashboard shows how many batches wait, and alerts once one is late', async (t) => {
  let row = { n: 2, items: 3700, late: 1 };
  t.mock.method(pool, 'query', async () => [[row]]);
  const kpi = accurate.kpis.find((k) => k.key === 'batches_waiting');
  assert.deepEqual(await kpi.value(1, { departmentId: 5 }), { value: 2, sub: '3700 perubahan', alert: true });
  row = { n: 0, items: 0, late: 0 };
  assert.deepEqual(await kpi.value(1, { departmentId: 5 }), { value: 0, sub: 'Semua sudah diputuskan', alert: false });
});

test('locate returns the batch scope, or null', async (t) => {
  let found = true;
  t.mock.method(pool, 'query', async () => [found ? [{ entity_id: 1, department_id: 9 }] : []]);
  assert.deepEqual(await pending.locate(12), { entityId: 1, departmentId: 9 });
  found = false;
  assert.equal(await pending.locate(12), null);
});

test('Data Accurate KPIs and the division filter of the batch list only ever narrow to the asked division', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[{ n: 0, items: 0, late: 0, code: 'sales', id: 5 }]]; });
  await accurate.kpis.find((k) => k.key === 'batches_waiting').value(1, { departmentId: 9 });
  assert.match(calls[0].sql, /b\.department_id = \?/);
  assert.deepEqual(calls[0].args, [1, 9]);
  const warehouse = require('../src/management/providers/warehouse');
  calls.length = 0;
  await warehouse.kpis.find((k) => k.key === 'warehouse_stock_age').value(1, { departmentId: null });
  assert.match(calls[0].sql, /d\.code = 'warehouse'/);
  calls.length = 0;
  await batches.listBatches({ sub: 7, entityId: 1 }, { division: 'warehouse', page: 1, limit: 10, offset: 0 });
  const list = calls.find((c) => /ORDER BY b\.id DESC/.test(c.sql));
  assert.match(list.sql, /b\.department_id = \? OR /, 'still limited to what the user may see');
  assert.match(list.sql, /code = \?/);
  assert.ok(list.args.includes('warehouse'));
});

test('an escalation keyed by an Accurate id is located within the caller\'s company', async (t) => {
  const warehouse = require('../src/management/providers/warehouse');
  const sales = require('../src/management/providers/sales');
  const rows = { 1: { entity_id: 1, department_id: 9 }, 2: { entity_id: 2, department_id: 19 } };
  t.mock.method(pool, 'query', async (sql, args) => [[/entity_id = \?/.test(sql) ? rows[args[args.length - 1]] : rows[1]].filter(Boolean)]);
  for (const s of [warehouse.escalations.find((x) => x.key === 'warehouse_stock_negative'), warehouse.escalations.find((x) => x.key === 'warehouse_transfer_stuck'),
    sales.escalations.find((x) => x.key === 'sales_accurate_invoice_overdue')]) {
    assert.deepEqual(await s.locate(3000001, { entityId: 2 }), { entityId: 2, departmentId: 19 }, s.key);
  }
  // A reconciliation "not in the app" row is keyed by an Accurate document id (penerimaan 1500000).
  const { docSourceId } = require('../src/services/warehouseReconModel');
  const notInApp = warehouse.escalations.find((x) => x.key === 'warehouse_recon_not_in_app');
  assert.deepEqual(await notInApp.locate(docSourceId(1500000, 'inbound'), { entityId: 2 }), { entityId: 2, departmentId: 19 }, notInApp.key);
});
