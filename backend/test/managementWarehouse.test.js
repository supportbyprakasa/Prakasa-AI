const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { validateProvider } = require('../src/management/contract');
const warehouse = require('../src/management/providers/warehouse');
const reconModel = require('../src/services/warehouseReconModel');

const PERIOD = { start: '2026-09-01', end: '2026-09-30' };
const source = (key) => warehouse.escalations.find((s) => s.key === key);
// The reconciliation groups are shared for a few seconds between the sources
// and the KPI: every test starts without them.
test.beforeEach(() => warehouse.resetReconMemo());

// Rows the fake database hands back, keyed by the table the query reads.
const draftRow = {
  id: 41, reference_no: 'IN-0041', party: 'PT Sumber Makmur', department_id: 9,
  department_name: 'Warehouse', owner_name: 'Budi', since: '2026-09-20', days_late: 9,
};
const incidentRow = {
  id: 5, category: 'Barang rusak', severity: 'critical', status: 'investigating',
  department_id: 9, department_name: 'Warehouse', owner_name: 'Andi', since: '2026-09-25T02:00:00Z', days_late: 4,
};
const checklistRow = {
  id: 3, title: 'Checklist harian gudang A', checklist_date: '2026-09-26',
  department_id: 9, department_name: 'Warehouse', owner_name: null, days_late: 3,
};

const soLateRow = {
  id: 4398, number: 'SO.3/QGB', customer_name: 'GrabMart', percent_shipped: '50.0000', promised_date: '2026-09-22', promised_in_so: 0,
  department_id: 9, department_name: 'Warehouse', days_late: 8, due_day: 9761,
};

// Reconciliation groups (views of 094/104), numbers in the shapes MySQL returns
// (strings), as the one shared statement hands them back (with the documents count).
const reconRow = {
  docs: '945', direction: 'inbound', group_key: 'SJ001', status: 'app_only', first_movement_id: 41, first_doc_id: null, reference_no: 'SJ-001',
  party: 'PT Sumber Makmur', movement_count: '1', doc_count: '0', doc_numbers: null, diff_items: '0', missing_item_lines: '0',
  pending_movements: '0', department_id: 9, department_name: 'Warehouse', since: '2026-09-25', days_late: '3', ep_day: '9764',
};

function fakeQuery(calls) {
  return async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM wh_recon_groups g/.test(sql)) {
      if (/AS pct/.test(sql)) return [[{ department_id: 9, pct: '77.7778' }, { department_id: 5, pct: null }]];
      return [[reconRow]];
    }
    if (/FROM \(/.test(sql) && /GROUP BY type/.test(sql)) return [[{ type: 'inbound', total: 2 }, { type: 'outbound', total: 1 }]];
    if (/FROM \(/.test(sql) && /GROUP BY department_id/.test(sql)) return [[{ department_id: 9, total: 12 }, { department_id: null, total: 4 }]];
    if (/FROM \(/.test(sql)) return [[{ total: 6, drafts: 2 }]];
    if (/FROM warehouse_(inbound|outbound) m/.test(sql)) return [[draftRow]];
    if (/FROM warehouse_incidents i/.test(sql) && /open_total/.test(sql)) return [[{ open_total: 3, urgent: 0 }]];
    if (/FROM warehouse_incidents i/.test(sql)) return [[incidentRow]];
    if (/FROM warehouse_checklists c/.test(sql)) return [[checklistRow]];
    if (/FROM wh_so_fulfilment_accurate x/.test(sql)) {
      if (/COUNT\(\*\) AS total/.test(sql)) return [[{ total: 14, due: '9', otif: '8', late: '1' }]];
      if (/GROUP BY x\.department_id/.test(sql)) return [[{ department_id: 9, due: 8, otif: '7', n: 14, days: '0.6429' }]];
      return [[soLateRow]];
    }
    return [[]];
  };
}

// Runs every capability of the provider once.
async function runEverything(departmentId) {
  for (const s of warehouse.escalations) await s.list(1, { departmentId });
  for (const m of warehouse.metrics) await m.actuals(1, PERIOD, { departmentId });
  for (const k of warehouse.kpis) await k.value(1, { departmentId });
}

test('the warehouse provider satisfies the contract and claims its sidebar route', () => {
  const p = validateProvider(warehouse);
  assert.deepEqual(p.navPaths, ['/warehouse', '/warehouse/movements', '/warehouse/stock', '/warehouse/shipping', '/warehouse/operations']);
  assert.ok(p.escalations.length && p.metrics.length && p.kpis.length);
  for (const item of [...p.escalations, ...p.metrics, ...p.kpis]) {
    assert.match(item.key, /^warehouse_/, `${item.key} is prefixed so it never clashes with another module`);
  }
});

test('no warehouse escalation duplicates the approvals queue', () => {
  // A movement waiting on a decision is approvals' `approval_aged`; Warehouse must not report it again.
  for (const s of warehouse.escalations) assert.doesNotMatch(s.key, /approval|pending|waiting/);
});

test('draft escalations map rows to the queue shape with a link to the movement', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const [inbound] = await source('warehouse_inbound_draft').list(1, { departmentId: null });
  assert.deepEqual(inbound, {
    sourceId: 41,
    title: 'Barang Masuk IN-0041',
    reference: 'IN-0041',
    context: 'Draft belum diajukan · PT Sumber Makmur',
    departmentId: 9,
    departmentName: 'Warehouse',
    ownerName: 'Budi',
    severity: 'medium',
    daysLate: 9,
    since: new Date('2026-09-20').toISOString(),
    link: '/warehouse/movements/inbound/41',
  });
  const [outbound] = await source('warehouse_outbound_draft').list(1, { departmentId: null });
  assert.equal(outbound.title, 'Barang Keluar IN-0041');
  assert.equal(outbound.link, '/warehouse/movements/outbound/41');
});

test('draft escalations only pick never-submitted drafts past the grace period', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await source('warehouse_inbound_draft').list(1, { departmentId: null });
  const { sql } = calls[0];
  assert.match(sql, /m\.status = 'draft'/);
  assert.match(sql, /m\.approval_request_id IS NULL/, 'a draft reopened from a revision is still approvals\' item');
  assert.match(sql, new RegExp(`INTERVAL ${warehouse.DRAFT_GRACE_DAYS} DAY`));
});

test('incident and checklist escalations map rows and apply severity', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));

  const [incident] = await source('warehouse_incident_open').list(1, { departmentId: null });
  assert.equal(incident.title, 'Barang rusak');
  assert.equal(incident.context, 'Diselidiki · tingkat kritis');
  assert.equal(incident.severity, 'medium');
  assert.equal(incident.daysLate, 4);
  assert.equal(incident.since, '2026-09-25T02:00:00.000Z');
  assert.equal(incident.link, '/warehouse/operations?tab=incidents');

  const [checklist] = await source('warehouse_checklist_missed').list(1, { departmentId: null });
  assert.equal(checklist.title, 'Checklist harian gudang A');
  assert.equal(checklist.context, 'Belum diselesaikan');
  assert.equal(checklist.ownerName, null);
  assert.equal(checklist.severity, 'medium');
  assert.equal(checklist.link, '/warehouse/operations?tab=checklist');
});

test('a division Head is filtered in SQL on every query of every capability', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await runEverything(9);
  // The three reconciliation sources and their KPI share one statement.
  assert.equal(calls.length, warehouse.escalations.length + warehouse.metrics.length + warehouse.kpis.length - 3);
  for (const { sql, args } of calls) {
    const filters = sql.match(/\.department_id = \?/g) || [];
    const entities = sql.match(/entity_id = \?/g) || [];
    assert.ok(filters.length >= 1, `division filter missing from: ${sql}`);
    assert.equal(filters.length, entities.length, `every table in the query is filtered by division: ${sql}`);
    // Entity first, then the caller's division — for each table in the query.
    assert.equal(args[0], 1);
    assert.equal(args[1], 9);
    assert.equal(args.filter((a) => a === 9).length, filters.length);
  }
});

test('an entity-wide caller gets no division filter, but always the entity filter', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await runEverything(null);
  for (const { sql, args } of calls) {
    assert.doesNotMatch(sql, /department_id = \?/);
    assert.match(sql, /entity_id = \?/);
    assert.equal(args[0], 1);
  }
});

test('locate returns the record\'s entity and division, or null when it is gone', async (t) => {
  for (const s of warehouse.escalations) {
    const calls = [];
    t.mock.method(pool, 'query', async (sql, args) => {
      calls.push({ sql, args });
      return [[{ entity_id: 1, department_id: 9 }]];
    });
    // The stock escalation's id is the gudang plus the day its episode began;
    // a reconciliation id carries the direction in its lowest bit, and a
    // movement group's id the day of its episode too.
    const id = s.key === 'warehouse_stock_negative' ? warehouse.episodeId(41, 9764)
      : s.key === 'warehouse_so_late' ? warehouse.soEpisodeId(41, 9764)
        : s.key === 'warehouse_recon_not_in_app' ? reconModel.docSourceId(41, 'inbound')
          : s.key.startsWith('warehouse_recon_') ? reconModel.episodeSourceId(41, 'inbound', 9764) : 41;
    assert.deepEqual(await s.locate(id), { entityId: 1, departmentId: 9 }, s.key);
    assert.deepEqual(calls[0].args, [41], s.key);
    pool.query.mock.restore();

    t.mock.method(pool, 'query', async () => [[]]);
    assert.equal(await s.locate(404), null, s.key);
    pool.query.mock.restore();
  }
});

test('locate reads the table the source lists from', async (t) => {
  const tables = {
    warehouse_inbound_draft: 'warehouse_inbound',
    warehouse_outbound_draft: 'warehouse_outbound',
    warehouse_incident_open: 'warehouse_incidents',
    warehouse_checklist_missed: 'warehouse_checklists',
    warehouse_stock_negative: 'wh_warehouses_accurate',
    warehouse_transfer_stuck: 'wh_documents_accurate',
    warehouse_so_late: 'wh_so_fulfilment_accurate',
    // Even source id = Barang Masuk / penerimaan; odd = Barang Keluar / surat jalan.
    warehouse_recon_not_in_accurate: 'warehouse_inbound',
    warehouse_recon_qty_diff: 'warehouse_inbound',
    warehouse_recon_not_in_app: 'wh_documents_accurate',
  };
  assert.deepEqual(warehouse.escalations.map((s) => s.key).sort(), Object.keys(tables).sort());
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[{ entity_id: 1, department_id: null }]]; });
  for (const s of warehouse.escalations) {
    const id = s.key === 'warehouse_recon_not_in_app' ? reconModel.docSourceId(1, 'inbound')
      : s.key.startsWith('warehouse_recon_') ? reconModel.episodeSourceId(1, 'inbound', 9764) : 1;
    assert.deepEqual(await s.locate(id), { entityId: 1, departmentId: null });
    assert.match(calls.at(-1).sql, new RegExp(`FROM ${tables[s.key]} WHERE id = \\?`), s.key);
  }
  // The odd twin reads the other table (or document type).
  await source('warehouse_recon_qty_diff').locate(reconModel.episodeSourceId(7, 'outbound', 9764));
  assert.match(calls.at(-1).sql, /FROM warehouse_outbound WHERE id = \?/);
  assert.deepEqual(calls.at(-1).args, [7]);
  await source('warehouse_recon_not_in_app').locate(reconModel.docSourceId(7, 'outbound'));
  assert.match(calls.at(-1).sql, /FROM wh_documents_accurate WHERE id = \? AND doc_type = 'delivery'/);
  await source('warehouse_recon_not_in_app').locate(reconModel.docSourceId(7, 'inbound'), { entityId: 2 });
  assert.match(calls.at(-1).sql, /doc_type = 'receipt' AND entity_id = \?/);
  assert.deepEqual(calls.at(-1).args, [7, 2], 'an Accurate id is bound to the company');
});

test('metrics return a Map keyed by division', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const metric = (key) => warehouse.metrics.find((m) => m.key === key);

  const approved = await metric('warehouse_movements_approved').actuals(1, PERIOD, { departmentId: null });
  assert.ok(approved instanceof Map);
  assert.deepEqual([...approved], [[9, 12]], 'rows without a division are not attributed to one');

});

test('the approved-movements metric counts both tables in the period', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await warehouse.metrics.find((m) => m.key === 'warehouse_movements_approved').actuals(1, PERIOD, { departmentId: null });
  const { sql, args } = calls[0];
  assert.match(sql, /FROM warehouse_inbound m/);
  assert.match(sql, /FROM warehouse_outbound m/);
  assert.match(sql, /m\.status = 'approved'/);
  assert.deepEqual(args, [1, '2026-09-01', '2026-09-30 23:59:59', 1, '2026-09-01', '2026-09-30 23:59:59']);
});

test('KPIs return { value, sub, alert }', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const kpi = (key) => warehouse.kpis.find((k) => k.key === key).value(1, { departmentId: null });

  assert.deepEqual(await kpi('warehouse_pending_approval'), { value: 3, sub: '2 masuk · 1 keluar', alert: false });
  assert.deepEqual(await kpi('warehouse_movements_week'), { value: 6, sub: '2 masih draft', alert: false });
  assert.deepEqual(await kpi('warehouse_open_incidents'), { value: 3, sub: '0 tingkat tinggi/kritis', alert: false });
});

test('KPIs read an empty warehouse as zero rather than failing', async (t) => {
  t.mock.method(pool, 'query', async () => [[]]);
  for (const k of warehouse.kpis) {
    const result = await k.value(1, { departmentId: 9 });
    // A rate with nothing to measure reads "—" (null), never a false 0%.
    assert.ok(result.value === 0 || (k.unit === '%' && result.value === null), k.key);
    assert.equal(typeof result.sub, 'string');
    assert.equal(result.alert, false);
  }
});

test('stock minus reaches management per gudang, and stock KPIs wait for the first approved pull', async (t) => {
  const source = warehouse.escalations.find((s) => s.key === 'warehouse_stock_negative');
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM wh_stock_negative_accurate n/.test(sql)) {
      return [[{ warehouse_id: 3, warehouse_name: 'Gudang Utama', department_id: 9, department_name: 'Warehouse', positions: 157, since: '2026-09-25', since_day: 9764, days_late: 2 }]];
    }
    if (/AS warehouses/.test(sql)) return [[{ positions: 0, warehouses: 0, items: 0 }]];
    if (/TIMESTAMPDIFF\(HOUR/.test(sql)) return [[{ hours: null }]];
    return [[]];
  });
  const [item] = await source.list(1, { departmentId: 9 });
  assert.equal(item.sourceId, 3 * 1000000 + 9764, 'the gudang plus the day its episode began');
  assert.equal(warehouse.warehouseOfEpisode(item.sourceId), 3);
  assert.equal(item.link, '/warehouse/stock?status=minus&warehouseId=3', 'opens that gudang\'s minus items');
  assert.match(item.context, /157 barang stoknya minus/);
  assert.match(calls[0].sql, new RegExp(`- ${warehouse.NEGATIVE_STOCK_DAYS} AS days_late`));
  const kpi = (key) => warehouse.kpis.find((k) => k.key === key);
  assert.deepEqual(await kpi('warehouse_stock_minus').value(1, { departmentId: 9 }), { value: 0, sub: 'Belum ada data stok dari Accurate', alert: false });
  assert.deepEqual(await kpi('warehouse_stock_age').value(1, { departmentId: 9 }), { value: 0, sub: 'Belum ada data stok dari Accurate', alert: false });
  t.mock.restoreAll();
  let ages = { hours: 72, waiting_hours: null };
  t.mock.method(pool, 'query', async () => [[ages]]);
  assert.deepEqual(await kpi('warehouse_stock_age').value(1, { departmentId: 9 }), { value: 3, sub: 'disetujui 3 hari lalu', alert: false }, 'old but nothing waiting: no alarm');
  ages = { hours: 72, waiting_hours: 50 };
  assert.equal((await kpi('warehouse_stock_age').value(1, { departmentId: 9 })).alert, true, 'an update waiting too long');
});

test('OTIF counts SOs by promise in the period up to yesterday, judged, from OTIF_FROM; a rate only from 5 due SOs', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    return [[{ department_id: 9, due: 8, otif: '7' }, { department_id: 5, due: 4, otif: '4' }, { department_id: null, due: 9, otif: '9' }]];
  });
  const otif = warehouse.metrics.find((m) => m.key === 'warehouse_so_otif');
  assert.deepEqual([...(await otif.actuals(1, PERIOD, { departmentId: null })).entries()], [[9, 87.5]]);
  assert.match(calls[0].sql, /x\.promised_date BETWEEN \? AND LEAST\(\?, DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\) - INTERVAL 1 DAY\)/);
  assert.match(calls[0].sql, /x\.in_otif AND x\.judged/);
  assert.deepEqual(calls[0].args, [1, '2026-09-22', '2026-09-01', '2026-09-30']);
  await otif.actuals(1, PERIOD, { departmentId: 9 });
  assert.deepEqual(calls[1].args, [1, 9, '2026-09-22', '2026-09-01', '2026-09-30']);
});

test('ship days: average SO to complete shipment, shipped in full in the period, from 5 SOs', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[{ department_id: 9, n: 14, days: '0.6429' }, { department_id: 5, n: 3, days: '2' }]]; });
  const days = warehouse.metrics.find((m) => m.key === 'warehouse_ship_days');
  assert.deepEqual([...(await days.actuals(1, PERIOD, { departmentId: null })).entries()], [[9, 0.6]]);
  assert.match(calls[0].sql, /x\.so_state = 'shipped' AND x\.shipped_on BETWEEN \? AND \?/);
  assert.match(calls[0].sql, /GREATEST\(DATEDIFF\(x\.shipped_on, x\.trans_date\), 0\)/);
  assert.deepEqual(calls[0].args, [1, '2026-09-22', '2026-09-01', '2026-09-30']);
});

test('a late SO escalates to Warehouse with an episode per promise and says where the promise comes from', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const [item] = await source('warehouse_so_late').list(1, { departmentId: null });
  assert.equal(item.sourceId, 4398 * 100000 + 9761);
  assert.equal(item.context, '50% terkirim · janji kirim 2026-09-22 (standar 2×24 jam dari tanggal SO)');
  assert.equal(item.link, '/warehouse/shipping?status=late&q=SO.3%2FQGB');
  assert.match(calls[0].sql, /x\.so_state IN \('open', 'partial'\) AND x\.judged AND x\.promised_date < DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\)/);
  assert.deepEqual(calls[0].args, [1]);
  assert.ok(calls[0].sql.includes(`x.trans_date >= '2026-09-22'`), 'OTIF_FROM, inside the shared late-SO rule');
  assert.match(calls[0].sql, /NOT \(x\.channel IN \('Shopee', 'TokoPedia'\) AND x\.number LIKE '%\/ECOM-%'\)/, 'no marketplace recap');
  pool.query.mock.mockImplementation(async () => [[{ ...soLateRow, promised_in_so: 1 }]]);
  const [own] = await source('warehouse_so_late').list(1, { departmentId: null });
  assert.match(own.context, /\(Tgl kirim SO\)$/);
  // A Friday SO: the standard promise fell on Sunday and moved to Monday.
  const rules = require('../src/services/warehouseRules');
  assert.ok(calls[0].sql.includes(`${rules.promiseShiftedSql('x')} AS promise_shifted`), 'the same rule as Jadwal kirim');
  pool.query.mock.mockImplementation(async () => [[{ ...soLateRow, promised_date: '2026-09-28', promise_shifted: 1 }]]);
  const [monday] = await source('warehouse_so_late').list(1, { departmentId: null });
  assert.equal(monday.context, '50% terkirim · janji kirim 2026-09-28 (standar 2×24 jam dari tanggal SO, digeser ke Senin)');
});

test('OTIF KPI: the last 30 days with its denominator; no rate rather than 0% when nothing is due', async (t) => {
  const kpi = warehouse.kpis.find((k) => k.key === 'warehouse_so_otif_month');
  const calls = [];
  t.mock.method(pool, 'query', async (sql) => { calls.push(sql); return [[{ total: 14, due: '9', otif: '8', late: '1' }]]; });
  assert.deepEqual(await kpi.value(1, { departmentId: null }), { value: 88.9, sub: '8 dari 9 SO · 1 lewat janji belum terkirim', alert: true });
  assert.match(calls[0], /x\.promised_date BETWEEN DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\) - INTERVAL 30 DAY AND/);
  pool.query.mock.mockImplementation(async () => [[{ total: 3, due: '0', otif: '0', late: '0' }]]);
  assert.deepEqual(await kpi.value(1, { departmentId: null }), { value: null, sub: 'Belum ada SO jatuh tempo 30 hari terakhir · 0 lewat janji belum terkirim', alert: false });
  pool.query.mock.mockImplementation(async () => [[{ total: 0 }]]);
  assert.match((await kpi.value(1, { departmentId: null })).sub, /^Belum ada SO dari Accurate sejak 2026-09-22$/);
});

test('while Sales transactions are recorded in the app, Accurate SOs raise no OTIF and no alarm', async (t) => {
  const before = process.env.SALES_TRANSACTION_SOURCE;
  t.after(() => { if (before === undefined) delete process.env.SALES_TRANSACTION_SOURCE; else process.env.SALES_TRANSACTION_SOURCE = before; });
  process.env.SALES_TRANSACTION_SOURCE = 'app';
  const calls = [];
  t.mock.method(pool, 'query', async (sql) => { calls.push(sql); return [[soLateRow]]; });
  assert.deepEqual(await source('warehouse_so_late').list(1, { departmentId: null }), []);
  assert.equal((await warehouse.metrics.find((m) => m.key === 'warehouse_so_otif').actuals(1, PERIOD, { departmentId: null })).size, 0);
  assert.equal((await warehouse.kpis.find((k) => k.key === 'warehouse_so_otif_month').value(1, { departmentId: null })).alert, false);
  assert.equal(calls.filter((q) => /wh_so_fulfilment_accurate/.test(q)).length, 0);
});

test('WAREHOUSE_OTIF_FROM moves the start; a bad value falls back to 22 September', (t) => {
  const rules = require('../src/services/warehouseRules');
  const before = process.env.WAREHOUSE_OTIF_FROM;
  t.after(() => { if (before === undefined) delete process.env.WAREHOUSE_OTIF_FROM; else process.env.WAREHOUSE_OTIF_FROM = before; });
  process.env.WAREHOUSE_OTIF_FROM = '2026-10-01';
  assert.equal(rules.otifFrom(), '2026-10-01');
  process.env.WAREHOUSE_OTIF_FROM = 'kemarin';
  assert.equal(rules.otifFrom(), '2026-09-22');
});

// ---------------------------------------------------------------------------
// Pencocokan gudang ↔ Accurate (program 3.2)
// ---------------------------------------------------------------------------

// One group of each kind, as the shared statement returns them.
const reconGroups = [
  reconRow,
  { ...reconRow, group_key: 'SJ002', status: 'qty_diff', first_movement_id: 43, diff_items: '2', doc_count: '7', doc_numbers: 'RI.1, RI.2, RI.3, RI.4, RI.5', since: '2026-09-24', ep_day: '9763' },
  { ...reconRow, group_key: 'SJ003', status: 'uncomparable', first_movement_id: 45, missing_item_lines: '3', doc_count: '1', doc_numbers: 'RI.9' },
  { ...reconRow, group_key: 'SJ004', status: 'uncomparable', first_movement_id: 47, missing_item_lines: '0', doc_count: '1', doc_numbers: 'RI.8' },
  {
    ...reconRow, direction: 'outbound', group_key: 'delivery-202', status: 'acc_only', first_movement_id: null, first_doc_id: '202',
    reference_no: null, party: 'Big House Cafe', movement_count: '0', doc_count: '1', doc_numbers: 'DO.2026.09.00068',
  },
  { ...reconRow, direction: 'outbound', group_key: 'delivery-203', status: 'acc_only', first_movement_id: null, first_doc_id: '203', pending_movements: '1' },
];

test('reconciliation escalations and KPI: one statement for all four — documents, grace, explanations and a complete mirror', async (t) => {
  const keys = ['warehouse_recon_not_in_accurate', 'warehouse_recon_qty_diff', 'warehouse_recon_not_in_app'];
  for (const key of keys) {
    assert.ok(source(key), key);
    assert.ok(key.length <= 32, `${key} fits VARCHAR(32)`);
  }
  for (const s of warehouse.escalations) assert.ok(s.key.length <= 32, s.key);
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [reconGroups]; });
  const [notInAccurate, qtyDiff, notInApp] = await Promise.all(keys.map((key) => source(key).list(1, { departmentId: null })));
  const kpi = await warehouse.kpis.find((k) => k.key === 'warehouse_recon_open').value(1, { departmentId: null });
  assert.equal(calls.length, 1, 'the view is evaluated once for the three sources and the KPI');
  const [{ sql, args }] = calls;
  assert.match(sql, /FROM wh_recon_groups g/);
  assert.match(sql, /g\.docs_ready = 1/, 'no alarm before Warehouse documents exist in the mirror');
  assert.match(sql, /g\.explained = 0/);
  assert.match(sql, /g\.judged = 1/, 'no alarm while the matching document may sit in a Warehouse batch waiting for approval');
  assert.match(sql, /g\.status <> 'matched'/);
  assert.match(sql, new RegExp(`g\\.since <= DATE\\(UTC_TIMESTAMP\\(\\) \\+ INTERVAL 7 HOUR\\) - INTERVAL ${warehouse.RECON_GRACE_DAYS} DAY`));
  assert.match(sql, new RegExp(`- ${warehouse.RECON_GRACE_DAYS} AS days_late`));
  assert.match(sql, /DATEDIFF\(g\.since, '2000-01-01'\) AS ep_day/);
  assert.match(sql, /COUNT\(\*\) AS docs FROM wh_documents_accurate x WHERE x\.entity_id = \?/);
  assert.doesNotMatch(sql, /LIMIT/, 'every open group, cut per source afterwards');
  assert.deepEqual(args, [1, 1]);
  // Each source takes its own groups from the shared rows.
  assert.deepEqual(notInAccurate.map((i) => i.reference), ['SJ-001']);
  assert.deepEqual(qtyDiff.map((i) => i.title), ['Barang Masuk SJ-001', 'Barang Masuk SJ-001'], 'a line without item code is a Warehouse gap too');
  assert.deepEqual(qtyDiff.map((i) => i.since.slice(0, 10)), ['2026-09-24', '2026-09-25'], 'oldest first');
  assert.deepEqual(notInApp.map((i) => i.reference), ['DO.2026.09.00068'], 'a document a draft/pending movement references is not escalated');
  assert.deepEqual(kpi, {
    value: 4, sub: '1 belum di Accurate · 1 selisih · 1 tanpa kode barang · 1 belum di aplikasi · 1 satuan belum dikenal', alert: true,
  });
});

test('the shared groups are read once per company and division for a few seconds; a failed read is not kept', async (t) => {
  const calls = [];
  let fail = true;
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (fail) throw new Error('koneksi putus');
    return [[reconRow]];
  });
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-30T03:00:00Z') });
  const notInAccurate = source('warehouse_recon_not_in_accurate');
  await assert.rejects(() => notInAccurate.list(1, { departmentId: null }), /koneksi putus/);
  fail = false;
  assert.equal((await notInAccurate.list(1, { departmentId: null })).length, 1, 'asked again after a failure');
  await source('warehouse_recon_qty_diff').list(1, { departmentId: null });
  await warehouse.kpis.find((k) => k.key === 'warehouse_recon_open').value(1, { departmentId: null });
  assert.equal(calls.length, 2);
  await notInAccurate.list(1, { departmentId: 9 });
  assert.equal(calls.length, 3, 'a division has its own');
  assert.deepEqual(calls[2].args, [1, 9, 1, 9], 'entity first, then the division, for each table');
  t.mock.timers.tick(warehouse.RECON_MEMO_MS + 1);
  await notInAccurate.list(1, { departmentId: null });
  assert.equal(calls.length, 4, 'read again once the moment has passed');
});

test('a movement not in Accurate links to its group, with a direction- and episode-coded source id', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const [item] = await source('warehouse_recon_not_in_accurate').list(1, { departmentId: null });
  assert.equal(item.sourceId, 82 * reconModel.EPISODE_FACTOR + 9764, 'inbound 41 → 41×2, then the day of its since');
  assert.deepEqual(reconModel.decodeEpisodeSourceId(item.sourceId), { direction: 'inbound', movementId: 41 });
  assert.equal(item.title, 'Barang Masuk SJ-001');
  assert.equal(item.link, '/warehouse/stock?tab=recon&direction=inbound&group=SJ001');
  assert.equal(item.context, 'disetujui di aplikasi, belum ada dokumen Accurate yang cocok · PT Sumber Makmur');
  assert.equal(item.daysLate, 3);
  warehouse.resetReconMemo();
  pool.query.mock.mockImplementation(async () => [[{ ...reconRow, direction: 'outbound', movement_count: '3', reference_no: null }]]);
  const [out] = await source('warehouse_recon_not_in_accurate').list(1, { departmentId: null });
  assert.equal(out.sourceId, 83 * reconModel.EPISODE_FACTOR + 9764, 'outbound 41 → 41×2+1');
  assert.equal(out.title, 'Barang Keluar #41');
  assert.match(out.context, /^3 pergerakan · /);
});

test('a new difference in a group whose follow-up was closed is a new episode', async (t) => {
  t.mock.method(pool, 'query', async () => [[{ ...reconRow, status: 'qty_diff', diff_items: '1', doc_count: '1', doc_numbers: 'RI.1', since: '2026-09-23', ep_day: '9762' }]]);
  const [first] = await source('warehouse_recon_qty_diff').list(1, { departmentId: null });
  // A second shipment of the same PO joins the group three days later: `since` moves, and so does the id.
  warehouse.resetReconMemo();
  pool.query.mock.mockImplementation(async () => [[{ ...reconRow, status: 'qty_diff', diff_items: '1', doc_count: '2', doc_numbers: 'RI.1, RI.2', since: '2026-09-26', ep_day: '9765' }]]);
  const [second] = await source('warehouse_recon_qty_diff').list(1, { departmentId: null });
  assert.notEqual(second.sourceId, first.sourceId);
  assert.deepEqual(reconModel.decodeEpisodeSourceId(second.sourceId), reconModel.decodeEpisodeSourceId(first.sourceId), 'the same group');
  assert.ok(Number.isSafeInteger(reconModel.episodeSourceId(2 ** 31, 'outbound', 99999)), 'fits escalation_followups.source_id (BIGINT) and a JS number');
});

test('a quantity difference, or a line without item code, names the Accurate documents (capped list +n lainnya)', async (t) => {
  t.mock.method(pool, 'query', async () => [[{
    ...reconRow, status: 'qty_diff', diff_items: '2', doc_count: '7', doc_numbers: 'RI.1, RI.2, RI.3, RI.4, RI.5',
  }]]);
  const [diff] = await source('warehouse_recon_qty_diff').list(1, { departmentId: null });
  assert.equal(diff.context, '2 barang beda jumlah dengan RI.1, RI.2, RI.3, RI.4, RI.5 +2 lainnya (satuan dasar)');
  assert.equal(diff.reference, 'RI.1');
  assert.equal(diff.sourceId, 82 * reconModel.EPISODE_FACTOR + 9764);
  warehouse.resetReconMemo();
  pool.query.mock.mockImplementation(async () => [[{ ...reconRow, status: 'uncomparable', missing_item_lines: '3', doc_count: '1', doc_numbers: 'RI.9' }]]);
  const [noCode] = await source('warehouse_recon_qty_diff').list(1, { departmentId: null });
  assert.equal(noCode.context, '3 baris tanpa kode barang — belum bisa dicocokkan dengan RI.9');
});

test('an Accurate document not recorded by the Warehouse escalates per document and locates within the company', async (t) => {
  t.mock.method(pool, 'query', async () => [[reconGroups[4]]]);
  const [item] = await source('warehouse_recon_not_in_app').list(1, { departmentId: null });
  assert.equal(item.sourceId, 405, 'delivery 202 → 202×2+1');
  assert.deepEqual(reconModel.decodeDocSourceId(item.sourceId), { docType: 'delivery', docId: 202 });
  assert.equal(item.title, 'Surat jalan DO.2026.09.00068');
  assert.equal(item.context, 'Big House Cafe · belum dicatat sebagai Barang Keluar di aplikasi');
  assert.equal(item.link, '/warehouse/stock?tab=recon&direction=outbound&group=delivery-202');
});

test('reconciliation KPI adds MySQL string counts as numbers and waits for Accurate documents', async (t) => {
  t.mock.method(pool, 'query', async () => [[
    { ...reconRow, docs: '3' }, { ...reconRow, docs: '3', group_key: 'SJ003', status: 'uncomparable', missing_item_lines: '4' },
    { ...reconRow, docs: '3', group_key: 'SJ004', status: 'uncomparable', missing_item_lines: '0' },
    { ...reconRow, docs: '3', group_key: 'SJ005', status: 'uncomparable', missing_item_lines: '0' },
  ]]);
  const kpi = warehouse.kpis.find((k) => k.key === 'warehouse_recon_open');
  assert.deepEqual(await kpi.value(1, { departmentId: null }), {
    value: 2, sub: '1 belum di Accurate · 0 selisih · 1 tanpa kode barang · 0 belum di aplikasi · 2 satuan belum dikenal', alert: true,
  });
  warehouse.resetReconMemo();
  // No problem group: the documents count still arrives (one row, the groups' columns empty).
  pool.query.mock.mockImplementation(async () => [[{ docs: '12', group_key: null }]]);
  assert.deepEqual(await kpi.value(1, { departmentId: null }), { value: 0, sub: '0 belum di Accurate · 0 selisih · 0 tanpa kode barang · 0 belum di aplikasi', alert: false });
  warehouse.resetReconMemo();
  pool.query.mock.mockImplementation(async () => [[{ docs: '0', group_key: null }]]);
  assert.deepEqual(await kpi.value(1, { departmentId: null }), { value: 0, sub: 'Menunggu dokumen gudang dari Accurate', alert: false });
});

test('match rate: matched movements of all judged movements past the grace period in the period, per division, strings as numbers', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const metric = warehouse.metrics.find((m) => m.key === 'warehouse_recon_match_rate');
  assert.equal(metric.unit, '%');
  assert.equal(metric.better, 'higher');
  assert.equal(metric.cumulative, false);
  assert.deepEqual([...(await metric.actuals(1, PERIOD, { departmentId: null })).entries()], [[9, 77.8]], 'a division with no rate is left out');
  assert.match(calls[0].sql, /g\.last_date BETWEEN \? AND \?/);
  assert.match(calls[0].sql, /SUM\(IF\(g\.status = 'matched', g\.movement_count, 0\)\)/, 'explained groups count against the rate');
  assert.match(calls[0].sql, /g\.judged = 1/, 'a group the mirror cannot judge yet counts neither way');
  assert.deepEqual(calls[0].args, [1, '2026-09-01', '2026-09-30']);
  await metric.actuals(1, PERIOD, { departmentId: 9 });
  assert.deepEqual(calls[1].args, [1, 9, '2026-09-01', '2026-09-30']);
});
