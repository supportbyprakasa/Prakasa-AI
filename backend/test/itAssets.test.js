const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db/pool');
const lifecycle = require('../src/services/deviceLifecycle.service');
const {
  DEVICE_TYPES, DEVICE_TYPE_LABELS, DEVICE_STATUSES, DEVICE_STATUS_LABELS, REPORT_STATUS_MAP,
} = require('../src/config/itAssets');

// People & Culture wave 1, row 1.2 — IT assets (docs/rancangan-people-culture-g1.md, Part 1, rules 14–22).

const ME = 1;
const OTHER = 99;
const user = { sub: 7, entityId: ME, permissions: ['device.view', 'device.manage', 'device.assign', 'it.dashboard.view'] };
const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const migration = fs.readFileSync(path.join(__dirname, '../migrations/107_it_assets_wave1.sql'), 'utf8');

function fakeConn(answer = () => null) {
  const calls = [];
  const conn = {
    calls,
    async query(sql, args = []) {
      const s = String(sql);
      calls.push({ sql: s, args });
      const out = answer(s, args, calls);
      if (out !== null && out !== undefined) return out;
      if (/^\s*(UPDATE|INSERT|DELETE)/i.test(s)) return [{ affectedRows: 1, insertId: 500 }];
      return [[]];
    },
    beginTransaction: async () => {}, commit: async () => { conn.committed = true; }, rollback: async () => { conn.rolledBack = true; }, release: () => {},
  };
  return conn;
}

// ------------------------------------------------------------ rule 20

test('device types and statuses: one list, the same as the DB enums and the zod rules', () => {
  const typeEnum = migration.match(/MODIFY device_type ENUM\(([^)]*)\)/)[1].split(',').map((v) => v.trim().replace(/'/g, ''));
  assert.deepEqual(typeEnum, [...DEVICE_TYPES]);
  const statusEnum = migration.match(/MODIFY status ENUM\(([^)]*)\)/)[1].split(',').map((v) => v.trim().replace(/'/g, ''));
  assert.deepEqual(statusEnum, [...DEVICE_STATUSES]);
  for (const t of ['telephone', 'label_printer', 'fingerprint']) assert.ok(DEVICE_TYPES.includes(t), t);
  assert.deepEqual(Object.keys(DEVICE_TYPE_LABELS).sort(), [...DEVICE_TYPES].sort(), 'every type has an Indonesian label');
  assert.deepEqual(Object.keys(DEVICE_STATUS_LABELS).sort(), [...DEVICE_STATUSES].sort());
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/it.routes.js'), 'utf8');
  assert.match(routes, /deviceType: z\.enum\(DEVICE_TYPES\)/);
  assert.match(routes, /status: z\.enum\(DEVICE_STATUSES\)/);
  assert.match(routes, /assetCode: z\.string\(\)\.trim\(\)\.max\(80\)\.nullable\(\)\.optional\(\)/, 'asset code is optional (rule 16)');
});

test('device type labels agree with the frontend model for every type it names', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/it/itModel.js'), 'utf8');
  const block = src.match(/export const DEVICE_TYPE_LABELS = \{([\s\S]*?)\};/)[1];
  const frontend = Object.fromEntries([...block.matchAll(/(\w+): '([^']+)'/g)].map((m) => [m[1], m[2]]));
  assert.ok(Object.keys(frontend).length >= 14);
  for (const [key, label] of Object.entries(frontend)) {
    assert.ok(DEVICE_TYPES.includes(key), `${key} is a DB type`);
    assert.equal(DEVICE_TYPE_LABELS[key], label, key);
  }
});

test('status labels read like the report: Aktif / Cadangan / Rusak / Tidak aktif (rule 14)', () => {
  assert.equal(DEVICE_STATUS_LABELS.assigned, 'Aktif');
  assert.equal(DEVICE_STATUS_LABELS.available, 'Cadangan');
  assert.equal(DEVICE_STATUS_LABELS.damaged, 'Rusak');
  assert.equal(DEVICE_STATUS_LABELS.retired, 'Tidak aktif');
  assert.equal(REPORT_STATUS_MAP.active, 'assigned');
  assert.equal(REPORT_STATUS_MAP.spare, 'available');
  assert.equal(REPORT_STATUS_MAP.damaged, 'damaged');
  assert.equal(REPORT_STATUS_MAP['not active'], 'retired');
});

// ------------------------------------------------------------ migration 107

test('migration 107: asset code not unique, serial unique per entity when present, holder integrity (rules 15, 16)', () => {
  assert.match(migration, /DROP INDEX asset_code/);
  assert.match(migration, /ADD KEY idx_devices_entity_asset \(entity_id, asset_code\)/);
  assert.match(migration, /MODIFY asset_code VARCHAR\(80\) NULL/);
  assert.match(migration, /serial_key VARCHAR\(150\) GENERATED ALWAYS AS \(IF\(deleted_at IS NULL, NULLIF\(UPPER\(TRIM\(serial_number\)\), ''\), NULL\)\) STORED/);
  assert.match(migration, /ADD UNIQUE KEY uq_devices_entity_serial \(entity_id, serial_key\)/);
  assert.match(migration, /CHECK \(\(assigned_to IS NOT NULL\) \+ \(person_id IS NOT NULL\) \+ \(holder_label IS NOT NULL\) = 1\)/, 'exactly one holder');
  assert.match(migration, /MODIFY assigned_to INT UNSIGNED NULL/);
  assert.match(migration, /FOREIGN KEY \(entity_id, person_id\) REFERENCES people_directory \(entity_id, id\)/);
  assert.match(migration, /FOREIGN KEY \(entity_id, location_id\) REFERENCES org_locations \(entity_id, id\)/);
  assert.match(migration, /status_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER status/);
  assert.doesNotMatch(migration.match(/ADD COLUMN status_changed_at[^,]*/)[0], /ON UPDATE/, 'never ON UPDATE (rule 14)');
  for (const col of ['ram_gb', 'storage_gb', 'os_version', 'purchase_year', 'location_id', 'holder_person_id', 'holder_label']) {
    assert.match(migration, new RegExp(`ADD COLUMN ${col} `), col);
  }
});

// ------------------------------------------------------------ rule 14 / 15

const device = (status, more = {}) => ({ id: 5, entity_id: ME, status, asset_code: 'A-1', device_type: 'laptop', ...more });

test('status: Aktif only with a holder; leaving Aktif closes the active assignment; Dibuang is final', async () => {
  let conn = fakeConn();
  await assert.rejects(() => lifecycle.changeStatus(conn, { entityId: ME, device: device('available'), status: 'assigned', actorId: 7 }), (e) => e.code === 'HOLDER_REQUIRED');
  await assert.rejects(() => lifecycle.changeStatus(conn, { entityId: ME, device: device('available'), status: 'damaged', holder: { label: 'Ops' }, actorId: 7 }), (e) => e.code === 'HOLDER_NOT_ALLOWED');
  await assert.rejects(() => lifecycle.changeStatus(conn, { entityId: ME, device: device('disposed'), status: 'available', actorId: 7 }), (e) => e.code === 'DEVICE_FINAL' && e.status === 409);
  await assert.rejects(() => lifecycle.changeStatus(conn, { entityId: ME, device: device('damaged'), status: 'damaged', actorId: 7 }), (e) => e.code === 'NO_CHANGE');
  await assert.rejects(() => lifecycle.changeStatus(conn, { entityId: ME, device: device('assigned'), status: 'assigned', holder: { label: 'X' }, actorId: 7 }), (e) => e.code === 'ALREADY_ASSIGNED');

  conn = fakeConn();
  const out = await lifecycle.changeStatus(conn, { entityId: ME, device: device('assigned'), status: 'damaged', actorId: 7, note: 'Layar pecah' });
  assert.equal(out.status, 'damaged');
  const close = conn.calls.find((c) => /UPDATE device_assignments/.test(c.sql));
  assert.match(close.sql, /SET status = 'returned', actual_return_date = DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\)/);
  assert.match(close.sql, /WHERE device_id = \? AND entity_id = \? AND status = 'active'/);
  const cache = conn.calls.find((c) => /SET current_assignee_id = \?, holder_person_id = \?, holder_label = \?/.test(c.sql));
  assert.deepEqual(cache.args, [null, null, null, 5, ME], 'holder cache cleared');
  const write = conn.calls.find((c) => /status_changed_at = IF\(status <=> \?, status_changed_at, CURRENT_TIMESTAMP\), status = \?/.test(c.sql));
  assert.ok(write, 'status_changed_at is set only when the status really changes, by the app (never ON UPDATE)');
  assert.deepEqual(write.args, ['damaged', 'damaged', 5, ME]);
  assert.ok(conn.calls.some((c) => /INSERT INTO activity_logs/.test(c.sql) && JSON.parse(c.args[5]).to === 'damaged'));
});

test('holder: exactly one of account / directory person / team label; a person with an account is stored as the account', async () => {
  assert.throws(() => lifecycle.holderFromBody({ assignedTo: 3, holderLabel: 'Ops' }), (e) => e.code === 'HOLDER_AMBIGUOUS');
  assert.deepEqual(lifecycle.holderFromBody({ holderLabel: '  Ops   Team ' }), { label: 'Ops Team' });
  assert.equal(lifecycle.holderFromBody({}), null);

  let conn = fakeConn((s) => (/FROM people_directory p LEFT JOIN users u/.test(s)
    ? [[{ id: 12, user_id: 30, kind: 'employee', status: 'active', name: 'Ani', department_id: 5, account_status: 'active', account_deleted: null }]] : null));
  assert.deepEqual(await lifecycle.resolveHolder(conn, ME, { personId: 12 }), { userId: 30, name: 'Ani', departmentId: 5 });
  assert.deepEqual(conn.calls[0].args, [12, ME]);

  conn = fakeConn((s) => (/FROM people_directory p LEFT JOIN users u/.test(s)
    ? [[{ id: 13, user_id: null, kind: 'employee', status: 'resigned', name: 'Eko', department_id: null }]] : null));
  await assert.rejects(() => lifecycle.resolveHolder(conn, ME, { personId: 13 }), (e) => e.code === 'HOLDER_RESIGNED');
  conn = fakeConn((s) => (/FROM people_directory p LEFT JOIN users u/.test(s) ? [[{ id: 14, kind: 'excluded', status: 'active' }]] : null));
  await assert.rejects(() => lifecycle.resolveHolder(conn, ME, { personId: 14 }), (e) => e.code === 'HOLDER_NOT_FOUND');
  conn = fakeConn();
  await assert.rejects(() => lifecycle.resolveHolder(conn, ME, { userId: 30 }), (e) => e.code === 'HOLDER_NOT_FOUND' && e.status === 404);
  assert.match(conn.calls[0].sql, /entity_id = \? AND deleted_at IS NULL AND status = 'active'/);
});

test('assignment: 409 only while an ACTIVE assignment exists; person and label holders get an assignment row', async () => {
  let conn = fakeConn((s) => (/FROM device_assignments\s+WHERE device_id = \?/.test(s) ? [[{ id: 3 }]] : null));
  await assert.rejects(() => lifecycle.openAssignment(conn, { entityId: ME, device: device('available'), holder: { label: 'Ops' }, actorId: 7 }), (e) => e.code === 'CONFLICT' && e.status === 409);

  // A Rusak device with no active assignment can be handed out again.
  conn = fakeConn();
  const out = await lifecycle.openAssignment(conn, { entityId: ME, device: device('damaged'), holder: { label: 'Ops Team' }, actorId: 7 });
  assert.equal(out.assignmentId, 500);
  const ins = conn.calls.find((c) => /INSERT INTO device_assignments/.test(c.sql));
  assert.deepEqual(ins.args.slice(0, 6), [ME, null, 5, null, null, 'Ops Team'], 'assigned_to NULL, person NULL, label set');
  const cache = conn.calls.find((c) => /SET current_assignee_id = \?/.test(c.sql));
  assert.deepEqual(cache.args, [null, null, 'Ops Team', 5, ME]);

  for (const status of ['lost', 'disposed']) {
    await assert.rejects(() => lifecycle.openAssignment(fakeConn(), { entityId: ME, device: device(status), holder: { label: 'Ops' }, actorId: 7 }), (e) => e.code === 'DEVICE_NOT_ASSIGNABLE');
  }
});

test('assignments controller: person holder, no notification without an account; body entity ignored', async (t) => {
  const ctrl = require('../src/controllers/deviceAssignments.controller');
  const notif = require('../src/services/notification.service');
  const sent = [];
  t.mock.method(notif, 'create', async (n) => { sent.push(n); });
  const conn = fakeConn((s) => {
    if (/SELECT \* FROM devices WHERE id=\? AND entity_id=\?/.test(s)) return [[device('available')]];
    if (/FROM people_directory p LEFT JOIN users u/.test(s)) return [[{ id: 12, user_id: null, kind: 'employee', status: 'active', name: 'Eko', department_id: 2 }]];
    return null;
  });
  t.mock.method(pool, 'getConnection', async () => conn);
  const r = res();
  await ctrl.create({ body: { entityId: OTHER, deviceId: 5, personId: 12 }, user }, r, (e) => { throw e; });
  assert.equal(r.statusCode, 201);
  assert.equal(sent.length, 0, 'a person without an account gets no notification');
  const ins = conn.calls.find((c) => /INSERT INTO device_assignments/.test(c.sql));
  assert.deepEqual(ins.args.slice(0, 5), [ME, 2, 5, null, 12]);
  for (const c of conn.calls) assert.ok(!c.args.includes(OTHER));
  assert.ok(conn.committed);

  const r2 = res();
  await ctrl.create({ body: { deviceId: 5 }, user }, r2, (e) => { throw e; });
  assert.equal(r2.statusCode, 400);
  assert.equal(r2.body.error.code, 'HOLDER_REQUIRED');
});

test('return: a device handed back broken becomes Rusak (at IT, not at a vendor)', async (t) => {
  const ctrl = require('../src/controllers/deviceAssignments.controller');
  const conn = fakeConn((s) => (/FROM device_assignments WHERE id=\? AND entity_id=\? AND status='active'/.test(s)
    ? [[{ id: 3, entity_id: ME, device_id: 5 }]] : null));
  t.mock.method(pool, 'getConnection', async () => conn);
  const r = res();
  await ctrl.returnDevice({ params: { id: 3 }, body: { conditionOnReturn: 'broken' }, user }, r, (e) => { throw e; });
  assert.equal(r.body.data.newStatus, 'damaged');
  const write = conn.calls.find((c) => /status_changed_at = IF/.test(c.sql));
  assert.ok(write.args.includes('broken'));
});

test('repairs: filing a repair moves the device to Perbaikan through the same code path', async (t) => {
  const logs = require('../src/controllers/deviceLogs.controller');
  t.mock.method(pool, 'query', async (sql) => (/SELECT entity_id AS entityId FROM devices/.test(sql) ? [[{ entityId: ME }]] : [{ insertId: 8, affectedRows: 1 }]));
  const conn = fakeConn((s) => (/SELECT id, status FROM devices WHERE id=\? AND entity_id=\?/.test(s) ? [[{ id: 5, status: 'assigned' }]] : null));
  t.mock.method(pool, 'getConnection', async () => conn);
  const r = res();
  await logs.createRepair({ params: { id: 5 }, body: { reportedDate: '2026-10-01', issueDescription: 'Mati' }, user }, r, (e) => { throw e; });
  assert.equal(r.statusCode, 201);
  assert.ok(conn.calls.some((c) => /UPDATE device_assignments/.test(c.sql)), 'the holder\'s assignment closes');
  assert.ok(conn.calls.some((c) => /status_changed_at = IF/.test(c.sql) && c.args.includes('repair')));
});

// ------------------------------------------------------------ devices controller

function capture(t, answer = () => [[{ total: 0 }]]) {
  const calls = [];
  const handler = async (sql, args = []) => {
    calls.push({ sql: String(sql), args });
    if (/^\s*(UPDATE|INSERT|DELETE)/i.test(String(sql))) return [{ affectedRows: 1, insertId: 77 }];
    return answer(String(sql), args);
  };
  t.mock.method(pool, 'query', handler);
  t.mock.method(pool, 'getConnection', async () => ({ query: handler, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} }));
  return calls;
}

test('devices: create normalises the serial, allows no asset code, defaults to the People & Culture division (rules 16, 17)', async (t) => {
  const ctrl = require('../src/controllers/devices.controller');
  const calls = capture(t, (s) => (/code = 'people_culture'/.test(s) ? [[{ id: 6 }]] : [[{ id: 1 }]]));
  const r = res();
  await ctrl.create({ body: { entityId: OTHER, deviceType: 'label_printer', serialNumber: '  zd230-01 ', model: 'Zebra ZD230', ramGb: null }, user }, r, (e) => { throw e; });
  assert.equal(r.statusCode, 201);
  const ins = calls.find((c) => /INSERT INTO devices/.test(c.sql));
  assert.equal(ins.args[0], ME);
  assert.equal(ins.args[1], 6, 'People & Culture division');
  assert.equal(ins.args[2], null, 'no asset code');
  assert.equal(ins.args[6], 'ZD230-01', 'serial trimmed and uppercased');
  assert.match(ins.sql, /'available', CURRENT_TIMESTAMP/);
  assert.ok(!ins.args.includes(OTHER));
});

test('devices: update can set the asset code and type, never the status; a duplicate serial is a clear 409', async (t) => {
  const ctrl = require('../src/controllers/devices.controller');
  const calls = capture(t);
  const r = res();
  await ctrl.update({ params: { id: 5 }, body: { assetCode: ' LAP/PFN/2024/002 ', deviceType: 'telephone', status: 'retired' }, user }, r, (e) => { throw e; });
  const upd = calls.find((c) => /UPDATE devices SET/.test(c.sql));
  assert.match(upd.sql, /asset_code=\?, device_type=\?/);
  assert.doesNotMatch(upd.sql, /\bstatus=/);
  assert.deepEqual(upd.args, ['LAP/PFN/2024/002', 'telephone', 5, ME]);

  t.mock.method(pool, 'query', async () => { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; });
  const r2 = res();
  await ctrl.update({ params: { id: 5 }, body: { serialNumber: 'x' }, user }, r2, (e) => { throw e; });
  assert.equal(r2.statusCode, 409);
  assert.equal(r2.body.error.code, 'SERIAL_TAKEN');
});

test('devices: list, export, status and locations are bound to the user\'s company', async (t) => {
  const devices = require('../src/controllers/devices.controller');
  const locations = require('../src/controllers/orgLocations.controller');
  for (const [label, fn, req] of [
    ['list', devices.list, { query: { entityId: String(OTHER), status: 'assigned,damaged', problematic: '1', noAssetCode: '1', resignedHolder: '1', warrantyDays: '60', q: 'lap', locationId: 'none' } }],
    ['export', devices.exportRows, { query: { entityId: String(OTHER) } }],
    ['status', devices.setStatus, { params: { id: 5 }, body: { status: 'damaged', entityId: OTHER } }],
    ['locations.list', locations.list, { query: { entityId: String(OTHER) } }],
    ['locations.create', locations.create, { body: { name: 'PFN Office', entityId: OTHER } }],
    ['locations.update', locations.update, { params: { id: 3 }, body: { isActive: false } }],
  ]) {
    const calls = capture(t, (s) => (/FROM entities/.test(s) ? [[{ name: 'Prakasa Foods Nusantara' }]] : [[{ total: 0, id: 3, status: 'available', name: 'X', is_active: 1 }]]));
    await fn({ query: {}, params: {}, body: {}, ...req, user }, res(), (e) => { throw e; });
    const touching = calls.filter((c) => /\b(devices|device_assignments|org_locations)\b/.test(c.sql));
    assert.ok(touching.length, label);
    for (const c of touching) {
      assert.ok(c.args.includes(ME), `${label}: binds the company — ${c.sql.replace(/\s+/g, ' ').slice(0, 80)}`);
      assert.ok(!c.args.includes(OTHER) && !c.args.includes(String(OTHER)), label);
    }
    pool.query.mock.restore(); pool.getConnection.mock.restore();
  }
});

test('devices: export is in the report\'s column order, with report words for type and status (rule 19)', async (t) => {
  const devices = require('../src/controllers/devices.controller');
  capture(t, (s) => {
    if (/FROM entities/.test(s)) return [[{ name: 'Prakasa Foods Nusantara' }]];
    return [[{
      id: 1, entity_id: ME, device_type: 'smartphone', model: 'Iphone 14', serial_number: 'D6KD', asset_code: null,
      purchase_year: '2023', status: 'assigned', holder_kind: 'label', holder_label: 'Ops Team', holder_name: 'Ops Team',
      location_name: 'Alsut Office', holder_resigned: '0',
    }]];
  });
  const r = res();
  await devices.exportRows({ query: {}, user }, r, (e) => { throw e; });
  assert.deepEqual(r.body.data.columns.slice(0, 11), ['No', 'Device Type', 'Brand / Model', 'Serial Number', 'Asset No.', 'Purchase Year', 'User Name', 'Location', 'Company', 'Status', 'Notes']);
  assert.deepEqual(r.body.data.rows[0].slice(0, 11), [1, 'Mobile Phone', 'Iphone 14', 'D6KD', null, 2023, 'Ops Team', 'Alsut Office', 'PFN', 'Active', null]);
});

// ------------------------------------------------------------ rules 21 / 22

test('IT dashboard: summary and AI report read ONLY the signed-in user\'s company (rule 21)', async (t) => {
  const dash = require('../src/controllers/itDashboard.controller');
  for (const fn of [dash.summary, dash.aiReport]) {
    const calls = capture(t, () => [[{ total: '0' }]]);
    // The AI provider is not configured in tests: aiReport stops after reading the data, which is what is checked.
    await fn({ query: { entityId: String(OTHER) }, body: { entityId: OTHER }, user }, res(), (e) => { if (fn === dash.summary) throw e; });
    const reads = calls.filter((c) => /\b(devices|software_subscriptions|people_directory|org_locations)\b/.test(c.sql));
    assert.ok(reads.length >= 2);
    for (const c of reads) {
      assert.ok(c.args.includes(ME), c.sql.replace(/\s+/g, ' ').slice(0, 80));
      assert.ok(!c.args.includes(OTHER) && !c.args.includes(String(OTHER)));
    }
    pool.query.mock.restore(); pool.getConnection.mock.restore();
  }
  const src = fs.readFileSync(path.join(__dirname, '../src/controllers/itDashboard.controller.js'), 'utf8');
  assert.doesNotMatch(src, /req\.query\.entityId|req\.body\.entityId/);
});

test('IT dashboard: numbers reconcile with the report — Bermasalah = Rusak + Tidak aktif, as numbers (rule 22)', async (t) => {
  const dash = require('../src/controllers/itDashboard.controller');
  capture(t, (s) => {
    if (/AS problematic/.test(s) && /AS without_asset_code/.test(s)) {
      return [[{ total: '69', available: '6', assigned: '57', maintenance: '0', repair: '0', damaged: '3', retired: '3', lost: '0', disposed: '0', problematic: '6', without_asset_code: '39', warranty_ending: '2', resigned_holder: '1' }]];
    }
    if (/AS headcount/.test(s)) return [[{ headcount: '31', unreviewed: '12', group_staff: '1', without_account: '11' }]];
    if (/GROUP BY d\.device_type/.test(s)) return [[{ device_type: 'laptop', total: '22' }, { device_type: 'label_printer', total: '2' }]];
    if (/GROUP BY d\.location_id/.test(s)) return [[{ location_id: 1, name: 'PFN Office', total: '40', problematic: '2' }, { location_id: null, name: null, total: '1', problematic: '0' }]];
    return [[{ total: '0' }]];
  });
  const r = res();
  await dash.summary({ query: {}, user }, r, (e) => { throw e; });
  const d = r.body.data;
  assert.deepEqual(d.people, { headcount: 31, unreviewedAccounts: 12, groupStaff: 1, withoutAccount: 11 });
  assert.equal(d.devices.total, 69);
  assert.equal(d.devices.active, 57);
  assert.equal(d.devices.problematic, 6);
  assert.equal(d.devices.byStatus.damaged + d.devices.byStatus.retired, d.devices.problematic);
  assert.equal(d.devices.withoutAssetCode, 39);
  assert.equal(d.devices.warrantyEnding, 2);
  assert.equal(d.devices.warrantyWindowDays, 60);
  assert.equal(d.devices.resignedHolder, 1);
  assert.deepEqual(d.byType, [{ deviceType: 'laptop', label: 'Laptop', total: 22 }, { deviceType: 'label_printer', label: 'Printer label', total: 2 }]);
  assert.deepEqual(d.byLocation[1], { locationId: null, name: 'Tanpa lokasi', total: 1, problematic: 0 });
  assert.equal(typeof d.subscriptions.total, 'number');
});
