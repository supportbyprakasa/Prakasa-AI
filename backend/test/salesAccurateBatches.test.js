const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db/pool');
const engine = require('../src/services/approvalEngine.service');
const notif = require('../src/services/notification.service');
const lifecycle = require('../src/services/approvalSubjectLifecycle.service');
const batches = require('../src/services/salesAccurateBatches.service');

// A connection double: answers by SQL pattern and records every statement.
function fakeConnection(handlers, calls) {
  return {
    async query(sql, args) {
      calls.push({ sql, args });
      for (const [re, value] of handlers) if (re.test(sql)) return typeof value === 'function' ? value(sql, args) : value;
      return [{ affectedRows: 1, insertId: 1 }];
    },
    beginTransaction: async () => { calls.push({ sql: 'BEGIN' }); },
    commit: async () => { calls.push({ sql: 'COMMIT' }); },
    rollback: async () => { calls.push({ sql: 'ROLLBACK' }); },
    release: () => {},
  };
}

const invoice = (id, channel, extra = {}) => ({
  recordType: 'sales_invoice', action: 'create', externalKey: String(id), label: `SI${id}`, amount: 900,
  after: { number: `SI${id}`, trans_date: '2026-09-29', customer_no: 'C-1', channel, dpp_amount: 900, ...extra },
});

// TEGAS: no change or removal of the app's existing data — ever.
const touchesAppData = (calls) => calls.some((c) => /(INSERT INTO|UPDATE|DELETE FROM)\s+sales_(customers|orders|order_lines|products|owner_links|leads)\b/.test(c.sql));
const changesMirror = (calls) => calls.some((c) => /(UPDATE|DELETE FROM)\s+accurate_records\b/.test(c.sql));

function stagingDb(calls, { waiting = null, flowType = 'sequential' } = {}, t) {
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM departments WHERE/.test(sql)) return [[{ id: 5, code: 'sales', name: 'Sales' }, { id: 8, code: 'retail_commerce', name: 'Retail Commerce' }]];
    return [[]];
  });
  let batchId = 40;
  t.mock.method(pool, 'getConnection', async () => fakeConnection([
    [/FROM sales_accurate_batches WHERE entity_id = \? AND department_id = \? AND status = 'pending'/, (sql, args) => [[waiting && waiting === args[1] ? { id: 39 } : undefined].filter(Boolean)]],
    [/INSERT INTO sales_accurate_batches/, () => [{ insertId: (batchId += 1) }]],
    [/SELECT COUNT\(DISTINCT u\.id\) AS n/, [[{ n: 1 }]]],
  ], calls));
  const created = [];
  t.mock.method(engine, 'createApprovalRequest', async (ctx) => { created.push(ctx); return { id: 900 + created.length, flowType }; });
  t.mock.method(notif, 'create', async () => ({}));
  return created;
}

test('a pull is staged per division and submitted for approval — nothing is written yet', async (t) => {
  const calls = [];
  const created = stagingDb(calls, {}, t);
  const result = await batches.stageChanges({
    entityId: 1, requestedBy: 2, changes: [
      invoice(1, 'Horeca'),
      invoice(2, 'Shopee'),
      { recordType: 'customer', action: 'update', externalKey: '77', label: 'Toko A', before: { number: 'C-1', name: 'Toko A', channel: 'GT' }, after: { number: 'C-1', name: 'Toko A2', channel: 'GT' } },
    ],
  });
  assert.deepEqual(result.batches.map((b) => [b.departmentId, b.itemCount]).sort(), [[5, 2], [8, 1]]);
  assert.deepEqual(created.map((c) => [c.departmentId, c.requestType, c.subjectType]).sort(), [
    [5, 'sales_accurate_sync', 'sales_accurate_batch'], [8, 'sales_accurate_sync', 'sales_accurate_batch'],
  ]);
  assert.equal(touchesAppData(calls), false);
  assert.ok(!calls.some((c) => /INSERT INTO accurate_records/.test(c.sql)), 'the mirror only grows when a batch is approved');
  const escalate = calls.filter((c) => /SET s\.escalated_at = NOW\(\), s\.escalated_to_role_id = am\.escalation_role_id/.test(c.sql));
  assert.equal(escalate.length, 2, 'the Head can decide from the start, next to the Supervisor');
});

test('a mapping mistake is refused before anyone is asked to approve it', async (t) => {
  const calls = [];
  stagingDb(calls, {}, t);
  await assert.rejects(
    () => batches.stageChanges({ entityId: 1, requestedBy: 2, changes: [invoice(1, 'GT', { tanggal: '2026-09-29' })] }),
    (e) => e.status === 400 && /kolom tidak dikenal.*tanggal/.test(e.message),
  );
  await assert.rejects(
    () => batches.stageChanges({ entityId: 1, requestedBy: 2, changes: [{ recordType: 'sales_invoice', action: 'create', externalKey: '9', after: { channel: 'GT' } }] }),
    (e) => e.status === 400 && /butuh number, trans_date/.test(e.message),
  );
  await assert.rejects(
    () => batches.stageChanges({ entityId: 1, requestedBy: 2, changes: [{ recordType: 'sales_invoice', action: 'delete', externalKey: '9', before: {} }] }),
    (e) => e.status === 400 && /aksi "delete"/.test(e.message), 'there is no delete — only "missing"',
  );
  await assert.rejects(
    () => batches.stageChanges({ entityId: 1, requestedBy: 2, changes: [{ ...invoice(1, 'GT'), externalKey: 'SI1' }] }),
    (e) => e.status === 400 && /ID Accurate/.test(e.message),
  );
  assert.ok(!calls.some((c) => /INSERT INTO sales_accurate_batches/.test(c.sql)));
});

test('a key listed as one value cannot smuggle a nested object (e.g. a phone inside ship_to)', () => {
  const type = { dataKeys: { category: null, so_numbers: null, lines: ['item_no'] } };
  assert.deepEqual(batches.unlistedDataKeys(type, { category: 'GT', so_numbers: ['SO1', 'SO2'] }), []);
  assert.deepEqual(batches.unlistedDataKeys(type, { category: { name: 'GT', phone: '0812' } }), ['category{}']);
  assert.deepEqual(batches.unlistedDataKeys(type, { so_numbers: [{ number: 'SO1' }] }), ['so_numbers{}']);
  assert.deepEqual(batches.unlistedDataKeys(type, { lines: { item_no: 'A' } }), ['lines{}']);
});

test('Sales and Warehouse types share the mirror but never a record type; Warehouse types belong to Warehouse', () => {
  const sales = new Set(batches.SALES_TYPE_NAMES);
  for (const name of batches.WAREHOUSE_TYPE_NAMES) {
    assert.ok(!sales.has(name), name);
    assert.ok(name.length <= 20, `${name} fits record_type VARCHAR(20)`);
    assert.equal(batches.RECORD_TYPES[name].division, 'warehouse', name);
  }
  for (const name of batches.SALES_TYPE_NAMES) assert.equal(batches.RECORD_TYPES[name].division, undefined, `${name} follows the customer channel`);
});

test('only listed data is kept: personal data, costs or any unlisted key is refused at staging', async (t) => {
  const calls = [];
  stagingDb(calls, {}, t);
  for (const [data, bad] of [
    [{ tax_amount: 1, customer_phone: '0812' }, /customer_phone/],
    [{ lines: [{ item_no: 'A', qty: 1, unit_cost: 5000 }] }, /lines\[\]\.unit_cost/],
    [{ lines: ['A'] }, /lines\[\]/],
    ['text', /data/],
  ]) {
    await assert.rejects(
      () => batches.stageChanges({ entityId: 1, requestedBy: 2, changes: [invoice(1, 'GT', { data })] }),
      (e) => e.status === 400 && /isi data tidak terdaftar/.test(e.message) && bad.test(e.message),
      JSON.stringify(data),
    );
  }
  assert.ok(!calls.some((c) => /INSERT INTO sales_accurate_batches/.test(c.sql)));
});

test('every Accurate normalizer only produces data keys its record type allows', () => {
  const sync = require('../src/services/accurate/accurateSync.service');
  const channels = new Map();
  const detail = {
    masterSalesmanName: 'Aris',
    detailItem: [{ item: { no: 'A', name: 'Oatside' }, quantity: 2, itemUnit: { name: 'Ctns' }, salesAmount: 100, salesOrder: { number: 'SO1' } }],
    detailInvoice: [{ invoice: { number: 'SI1' }, paymentAmount: 100 }],
  };
  const doc = { number: 'X1', transDate: '29/09/2026', dueDate: '29/10/2026', customer: { customerNo: 'GT-1', name: 'C' }, totalAmount: 111, tax1Amount: 11, primeOwing: 111 };
  const rows = {
    customer: sync.customerRow({ customerNo: 'GT-1', name: 'C', category: { name: 'GT' }, createDate: '01/01/2026' }),
    sales_order: sync.orderRow({ ...doc, percentShipped: 50 }, channels),
    sales_invoice: sync.invoiceRow(doc, channels, sync.invoiceExtra(detail)),
    delivery_order: sync.deliveryRow(doc, channels, detail),
    sales_receipt: sync.receiptRow({ ...doc, totalPayment: 100, bank: { name: 'BCA' } }, channels, detail),
    sales_return: sync.returnRow(doc, channels),
    item: sync.itemRow({ no: 'A', name: 'Oatside', itemCategory: { name: 'Dairy' }, itemTypeName: 'Persediaan', unitPrice: 0 }),
  };
  assert.deepEqual(Object.keys(rows).sort(), [...batches.SALES_TYPE_NAMES].sort(), 'every Sales record type is covered here');
  for (const [type, row] of Object.entries(rows)) {
    assert.deepEqual(batches.unlistedDataKeys(batches.RECORD_TYPES[type], row.data), [], type);
  }
});

test('a division whose last batch is still waiting is skipped; the next pull brings the changes again', async (t) => {
  const calls = [];
  stagingDb(calls, { waiting: 8 }, t);
  const result = await batches.stageChanges({
    entityId: 1, requestedBy: 2, changes: [invoice(1, 'GT'), invoice(2, 'TokoPedia')],
  });
  assert.deepEqual(result.batches.map((b) => b.departmentId), [5]);
  assert.deepEqual(result.skipped, [{ departmentId: 8, reason: 'PENDING_BATCH', pendingBatchId: 39 }]);
});

test('without an approval matrix the batch is not staged at all', async (t) => {
  const calls = [];
  stagingDb(calls, { flowType: 'legacy' }, t);
  await assert.rejects(
    () => batches.stageChanges({ entityId: 1, requestedBy: 2, changes: [invoice(1, 'GT')] }),
    (e) => e.code === 'APPROVAL_MATRIX_MISSING',
  );
  assert.ok(calls.some((c) => c.sql === 'ROLLBACK'));
  assert.ok(!calls.some((c) => c.sql === 'COMMIT'));
});

const approval = { id: 901, entity_id: 1, subject_type: 'sales_accurate_batch', subject_id: 41 };
const pendingBatch = { id: 41, entity_id: 1, department_id: 5, status: 'pending', approval_request_id: 901 };

test('the approval engine routes Accurate batches to this module, and nobody can open one by hand', () => {
  assert.ok(lifecycle.isManagedSubject('sales_accurate_batch'));
  assert.ok(lifecycle.isManagedSubject('sales_accurate_sync'));
});

test('a batch is approved or rejected — with a reason — never sent back for revision', async () => {
  const calls = [];
  const db = fakeConnection([[/FROM sales_accurate_batches WHERE id = \?/, [[pendingBatch]]]], calls);
  await assert.rejects(() => batches.assertCanDecide({ approval, action: 'request_revision', conn: db }), (e) => e.status === 400);
  await assert.rejects(() => batches.assertCanDecide({ approval, action: 'reject', note: ' ', conn: db }), (e) => /alasan/.test(e.message));
  await batches.assertCanDecide({ approval, action: 'reject', note: 'Nilai SO belum final', conn: db });
  await batches.assertCanDecide({ approval, action: 'approve', conn: db });

  const decided = fakeConnection([[/FROM sales_accurate_batches WHERE id = \?/, [[{ ...pendingBatch, status: 'applied' }]]]], []);
  await assert.rejects(() => batches.assertCanDecide({ approval, action: 'approve', conn: decided }), (e) => e.status === 409);
  const stale = fakeConnection([[/FROM sales_accurate_batches WHERE id = \?/, [[{ ...pendingBatch, approval_request_id: 800 }]]]], []);
  await assert.rejects(() => batches.assertCanDecide({ approval, action: 'approve', conn: stale }), (e) => e.code === 'STALE_APPROVAL');
});

test('rejecting changes nothing; approving only adds version rows to the Accurate mirror', async () => {
  const calls = [];
  const items = [
    { id: 1, record_type: 'sales_invoice', action: 'create', external_key: '501', before_data: null,
      after_data: JSON.stringify({ number: 'SI1', trans_date: '2026-09-29', dpp_amount: 900, data: { so_numbers: ['SO1'], _last_update: 'x' } }) },
    { id: 2, record_type: 'customer', action: 'update', external_key: '77',
      before_data: JSON.stringify({ number: 'C-1', name: 'Toko A' }), after_data: JSON.stringify({ number: 'C-1', name: 'Toko A2' }) },
    { id: 3, record_type: 'sales_order', action: 'missing', external_key: '301',
      before_data: JSON.stringify({ number: 'SO9', trans_date: '2026-09-01' }), after_data: null },
  ];
  const db = fakeConnection([
    [/FROM sales_accurate_batches WHERE id = \?/, [[pendingBatch]]],
    [/FROM sales_accurate_batch_items/, [items]],
    [/SELECT MAX\(version\) AS v FROM accurate_records/, (sql, args) => [[{ v: args[2] === '77' ? 3 : null }]]],
    [/^\s*SELECT/, [[]]],
  ], calls);

  const rejected = await batches.applyApprovalDecision({ approval, result: { status: 'rejected' }, actorUserId: 25, note: 'belum final', conn: db });
  assert.equal(rejected.status, 'rejected');
  assert.ok(!calls.some((c) => /INSERT INTO accurate_records/.test(c.sql)));

  calls.length = 0;
  const still = await batches.applyApprovalDecision({ approval, result: { status: 'pending' }, actorUserId: 25, conn: db });
  assert.deepEqual(still, { changed: false }, 'a step decided while others are pending changes nothing');

  const applied = await batches.applyApprovalDecision({ approval, result: { status: 'approved' }, actorUserId: 25, conn: db });
  assert.equal(applied.status, 'applied');
  assert.deepEqual(applied.applied, { items: 3, create: 1, update: 1, missing: 1 });
  const inserts = calls.filter((c) => /INSERT INTO accurate_records/.test(c.sql));
  assert.equal(inserts.length, 3);
  const versionOf = (key) => inserts.find((c) => c.args[2] === key).args[3];
  assert.equal(versionOf('501'), 1);
  assert.equal(versionOf('77'), 4, 'a change is a new version on top of the old ones');
  const missingRow = inserts.find((c) => c.args[2] === '301');
  assert.ok(missingRow.args.includes(1), 'no longer in Accurate = a new version marked missing, not a delete');
  assert.equal(touchesAppData(calls), false, 'the app\'s existing data is never touched');
  assert.equal(changesMirror(calls), false, 'earlier versions are never changed or removed');
});

test('bookkeeping fields never make a new version; content does', () => {
  const base = { number: 'SI1', dpp_amount: 900, data: { so_numbers: ['SO1'], _last_update: 'a' } };
  assert.equal(batches.contentHash('sales_invoice', base), batches.contentHash('sales_invoice', { ...base, data: { ...base.data, _last_update: 'b' } }));
  assert.notEqual(batches.contentHash('sales_invoice', base), batches.contentHash('sales_invoice', { ...base, dpp_amount: 901 }));
  assert.notEqual(batches.contentHash('sales_invoice', base), batches.contentHash('sales_invoice', { ...base, missing: true }));  // Key order at any depth is not content; values and list order are.
  const lines = { number: 'SI1', data: { lines: [{ item_no: 'A', qty: 2, amount: 5 }, { item_no: 'B', qty: 1, amount: 3 }] } };
  const reordered = { data: { lines: [{ amount: 5, qty: 2, item_no: 'A' }, { qty: 1, amount: 3, item_no: 'B' }] }, number: 'SI1' };
  assert.equal(batches.contentHash('sales_invoice', lines), batches.contentHash('sales_invoice', reordered));
  assert.notEqual(batches.contentHash('sales_invoice', lines), batches.contentHash('sales_invoice', {
    ...lines, data: { lines: [{ item_no: 'A', qty: 3, amount: 5 }, lines.data.lines[1]] },
  }));
  assert.notEqual(batches.contentHash('sales_invoice', lines), batches.contentHash('sales_invoice', {
    ...lines, data: { lines: [...lines.data.lines].reverse() },
  }));
});

// Structural guard (TEGAS): Accurate data only ever goes into the mirror, by
// INSERT, from the approval gate — and no code anywhere changes or removes it.
test('the mirror is insert-only and the app\'s existing data is out of reach of the Accurate integration', () => {
  const root = path.join(__dirname, '../src');
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
  });
  walk(root);
  const gate = path.join(root, 'services/salesAccurateBatches.service.js');
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(root, file);
    assert.doesNotMatch(src, /(UPDATE|DELETE FROM)\s+accurate_records\b/, `${rel} changes the Accurate mirror`);
    if (file !== gate) assert.doesNotMatch(src, /INSERT INTO\s+accurate_records\b/, `${rel} writes the mirror outside the approval gate`);
    if (/accurateReadOnly|salesAccurateBatches|accurate_records/.test(src) && (rel.includes('accurate') || file === gate)) {
      assert.doesNotMatch(src, /(INSERT INTO|UPDATE|DELETE FROM)\s+sales_(customers|orders|order_lines|products|owner_links|leads)\b/, `${rel} touches the app's existing Sales data`);
    }
  }
});

test('an Accurate customer number tells its channel and division, like the app\'s own codes', () => {
  const { channelFromCustomerCode } = require('../src/services/salesNumbers');
  const { divisionForAccurateChannel } = require('../src/services/salesStatus');
  assert.equal(channelFromCustomerCode('PFN-IN-SHP-TGR-0337'), 'Shopee');
  assert.equal(channelFromCustomerCode('PFN-IN-TPD-JKT-0371'), 'TokoPedia');
  assert.equal(channelFromCustomerCode('PFN-IN-GM-JKT-0374'), 'GRAB');
  assert.equal(channelFromCustomerCode('PFN-PR-HRC-JKT-0355'), 'FoodService');
  assert.equal(channelFromCustomerCode('CS-1'), null);
  assert.equal(divisionForAccurateChannel('Shopee'), 'retail_commerce');
  assert.equal(divisionForAccurateChannel('TokoPedia'), 'retail_commerce');
  assert.equal(divisionForAccurateChannel('GRAB'), 'sales', 'QuickCommerce stays with Sales, as in the app');
  assert.equal(divisionForAccurateChannel(null), 'sales');
});

test('a division with no Supervisor or Head gets the Head of Sales as stand-in decider', async () => {
  const calls = [];
  const noOne = fakeConnection([
    [/SELECT COUNT\(DISTINCT u\.id\) AS n/, [[{ n: 0 }]]],
    [/FROM roles WHERE entity_id = \? AND role_key = \?/, (sql, args) => [[args[1] === 'sales.head' ? { id: 23 } : undefined].filter(Boolean)]],
  ], calls);
  assert.equal(await batches.ensureDecider(noOne, { approvalRequestId: 902, entityId: 1, departmentId: 8, divisionCode: 'retail_commerce' }), true);
  const update = calls.find((c) => /UPDATE approval_steps SET/.test(c.sql));
  assert.deepEqual(update.args, [23, 902]);
  const roleAsked = calls.find((c) => /FROM roles WHERE entity_id = \? AND role_key = \?/.test(c.sql)).args[1];
  assert.equal(roleAsked, 'sales.head', 'Retail Commerce: the Head of Sales (owner decision)');
  calls.length = 0;
  await batches.ensureDecider(noOne, { approvalRequestId: 904, entityId: 1, departmentId: 11, divisionCode: 'marketing' });
  assert.equal(calls.find((c) => /FROM roles WHERE/.test(c.sql)).args[1], 'management_office.head', 'any other division without deciders: Management Office Head');

  const staffed = fakeConnection([[/SELECT COUNT\(DISTINCT u\.id\) AS n/, [[{ n: 1 }]]]], []);
  assert.equal(await batches.ensureDecider(staffed, { approvalRequestId: 903, entityId: 1, departmentId: 8 }), false, 'the division decides for itself when it can');
});

test('the owner\'s account may decide any Accurate batch when configured; the division still can', async (t) => {
  const calls = [];
  const db = fakeConnection([[/FROM users WHERE LOWER\(email\) = \?/, [[{ id: 2 }]]]], calls);
  delete process.env.ACCURATE_OWNER_DECIDER_EMAIL;
  assert.equal(await batches.ensureOwnerDecider(db, { approvalRequestId: 905, entityId: 1 }), false, 'not configured: divisions only');
  process.env.ACCURATE_OWNER_DECIDER_EMAIL = 'MWahyudi@prakasagroup.com';
  t.after(() => { delete process.env.ACCURATE_OWNER_DECIDER_EMAIL; });
  assert.equal(await batches.ensureOwnerDecider(db, { approvalRequestId: 905, entityId: 1 }), true);
  const lookup = calls.find((c) => /FROM users WHERE LOWER\(email\)/.test(c.sql));
  assert.equal(lookup.args[0], 'mwahyudi@prakasagroup.com');
  const update = calls.find((c) => /UPDATE approval_steps SET/.test(c.sql));
  assert.match(update.sql, /escalated_to_user_id = \?/);
  assert.doesNotMatch(update.sql, /escalated_to_role_id/, 'the division\'s own deciders keep their access');
  assert.deepEqual(update.args, [2, 905]);
});
