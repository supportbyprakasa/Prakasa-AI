const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const notif = require('../src/services/notification.service');
const batches = require('../src/services/salesAccurateBatches.service');
const reminders = require('../src/services/accurateBatchReminders.service');

// Light approvals (program 1.2): one clear sentence, every decider (the owner
// included), a reminder, then the Head and the owner once a day.

test('the notice says what changed and what the pull flagged, in one sentence', () => {
  assert.equal(batches.noticeText({
    counts: { wh_stock_total: { create: 0, update: 12, missing: 0 }, wh_delivery: { create: 3, update: 0, missing: 1 } },
    revenue: 0,
    checks: { stock_sum: { mismatched: 2 }, complete: false, unread_documents: { wh_transfer: 1 } },
  }), 'Stok barang: 12 berubah · Surat jalan (gudang): 3 baru, 1 tidak ada lagi · 2 barang: stok per gudang tidak cocok dengan total'
    + ' · bacaan Accurate tidak lengkap (tidak ada yang dinolkan) · 1 dokumen belum terbaca, ikut tarikan berikutnya');
  assert.equal(batches.noticeText({ counts: { sales_invoice: { create: 2, update: 0, missing: 0 } }, revenue: 1250000 }),
    'Faktur: 2 baru · DPP faktur Rp 1.250.000');
});

test('deciders include the owner set by name; an escalation reaches only the Head, stand-in and owner', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[{ id: 3 }, { id: '9' }]]; });
  assert.deepEqual(await batches.deciderIds(1, { approvalRequestId: 900, departmentId: 5 }), [3, 9]);
  assert.match(calls[0].sql, /JOIN users u ON u\.id = s\.escalated_to_user_id/, 'the owner decider');
  assert.match(calls[0].sql, /u\.department_id = \? OR ur\.role_id = s\.escalated_to_role_id/);
  assert.deepEqual(calls[0].args, [900, 1, 5, 900, 1]);
  await batches.deciderIds(1, { approvalRequestId: 900, departmentId: 5 }, { escalationOnly: true });
  assert.doesNotMatch(calls[1].sql, /u\.department_id = \?/, 'Supervisors are not escalated to');
  assert.deepEqual(calls[1].args, [900, 1, 900, 1]);
  for (const c of calls) assert.match(c.sql, /s\.status = 'pending'/);
});

test('nothing before 8 hours; a reminder to every decider; from a day on, the Head and owner once a day', () => {
  assert.equal(reminders.plan(7), null);
  assert.deepEqual(reminders.plan(8), { kind: 'reminder', key: 'reminder', event: 'accurate.batch_reminder' });
  assert.deepEqual(reminders.plan(30), { kind: 'escalated', key: 'escalated:1', event: 'accurate.batch_escalated', days: 1 });
  assert.equal(reminders.plan(50).key, 'escalated:2');
});

test('each reminder goes out once, links to the batch, and can be approved from the notification', async (t) => {
  const sent = [];
  const deciderQueries = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    if (/FROM sales_accurate_batches b JOIN departments d/.test(sql)) {
      return [[
        { id: 10, department_id: 3, approval_request_id: 910, department_name: 'Warehouse', hours: 30, summary: JSON.stringify({ counts: { wh_stock: { create: 0, update: 4, missing: 0 } } }) },
        { id: 11, department_id: 5, approval_request_id: 911, department_name: 'Sales', hours: 2, summary: '{"counts":{}}' },
      ]];
    }
    if (/FROM approval_steps s/.test(sql)) { deciderQueries.push(sql); return [[{ id: 4 }, { id: 6 }]]; }
    return [[]];
  });
  t.mock.method(notif, 'create', async (n) => { sent.push(n); return { id: sent.length }; });
  const result = await reminders.run(1);
  assert.deepEqual(result, { waiting: 2, sent: 2, failed: 0 });
  assert.equal(deciderQueries.length, 1, 'the 2-hour batch is left alone');
  assert.doesNotMatch(deciderQueries[0], /u\.department_id = \?/, 'a day late: escalated to the Head and the owner');
  for (const n of sent) {
    assert.equal(n.title, 'Data Accurate Warehouse tertunda 1 hari');
    assert.equal(n.body, 'Stok per gudang: 4 berubah');
    assert.equal(n.event, 'accurate.batch_escalated');
    assert.equal(n.subjectType, 'approval_request');
    assert.equal(n.subjectId, 910, 'the approval to decide straight from the notification');
    assert.equal(n.actionUrl, '/data-accurate/10');
    assert.equal(n.dedupeKey, 'accurate_batch:10:escalated:1');
  }
});

test('the job reminds only once switched on, and never on a dry run', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/jobs/accurateSync.js'), 'utf8');
  assert.match(src, /if \(!dryRun && process\.env\.ACCURATE_BATCH_REMINDERS === '1'\)/);
});

test('one batch that fails never stops the reminders of the others', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM sales_accurate_batches b JOIN departments d/.test(sql)) {
      return [[
        { id: 20, department_id: 3, approval_request_id: 920, department_name: 'Warehouse', hours: 9, summary: '{not json' },
        { id: 21, department_id: 5, approval_request_id: 921, department_name: 'Sales', hours: 9, summary: '{"counts":{}}' },
      ]];
    }
    if (/FROM approval_steps s/.test(sql)) return [[{ id: 4 }]];
    return [[]];
  });
  t.mock.method(notif, 'create', async () => ({ id: 1 }));
  assert.deepEqual(await reminders.run(1), { waiting: 2, sent: 1, failed: 1 });
});
