const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db/pool');
const model = require('../src/services/warehouseReconModel');
const recon = require('../src/services/warehouseRecon.service');
const { permissionsForStandardRole } = require('../src/config/standardOrganization');

// Program 3.2: the app's Barang Masuk/Keluar against approved Accurate
// documents — quantities only, keys that cannot match by accident, pairing and
// explaining only by someone who did not record the movement.

const stripComments = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const m094 = stripComments(fs.readFileSync(path.join(__dirname, '../migrations/094_warehouse_recon_views.sql'), 'utf8'));
const m104 = stripComments(fs.readFileSync(path.join(__dirname, '../migrations/104_warehouse_recon_judged.sql'), 'utf8'));
const oneLine = (sql) => sql.replace(/\s+/g, ' ');
const supervisor = { sub: 50, entityId: 1, permissions: ['warehouse.recon.view', 'warehouse.recon.resolve'] };

test('a reference is a key only with 4+ characters and a digit; placeholders stay their own group', () => {
  assert.equal(model.refKey('DO18/HRC-PFN/IX/2026'), 'DO18HRCPFNIX2026');
  assert.equal(model.refKey('SJ 001'), 'SJ001');
  for (const placeholder of ['N/A', 'n/a', '0', '001', 'manual', 'tidak ada', '', null]) assert.equal(model.refKey(placeholder), null, String(placeholder));
  assert.equal(model.groupKeyForMovement({ id: 7, referenceNo: 'N/A' }), 'm-7');
  assert.equal(model.groupKeyForMovement({ id: 7, referenceNo: 'PO.2026.09.00012' }), 'PO20260900012');
  assert.deepEqual(model.parseDocGroupKey('receipt-106'), { docType: 'receipt', docId: 106 });
  assert.equal(model.parseDocGroupKey('transfer-1'), null);
  assert.ok(model.GROUP_KEY_RE.test('SJ001') && model.GROUP_KEY_RE.test('m-12') && model.GROUP_KEY_RE.test('delivery-5'));
  assert.equal(model.GROUP_KEY_RE.test('NA'), false);
});

test('escalation source ids carry the direction, so inbound/outbound and receipt/delivery ids never collide', () => {
  assert.deepEqual(model.decodeMovementSourceId(model.movementSourceId(41, 'outbound')), { direction: 'outbound', movementId: 41 });
  assert.deepEqual(model.decodeMovementSourceId(model.movementSourceId(41, 'inbound')), { direction: 'inbound', movementId: 41 });
  assert.deepEqual(model.decodeDocSourceId(model.docSourceId(1500000, 'inbound')), { docType: 'receipt', docId: 1500000 });
  assert.deepEqual(model.decodeDocSourceId(model.docSourceId(1500000, 'outbound')), { docType: 'delivery', docId: 1500000 });
  // A movement group's id also carries the day of its `since` (a new episode per change).
  const id = model.episodeSourceId(41, 'outbound', 9765);
  assert.equal(id, 83 * model.EPISODE_FACTOR + 9765);
  assert.deepEqual(model.decodeEpisodeSourceId(id), { direction: 'outbound', movementId: 41 });
  assert.notEqual(model.episodeSourceId(41, 'outbound', 9762), id);
});

test('the window starts 180 days before today (WIB), never before 22 September 2026', () => {
  assert.equal(model.windowFrom(new Date('2026-09-30T03:00:00Z')), model.RECON_FROM);
  assert.equal(model.windowFrom(new Date('2027-03-21T03:00:00Z')), '2026-09-22');
  assert.equal(model.windowFrom(new Date('2027-06-01T03:00:00Z')), '2026-12-03');
  assert.equal(model.wibDay(new Date('2026-09-30T17:30:00Z')), '2026-10-01', 'after 17:00 UTC it is already tomorrow in WIB');
  assert.equal(model.dayText('2026-09-22'), '22 Sep 2026');
});

test('whoever recorded or submitted a movement of the group can neither pair nor explain it', () => {
  assert.match(model.selfResolveReason(50, [{ created_by: 50, submitted_by: 51 }]), /Supervisor atau Head Warehouse lain/);
  assert.match(model.selfResolveReason(51, [{ created_by: 50, submitted_by: 51 }]), /Anda mencatat/);
  assert.equal(model.selfResolveReason(52, [{ created_by: 50, submitted_by: 51 }]), null);
});

test('rows read as numbers, never strings; an item without code is not compared', () => {
  const g = model.groupDto({
    direction: 'inbound', group_key: 'SJ001', status: 'qty_diff', explained: '0', movement_count: '2', movement_ids: '4,9', doc_count: '1',
    doc_numbers: 'RI.1', item_count: '3', diff_items: '1', unknown_lines: '0', missing_item_lines: '0', pending_movements: '0', days_open: '4',
  });
  assert.deepEqual([g.movementCount, g.docCount, g.diffItems, g.daysOpen, g.explained], [2, 1, 1, 4, false]);
  assert.deepEqual(g.movementIds, [4, 9]);
  assert.equal(g.judged, true, 'a row without the column (094) is judged');
  const waiting = model.groupDto({ direction: 'inbound', group_key: 'SJ001', status: 'app_only', judged: '0', data_through: new Date('2026-09-24T00:00:00Z') });
  assert.deepEqual([waiting.judged, waiting.dataThrough], [false, '2026-09-24']);
  assert.match(model.statusFilter('waiting').sql, /g\.judged = 0/);
  assert.match(model.statusFilter('app_only').sql, /g\.status = \? AND g\.explained = 0 AND g\.judged = 1/, 'a problem chip counts judged groups only');
  assert.doesNotMatch(model.statusFilter('open').sql, /judged/, 'Perlu dicek keeps the groups waiting for Accurate data');
  assert.equal(model.itemDto({ item_key: 'ITM-C', app_qty_base: '4.0000', acc_qty_base: '3.0000', unknown_lines: '0' }).state, 'qty_diff');
  assert.equal(model.itemDto({ item_key: 'ITM-C', app_qty_base: '4.0000', acc_qty_base: '4.0004', unknown_lines: '0' }).state, 'matched');
  assert.equal(model.itemDto({ item_key: null, app_qty_base: '4', acc_qty_base: null, unknown_lines: '0' }).state, 'uncomparable');
});

test('the views: typed keys, one composite join, the mirror\'s own key, a bounded window, a signature without GROUP_CONCAT', () => {
  assert.match(m094, /AS CHAR\(80\) CHARACTER SET utf8mb4\) COLLATE utf8mb4_unicode_ci AS ref_key/);
  assert.match(m094, /ON g\.match_key = d\.match_key/);
  assert.match(m094, /l\.record_type = CONCAT\('wh_', s\.doc_type\)/);
  assert.match(m094, /CHAR_LENGTH\(x\.norm\) >= 4 AND REGEXP_LIKE\(x\.norm, '\[0-9\]'\)/);
  assert.ok(m094.includes(`INTERVAL ${model.RECON_WINDOW_DAYS} DAY)) AS in_scope`), 'the window is the model constant');
  assert.ok(m094.includes(`INTERVAL ${model.RECON_WINDOW_DAYS + model.MATCH_WINDOW_DAYS} DAY;`), 'Accurate lines reach 14 days before the window');
  assert.ok(m094.includes('MIN(approved_day) AS start_date'), 'a back-dated first movement never pulls older documents in');
  const signature = m094.slice(m094.indexOf('SHA2(CONCAT_WS'), m094.indexOf('AS signature'));
  assert.doesNotMatch(signature, /GROUP_CONCAT/);
  assert.doesNotMatch(m094, /unit_price|dpp_amount|total_amount|address/i, 'quantities only (D1), no address (D5)');
});

test('104: a group is judged once the Warehouse mirror covers its grace days; the same rules as 094, computed once', () => {
  assert.ok(m104.includes(`z.since + INTERVAL ${model.RECON_GRACE_DAYS} DAY <= dt.data_through) AS judged`), 'the grace is the model constant');
  assert.match(m104, /\(z\.status = 'acc_only' OR dt\.data_through IS NULL OR /, 'an Accurate document the app lacks is always judged');
  // data_through: while a Warehouse batch waits, the day the last applied one was pulled; else the last pull that brought the Warehouse's data.
  assert.match(m104, /IF\(SUM\(b\.status = 'pending'\) > 0,\s+DATE\(MAX\(CASE WHEN b\.status = 'applied' THEN b\.created_at END\) \+ INTERVAL 7 HOUR\)/);
  assert.match(m104, /r\.status IN \('success', 'skipped'\)\s+AND JSON_UNQUOTE\(JSON_EXTRACT\(r\.stats, '\$\.scope'\)\) = 'warehouse'/);
  assert.match(m104, /NOT JSON_CONTAINS\(COALESCE\(JSON_EXTRACT\(r\.stats, '\$\.skipped\[\*\]\.departmentId'\), JSON_ARRAY\(\)\), CAST\(d\.id AS JSON\)\)/);
  assert.match(m104, /x\.sync_run_id = r\.id AND x\.department_id = d\.id AND x\.status IN \('rejected', 'withdrawn'\)/);
  assert.match(m104, /d\.deleted_at IS NULL AND d\.code = 'warehouse'\) dt/);
  // Computed once: the lines and the movements are materialised CTEs, the assignment is never re-read from 094's view.
  assert.match(m104, /WITH h AS \(SELECT DISTINCT \* FROM wh_recon_movements_app\),\s+dl AS \(SELECT DISTINCT \* FROM wh_recon_doc_lines_accurate\)/);
  assert.doesNotMatch(m104, /FROM wh_recon_(assign|items|doc_keys_accurate|unit_ratios|app_lines)\b/);
  // The same rules as 094, word for word (an explanation keeps its signature).
  const pieces = [
    "SHA2(CONCAT_WS('|', y.status, COALESCE(y.movement_sig, '-'), COALESCE(y.doc_sig, '-'), COALESCE(y.item_sig, '-'), y.item_count, y.unknown_lines, y.missing_item_lines), 256)",
    "CONCAT(COUNT(*), ':', SUM(h.movement_id), ':', BIT_XOR(CRC32(h.movement_id)))",
    "CONCAT(COUNT(*), ':', SUM(CRC32(CONCAT(s.doc_type, ':', s.doc_id))), ':', BIT_XOR(CRC32(CONCAT(s.doc_type, ':', s.doc_id))))",
    "SUM(CRC32(CONCAT_WS('=', COALESCE(i.item_key, '-'), COALESCE(ROUND(i.app_qty_base, 3), 'x'), COALESCE(ROUND(i.acc_qty_base, 3), 'x'))))",
    "(CHAR_LENGTH(k.ref_key) >= 4 AND REGEXP_LIKE(k.ref_key, '[0-9]'))",
    "ORDER BY c.priority, c.group_key",
    'd.trans_date BETWEEN g.first_date - INTERVAL 14 DAY AND g.last_date + INTERVAL 14 DAY',
    'ABS(COALESCE(i.app_qty_base, 0) - COALESCE(i.acc_qty_base, 0)) >= 0.001',
    "GREATEST(g.last_date, COALESCE(g.last_approved_day, g.last_date), COALESCE(dc.last_doc_day, g.last_date)) AS since",
    'AND d.trans_date >= DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR) - INTERVAL 166 DAY',
  ];
  for (const piece of pieces) {
    assert.ok(oneLine(m094).includes(piece), `094: ${piece}`);
    assert.ok(oneLine(m104).includes(piece.replace(/\bh\.movement_id\b/g, 'x.movement_id')), `104: ${piece}`);
  }
  assert.doesNotMatch(m104, /unit_price|dpp_amount|total_amount|address/i, 'quantities only (D1), no address (D5)');
});

test('the list reads counts and the page in one statement, binds the company first and reads MySQL strings as numbers', async (t) => {
  const calls = [];
  const counts = {
    c_open: '9', c_qty_diff: '1', c_app_only: '4', c_acc_only: '2', c_uncomparable: '1', c_waiting: '1', c_explained: '0', c_matched: '6', c_all: '15',
    c_data_through: new Date('2026-09-24T00:00:00Z'),
  };
  let page = [{ ...counts, direction: 'inbound', group_key: 'SJ001', status: 'app_only', movement_count: '1', days_open: '3', judged: '0' }];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/AS inbound_from/.test(sql)) return [[{ docs: '22', units: '0', inbound_from: '2026-09-23', outbound_from: null }]];
    return [page];
  });
  const out = await recon.list(1, { status: 'open', q: '50%' });
  assert.equal(out.total, 9);
  assert.deepEqual(out.counts, { open: 9, qty_diff: 1, app_only: 4, acc_only: 2, uncomparable: 1, waiting: 1, explained: 0, matched: 6, all: 15 });
  assert.deepEqual([out.items[0].judged, out.items[0].daysOpen], [false, 3]);
  assert.equal(out.readiness.windowDays, 180);
  assert.equal(out.readiness.dataThrough, '2026-09-24');
  assert.equal(calls.length, 2, 'one statement for the groups, one for readiness');
  for (const c of calls) assert.equal(c.args[0], 1, 'company first');
  const rows = calls.find((c) => /LIMIT \? OFFSET \?/.test(c.sql));
  assert.match(rows.sql, /^\s*WITH g AS \(SELECT [\s\S]+ FROM wh_recon_groups g WHERE g\.entity_id = \?/, 'the groups are computed once');
  assert.ok(rows.args.includes('%50\\%%'), 'a search is LIKE-escaped');
  assert.match(rows.sql, /ORDER BY g\.judged DESC, FIELD\(g\.status/, 'on "Perlu dicek" the groups still waiting for Accurate data come last');
  // An empty page still carries the counts.
  page = [{ ...counts, group_key: null }];
  const empty = await recon.list(1, { status: 'waiting', page: 9 });
  assert.deepEqual([empty.items, empty.total], [[], 1]);
  assert.match(calls.at(-2).sql, /g\.judged = 0/);
});

test('pairing: only an approved movement, never by its own recorder, one live pair per document', async (t) => {
  const state = { status: 'approved', created_by: 50, dup: false };
  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM warehouse_inbound WHERE id = \?/.test(sql)) return [[{ id: 41, status: state.status, created_by: state.created_by, submitted_by: 60, movement_date: '2026-09-25' }]];
    if (/FROM wh_recon_movements_app h/.test(sql)) return [[{ movement_id: 41, created_by: state.created_by, submitted_by: 60 }]];
    if (/FROM wh_recon_doc_keys_accurate k/.test(sql)) return [[{ doc_id: 900, number: 'RI.9' }]];
    if (/INSERT INTO warehouse_recon_links/.test(sql)) {
      if (state.dup) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
      return [{ insertId: 7 }];
    }
    return [{ affectedRows: 1 }];
  });
  const body = { direction: 'inbound', movementId: 41, docType: 'receipt', docId: 900 };
  await assert.rejects(() => recon.link(supervisor, body), (e) => e.status === 403 && e.code === 'SELF_RESOLVE_FORBIDDEN');
  state.created_by = 70;
  assert.deepEqual(await recon.link(supervisor, body), { id: 7 });
  state.dup = true;
  await assert.rejects(() => recon.link(supervisor, body), (e) => e.status === 409);
  state.status = 'pending_approval';
  await assert.rejects(() => recon.link(supervisor, body), (e) => e.code === 'MOVEMENT_NOT_APPROVED');
});

test('an explanation needs the data the Supervisor saw: a changed group answers 409 STALE', async (t) => {
  const group = { direction: 'inbound', group_key: 'SJ001', status: 'qty_diff', explained: 0, signature: 'a'.repeat(64) };
  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM wh_recon_groups g/.test(sql)) return [[group]];
    return [[]];
  });
  await assert.rejects(
    () => recon.explain(supervisor, { direction: 'inbound', groupKey: 'SJ001', signature: 'b'.repeat(64), reason: 'Sampel dari pemasok' }),
    (e) => e.status === 409 && e.code === 'STALE',
  );
  group.status = 'matched';
  await assert.rejects(
    () => recon.explain(supervisor, { direction: 'inbound', groupKey: 'SJ001', signature: 'a'.repeat(64), reason: 'Sampel dari pemasok' }),
    (e) => e.code === 'NOTHING_TO_EXPLAIN',
  );
});

test('explaining again cancels only a lapsed explanation, never one a colleague gave for the same data', async (t) => {
  const signature = 'a'.repeat(64);
  const group = { direction: 'inbound', group_key: 'SJ001', status: 'qty_diff', explained: 0, signature };
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM wh_recon_groups g/.test(sql)) return [[group]];
    if (/FROM wh_recon_movements_app h/.test(sql)) return [[{ movement_id: 41, created_by: 70, submitted_by: 71 }]];
    return [{ affectedRows: 1 }];
  });
  const tx = { lapsed: [{ id: 11 }], insertError: null, calls: [], rolledBack: 0 };
  t.mock.method(pool, 'getConnection', async () => ({
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => { tx.rolledBack += 1; },
    release: () => {},
    query: async (sql, args) => {
      tx.calls.push({ sql, args });
      if (/SELECT id FROM warehouse_recon_notes/.test(sql)) return [tx.lapsed];
      if (/INSERT INTO warehouse_recon_notes/.test(sql)) {
        if (tx.insertError) throw tx.insertError;
        return [{ insertId: 12 }];
      }
      return [{ affectedRows: 1 }];
    },
  }));
  const body = { direction: 'inbound', groupKey: 'SJ001', signature, reason: 'Sampel dari pemasok' };
  assert.deepEqual(await recon.explain(supervisor, body), { id: 12 });
  const select = tx.calls.find((c) => /SELECT id FROM warehouse_recon_notes/.test(c.sql));
  assert.match(select.sql, /cancelled_at IS NULL AND signature <> \?\s+FOR UPDATE/);
  assert.deepEqual(select.args, [1, 'inbound', 'SJ001', signature]);
  const update = tx.calls.find((c) => /UPDATE warehouse_recon_notes/.test(c.sql));
  assert.match(update.sql, /cancel_reason = 'Diganti penjelasan baru \(data berubah\)'/);
  assert.match(update.sql, /WHERE entity_id = \? AND direction = \? AND group_key = \? AND cancelled_at IS NULL AND signature <> \?/);
  assert.deepEqual(update.args, [50, 1, 'inbound', 'SJ001', signature]);
  const logged = calls.find((c) => /INSERT INTO activity_logs/.test(c.sql));
  assert.deepEqual(JSON.parse(logged.args[5]).replacedNoteIds, [11], 'the replaced explanation is in the history');

  // Nothing lapsed: nothing is cancelled.
  tx.calls.length = 0;
  tx.lapsed = [];
  await recon.explain(supervisor, body);
  assert.equal(tx.calls.filter((c) => /UPDATE warehouse_recon_notes/.test(c.sql)).length, 0);

  // A colleague explained the same data a moment ago: theirs stays, this one is told (409), whichever way MySQL refuses it.
  for (const code of ['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK']) {
    tx.insertError = Object.assign(new Error(code), { code });
    await assert.rejects(() => recon.explain(supervisor, body), (e) => e.status === 409 && e.code === 'CONFLICT' && /baru saja dijelaskan orang lain/.test(e.message), code);
  }
  assert.equal(tx.rolledBack, 2);
});

test('segregation of duties: whoever recorded a movement of the group neither explains, undoes, unpairs nor sees the buttons', async (t) => {
  const own = [{ movement_id: 41, movement_date: '2026-09-25', status: 'approved', reference_no: 'SJ-001', party: 'PT Sumber Makmur', created_by: supervisor.sub, submitted_by: 60 }];
  const group = { direction: 'inbound', group_key: 'SJ001', status: 'qty_diff', explained: 0, movement_count: '1', signature: 'a'.repeat(64) };
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM wh_recon_groups g/.test(sql)) return [[group]];
    if (/FROM wh_recon_movements_app h/.test(sql)) return [own];
    if (/FROM warehouse_recon_notes\s+WHERE id = \?/.test(sql)) return [[{ id: 5, direction: 'inbound', group_key: 'SJ001' }]];
    if (/FROM warehouse_recon_links\s+WHERE id = \?/.test(sql)) return [[{ id: 7, movement_type: 'inbound', movement_id: 41, doc_type: 'receipt', doc_id: 900 }]];
    if (/FROM warehouse_inbound WHERE id = \?/.test(sql)) return [[{ created_by: supervisor.sub, submitted_by: 60 }]];
    return [[]];
  });
  t.mock.method(pool, 'getConnection', async () => { throw new Error('no transaction may start'); });
  const forbidden = (e) => e.status === 403 && e.code === 'SELF_RESOLVE_FORBIDDEN';
  await assert.rejects(() => recon.explain(supervisor, { direction: 'inbound', groupKey: 'SJ001', signature: 'a'.repeat(64), reason: 'Sampel dari pemasok' }), forbidden);
  await assert.rejects(() => recon.unexplain(supervisor, 5, 'Salah jelaskan'), forbidden);
  await assert.rejects(() => recon.unlink(supervisor, 7, 'Salah pasang'), forbidden);
  assert.equal(calls.filter((c) => /INSERT|UPDATE/.test(c.sql)).length, 0, 'no note or link written or cancelled');
  const detail = await recon.detail(supervisor, 'inbound', 'SJ001');
  assert.deepEqual(
    { canLink: detail.permissions.canLink, canExplain: detail.permissions.canExplain, canUnlink: detail.permissions.canUnlink, canUnexplain: detail.permissions.canUnexplain },
    { canLink: false, canExplain: false, canUnlink: false, canUnexplain: false },
  );
  assert.match(detail.permissions.resolveBlockedReason, /Supervisor atau Head Warehouse lain/);
});

test('the 180-day window: the movement card says why a movement is not compared, and pairing refuses it', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2027-06-01T03:00:00Z') });
  let movement = { direction: 'inbound', group_key: 'SJ001', in_scope: 0, movement_status: 'approved', movement_date: '2026-11-20' };
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM wh_recon_movements_app h\s+WHERE h\.entity_id = \? AND h\.direction = \? AND h\.movement_id = \?/.test(sql)) return [[movement]];
    if (/FROM wh_recon_groups g/.test(sql)) return [[{ status: 'app_only', explained: 0, doc_numbers: null, doc_count: '0', docs_ready: 1, judged: '0', data_through: '2027-05-28' }]];
    if (/FROM warehouse_inbound WHERE id = \?/.test(sql)) return [[{ id: 41, status: 'approved', created_by: 70, submitted_by: 71, movement_date: movement.movement_date }]];
    return [[]];
  });
  assert.deepEqual(await recon.forMovement(1, 'inbound', 41), {
    inScope: false, reason: 'outside_window', reconFrom: model.RECON_FROM, windowFrom: '2026-12-03', windowDays: model.RECON_WINDOW_DAYS,
  });
  assert.equal(calls.filter((c) => /wh_recon_groups/.test(c.sql)).length, 0, 'a movement out of scope never evaluates the groups');
  const body = { direction: 'inbound', movementId: 41, docType: 'receipt', docId: 900 };
  await assert.rejects(() => recon.link(supervisor, body), (e) => e.status === 409 && e.code === 'OUT_OF_SCOPE' && /lebih dari 180 hari lalu/.test(e.message));
  // Inside the window the card shows the group, and says it still waits for Accurate data.
  movement = { ...movement, in_scope: 1, movement_date: '2027-05-30' };
  const card = await recon.forMovement(1, 'inbound', 41);
  assert.deepEqual([card.inScope, card.status, card.judged, card.dataThrough], [true, 'app_only', false, '2027-05-28']);
  // While the window has not moved past 22 Sep 2026, older is "before the start".
  t.mock.timers.setTime(Date.parse('2026-09-30T03:00:00Z'));
  movement = { ...movement, in_scope: 0, movement_date: '2026-09-10' };
  assert.equal((await recon.forMovement(1, 'inbound', 41)).reason, 'before_recon_from');
  await assert.rejects(() => recon.link(supervisor, body), (e) => e.code === 'OUT_OF_SCOPE' && /sebelum 22 Sep 2026/.test(e.message));
  movement = { ...movement, movement_status: 'pending_approval' };
  assert.equal((await recon.forMovement(1, 'inbound', 41)).reason, 'not_approved');
  assert.equal(calls.filter((c) => /INSERT/.test(c.sql)).length, 0);
});

test('undoing a pair or an explanation is bound to the company', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/FROM warehouse_recon_links\s+WHERE id = \?/.test(sql)) return [[{ id: 7, movement_type: 'inbound', movement_id: 41, doc_type: 'receipt', doc_id: 900 }]];
    if (/FROM warehouse_inbound WHERE id = \?/.test(sql)) return [[{ created_by: 70, submitted_by: 71 }]];
    return [{ affectedRows: 1 }];
  });
  await recon.unlink(supervisor, 7, 'Salah pasang');
  const update = calls.find((c) => /UPDATE warehouse_recon_links/.test(c.sql));
  assert.match(update.sql, /WHERE id = \? AND entity_id = \? AND cancelled_at IS NULL/);
  assert.deepEqual(update.args.slice(-2), [7, 1]);
});

test('who may see and resolve it: Warehouse and MO see; only Warehouse Supervisor/Head resolve; routes are guarded', () => {
  for (const role of ['warehouse.member', 'warehouse.supervisor', 'management_office.supervisor']) {
    assert.ok(permissionsForStandardRole(role).includes('warehouse.recon.view'), role);
  }
  assert.ok(permissionsForStandardRole('warehouse.supervisor').includes('warehouse.recon.resolve'));
  for (const role of ['warehouse.member', 'management_office.supervisor', 'sales.member', 'procurement.member']) {
    assert.equal(permissionsForStandardRole(role).includes('warehouse.recon.resolve'), false, role);
  }
  assert.equal(permissionsForStandardRole('sales.member').includes('warehouse.recon.view'), false);
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/warehouse.routes.js'), 'utf8');
  for (const [route, perm] of [["get('/recon'", 'warehouse.recon.view'], ["get('/recon/:direction/:groupKey'", 'warehouse.recon.view'],
    ["post('/recon/links'", 'warehouse.recon.resolve'], ["post('/recon/notes'", 'warehouse.recon.resolve'],
    ["post('/recon/links/:id/cancel'", 'warehouse.recon.resolve'], ["post('/recon/notes/:id/cancel'", 'warehouse.recon.resolve']]) {
    const at = src.indexOf(`router.${route}`);
    assert.ok(at >= 0, route);
    assert.match(src.slice(at, at + 120), new RegExp(`requirePermission\\('${perm.replace(/\./g, '\\.')}'\\)`), route);
  }
});
