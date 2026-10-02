const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/services/itAssetImportModel');
const importer = require('../src/services/itAssetImport.service');
const { buildReport, DEVICES, PEOPLE, deviceSheet } = require('./fixtures/deviceReport');

// People & Culture wave 1, rule 18 — import of the owner's device report
// (only its own layout), with the people of its "User List" first.

const ENV = { GOOGLE_ALLOWED_DOMAIN: 'prakasagroup.com,prakasafoods.com' };
const CODE = 'PFN';

const CONTEXT = () => ({
  users: [
    { id: 30, name: 'Ani Wijaya', email: 'ani.wijaya@prakasafoods.com', status: 'active', department_id: 5, deleted: false },
    { id: 31, name: 'Budi Santoso', email: 'budi.s@prakasafoods.com', status: 'active', department_id: 3, deleted: false },
    { id: 32, name: 'Dewi Anggraini', email: 'dewi@prakasafoods.com', status: 'active', department_id: 9, deleted: false },
    { id: 33, name: 'Fajar Nugroho', email: 'fajar@prakasafoods.com', status: 'inactive', department_id: 9, deleted: false },
  ],
  people: [{ id: 50, user_id: 32, full_name: null, work_email: null, position: 'Admin', status: 'active', kind: 'employee' }],
  locations: [{ id: 1, name: 'PFN Office', is_active: 1 }],
  devices: [],
});

const plan = (payload = buildReport(), context = CONTEXT()) => model.buildPlan(payload, context, { entityCode: CODE, currentYear: 2026, env: ENV });
const byNo = (rows, no) => rows.find((r) => r.no === String(no));
const codes = (row) => row.issues.map((i) => i.code);

test('only the report layout: the header row is found under the title rows by exact column names', () => {
  const p = plan();
  assert.equal(p.companyCode, 'PFN');
  assert.equal(p.devices.length, 10, 'the 10 PFN device rows');
  assert.equal(p.people.length, 5, 'the 5 PFN people');
  assert.throws(() => plan({ devices: [['Tipe', 'Merek'], ['Laptop', 'X']], people: null }), (e) => e.code === 'IMPORT_HEADER_NOT_FOUND');
  // A reference-layout tab ("02 - Users Device Inventory" style) is not the report: refused.
  assert.throws(() => plan({ devices: [['No', 'Category', 'Brand', 'Model', 'Serial', 'User', 'Entity', 'Condition']], people: null }), (e) => e.code === 'IMPORT_HEADER_NOT_FOUND');
});

test('password / sandi / username / credential columns are never read; "User Name" is the holder (rule 18)', () => {
  const secretColumns = [
    { header: 'Password WiFi', value: 'SECRET-PW-1' },
    { header: 'Username', value: 'SECRET-USER-1' },
    { header: 'Kata Sandi', value: 'SECRET-PW-2' },
    { header: 'Admin Credential', value: 'SECRET-CRED-1' },
    { header: 'USER_NAME_LOGIN username', value: 'SECRET-USER-2' },
  ];
  const p = plan(buildReport({ deviceExtra: secretColumns, peopleExtra: secretColumns }));
  const json = JSON.stringify(p);
  for (const secret of ['SECRET-PW-1', 'SECRET-USER-1', 'SECRET-PW-2', 'SECRET-CRED-1', 'SECRET-USER-2']) {
    assert.ok(!json.includes(secret), `${secret} never leaves the parser`);
  }
  assert.deepEqual(p.sheets.devices.credentialColumnsIgnored, secretColumns.map((c) => c.header));
  assert.deepEqual(p.sheets.people.credentialColumnsIgnored, secretColumns.map((c) => c.header));
  assert.equal(byNo(p.devices, 1).holderText, 'Ani Wijaya', 'User Name is read as the holder');
  const { CREDENTIAL_HEADER_RE } = require('../src/config/itAssets');
  assert.equal(CREDENTIAL_HEADER_RE.test('user name'), false);
});

test('summary rows are skipped; other companies are only counted, never listed (server-side company check)', () => {
  const p = plan();
  assert.equal(p.counts.devices.summaryRowsSkipped, 5);
  assert.deepEqual(p.counts.devices.otherCompany, { PMK: 1, IGS: 1, DJAYA77: 1 });
  assert.deepEqual(p.counts.people.otherCompany, { IGS: 1 });
  const json = JSON.stringify(p);
  for (const other of ['IG01SN001', 'D7SN001', 'S/N64485346503', 'rahmat@indoseas.com']) assert.ok(!json.includes(other), other);
  // Another entity's code imports that entity's rows only — never PFN's.
  const igs = model.buildPlan(buildReport(), CONTEXT(), { entityCode: 'IGS', currentYear: 2026, env: ENV });
  assert.equal(igs.devices.length, 1);
  assert.equal(igs.counts.devices.otherCompany.PFN, 10);
});

test('type and status mapping: Active→Aktif, Spare→Cadangan, Damaged→Rusak, Not Active→Tidak aktif; unknown type → Lainnya with a note', () => {
  const p = plan();
  assert.deepEqual([1, 6, 8, 10].map((n) => byNo(p.devices, n).status), ['assigned', 'available', 'damaged', 'retired']);
  assert.equal(byNo(p.devices, 3).deviceType, 'smartphone');
  assert.equal(byNo(p.devices, 5).deviceType, 'label_printer');
  assert.equal(byNo(p.devices, 6).deviceType, 'peripheral');
  assert.equal(byNo(p.devices, 10).deviceType, 'telephone');
  const odd = byNo(p.devices, 9);
  assert.equal(odd.deviceType, 'other');
  assert.match(odd.notes, /Tipe di laporan: Hoverboard/);
  assert.ok(codes(odd).includes('TYPE_UNKNOWN'));
  assert.equal(byNo(p.devices, 1).serialNumber, 'PF01SN001', 'serial trimmed and uppercased');
  assert.equal(byNo(p.devices, 1).model, 'Lenovo IdeaPad Slim 5', 'Brand / Model stays one field');
  assert.deepEqual(p.counts.devices.byStatus, { assigned: 6, available: 2, damaged: 1, retired: 1 });
});

test('people: email → name → new; a name-only match defaults to LINK and can be switched to new (rule 8)', () => {
  const p = plan();
  const [ani, budi, citra, dewi, eko] = p.people;
  assert.equal(ani.action, 'link');
  assert.equal(ani.match.by, 'email');
  assert.equal(budi.action, 'link');
  assert.equal(budi.nameOnly, true);
  assert.deepEqual(budi.choices, ['link', 'new']);
  assert.match(budi.issues.find((i) => i.code === 'NAME_MATCH').message, /Kemungkinan sama dengan akun "Budi Santoso"/);
  assert.equal(citra.action, 'new');
  assert.equal(citra.emailDropped, true, 'a personal gmail is never imported');
  assert.equal(citra.workEmail, null);
  assert.equal(dewi.action, 'exists');
  assert.deepEqual(dewi.differences, [{ field: 'position', label: 'Jabatan', current: 'Admin', incoming: 'Admin Gudang' }]);
  assert.equal(eko.status, 'resigned');
  assert.equal(eko.action, 'new');
  assert.equal(p.counts.people.new, 2);
  assert.equal(p.counts.people.link, 2);
  assert.equal(p.counts.people.exists, 1);
  assert.equal(p.counts.people.resigned, 1);

  const switched = plan({ ...buildReport(), personChoices: { [budi.key]: 'new' } });
  assert.equal(switched.people[1].action, 'new');
  assert.notEqual(switched.fingerprint, p.fingerprint, 'the choice is part of what is confirmed');
});

test('holders: accounts and file people resolve, teams and other companies become labels (rules 8, 15)', () => {
  const p = plan();
  assert.deepEqual(byNo(p.devices, 1).holder, { kind: 'user', userId: 30, name: 'Ani Wijaya', by: 'name', resigned: false });
  assert.equal(byNo(p.devices, 2).holder.userId, 31);
  const citra = byNo(p.devices, 3).holder;
  assert.equal(citra.kind, 'new_person', 'a person of the same file, applied first');
  assert.equal(citra.newPersonKey, p.people[2].key);
  assert.deepEqual(byNo(p.devices, 4).holder, { kind: 'label', label: 'Ops Team', name: 'Ops Team', otherCompany: null });
  const igs = byNo(p.devices, 9);
  assert.equal(igs.holder.kind, 'label');
  assert.ok(codes(igs).includes('HOLDER_OTHER_COMPANY'));
  // Not Aktif: no holder; the report's name is kept in the notes.
  const damaged = byNo(p.devices, 8);
  assert.equal(damaged.holder, null);
  assert.match(damaged.notes, /Layar pecah · Pemakai di laporan: Eko Prasetyo/);
  assert.deepEqual(p.counts.devices.holders, { user: 3, new_person: 1, label: 2 });
});

test('Aktif without a User Name is recorded Cadangan, with a warning', () => {
  const rows = [['Laptop', 'X1', 'SNX1', null, 2024, null, 'PFN Office', 'PFN', 'Active', null]];
  const p = plan({ devices: deviceSheet(rows), people: null });
  assert.equal(p.devices[0].status, 'available');
  assert.ok(codes(p.devices[0]).includes('ACTIVE_WITHOUT_HOLDER'));
});

test('asset codes may repeat (rule 16): warned, never refused', () => {
  const p = plan();
  for (const n of [1, 2]) {
    const row = byNo(p.devices, n);
    assert.equal(row.action, 'new');
    assert.match(row.issues.find((i) => i.code === 'ASSET_CODE_SHARED').message, /Nomor aset LAP\/PFN\/2024\/002 dipakai 2 perangkat/);
  }
  assert.deepEqual(p.counts.devices.sharedAssetCodes, [{ assetCode: 'LAP/PFN/2024/002', rows: [4, 5] }]);
});

test('locations: unknown ones are listed and only created when the user ticks it', () => {
  const p = plan();
  assert.deepEqual(p.newLocations, ['Alsut Office', 'Gudang Cikarang']);
  assert.ok(codes(byNo(p.devices, 3)).includes('LOCATION_NEW'));
  assert.equal(byNo(p.devices, 1).locationId, 1);
  const withNew = plan({ ...buildReport(), createLocations: true });
  assert.equal(byNo(withNew.devices, 3).locationNew, true);
  assert.notEqual(withNew.fingerprint, p.fingerprint);
});

// A context that holds what applying the plan would have created.
function afterImport(p) {
  const ctx = CONTEXT();
  ctx.locations.push({ id: 2, name: 'Alsut Office', is_active: 1 });
  ctx.devices = p.devices.filter((d) => d.action === 'new').map((d, i) => ({
    id: 100 + i, serial_key: d.serialNumber, device_type: d.deviceType, model: d.model, asset_code: d.assetCode,
    purchase_year: d.purchaseYear, location_name: d.locationText === 'Gudang Cikarang' ? null : d.locationText,
    status: d.status, notes: d.notes, holder_name: d.holder ? d.holder.name : null,
  }));
  return ctx;
}

test('identity: serial number, else type + model + asset no. + holder; a re-import of the same file changes nothing', () => {
  const first = plan();
  const again = plan(buildReport(), afterImport(first));
  const byAction = again.devices.reduce((m, d) => ({ ...m, [d.action]: (m[d.action] || 0) + 1 }), {});
  assert.deepEqual(byAction, { exists: 10 });
  const noSerial = byNo(again.devices, 7);
  assert.equal(noSerial.existingDeviceId, 106);
  assert.ok(codes(noSerial).includes('NO_SERIAL'), '"tanpa nomor seri, periksa manual"');
  const withDiffs = again.devices.filter((d) => d.differences.length).map((d) => [d.no, d.differences.map((x) => x.field)]);
  assert.deepEqual(withDiffs, [['10', ['location']]], 'only the location the first run could not create differs');
});

test('re-import: differences are listed per row, nothing changes without an explicit "perbarui" (rule 18)', () => {
  const first = plan();
  const devices = DEVICES.map((r) => [...r]);
  devices[0][8] = 'Damaged';           // row 1: Active → Damaged
  devices[4][1] = 'Zebra ZD230 Plus';   // row 5: model changed
  const again = plan(buildReport({ devices }), afterImport(first));
  const row1 = byNo(again.devices, 1);
  assert.equal(row1.action, 'exists');
  assert.deepEqual(row1.differences.map((d) => [d.field, d.current, d.incoming]), [
    ['status', 'Aktif', 'Rusak'], ['holder', 'Ani Wijaya', null], ['notes', null, 'Pemakai di laporan: Ani Wijaya'],
  ]);
  assert.deepEqual(byNo(again.devices, 5).differences.map((d) => d.field), ['model']);
  assert.equal(again.counts.devices.updatable, 3);
});

test('a serial number twice in the file: the second row is refused', () => {
  const devices = DEVICES.map((r) => [...r]);
  devices[1][2] = 'pf01sn001 ';
  const p = plan(buildReport({ devices }));
  const second = byNo(p.devices, 2);
  assert.equal(second.action, 'skip');
  assert.match(second.issues.find((i) => i.code === 'SERIAL_DUPLICATE_IN_FILE').message, /baris 4/);
});

test('the report code of the entity: initials of its name, or IT_REPORT_ENTITY_CODE', async () => {
  assert.equal(importer.initials('Prakasa Foods Nusantara'), 'PFN');
  assert.equal(importer.initials('  PT. Indo Sea  Sejahtera '), 'PISS');
  const db = { query: async () => [[{ name: 'Prakasa Foods Nusantara' }]] };
  assert.equal(await importer.entityReportCode(db, 1, {}), 'PFN');
  assert.equal(await importer.entityReportCode(db, 1, { IT_REPORT_ENTITY_CODE: ' pfn2 ' }), 'PFN2');
});

// ------------------------------------------------------------ apply

function applyConn(context = CONTEXT()) {
  let nextId = 700;
  const calls = [];
  const conn = {
    calls,
    async query(sql, args = []) {
      const s = String(sql);
      calls.push({ sql: s, args });
      if (/SELECT name FROM entities/.test(s)) return [[{ name: 'Prakasa Foods Nusantara' }]];
      if (/FROM users WHERE entity_id = \?/.test(s)) return [context.users.map((u) => ({ ...u, deleted: u.deleted ? 1 : 0 }))];
      if (/FROM people_directory p LEFT JOIN users u ON u\.id = p\.user_id\s+WHERE p\.entity_id = \?/.test(s)) return [context.people];
      if (/SELECT id, name, is_active FROM org_locations/.test(s)) return [context.locations];
      if (/FROM devices d\s+LEFT JOIN org_locations loc/.test(s)) return [context.devices];
      if (/code = 'people_culture'/.test(s)) return [[{ id: 6 }]];
      if (/SELECT id, email, name FROM users WHERE id = \?/.test(s)) {
        const u = context.users.find((x) => x.id === Number(args[0]));
        return [u ? [u] : []];
      }
      if (/^\s*INSERT/i.test(s)) { nextId += 1; return [{ insertId: nextId, affectedRows: 1 }]; }
      if (/^\s*UPDATE/i.test(s)) return [{ affectedRows: 1 }];
      return [[]];
    },
  };
  return conn;
}

test('apply: the company code is checked on the server — any other code is refused', async () => {
  const p = plan();
  for (const companyCode of ['IGS', 'DJAYA77', '', undefined]) {
    const conn = applyConn();
    await assert.rejects(
      () => importer.apply(conn, { entityId: 1, actorId: 9, payload: { ...buildReport(), companyCode, fingerprint: p.fingerprint }, env: ENV }),
      (e) => e.code === 'COMPANY_CODE_MISMATCH' && e.status === 422,
    );
    assert.ok(!conn.calls.some((c) => /^\s*(INSERT|UPDATE)/i.test(c.sql)), 'nothing written');
  }
});

test('apply: refuses a plan different from the confirmed preview, and "perbarui" on a row without differences', async () => {
  const p = plan();
  await assert.rejects(
    () => importer.apply(applyConn(), { entityId: 1, actorId: 9, payload: { ...buildReport(), companyCode: 'PFN', fingerprint: 'f'.repeat(64) }, env: ENV }),
    (e) => e.code === 'IMPORT_STALE' && e.status === 409,
  );
  await assert.rejects(
    () => importer.apply(applyConn(), { entityId: 1, actorId: 9, payload: { ...buildReport(), companyCode: 'pfn', fingerprint: p.fingerprint, updates: ['d:4'] }, env: ENV }),
    (e) => e.code === 'UPDATE_KEY_INVALID',
  );
});

test('apply: people first, then devices whose holders are those people; every write logged on the same connection', async () => {
  const p = plan();
  const conn = applyConn();
  const out = await importer.apply(conn, {
    entityId: 1, actorId: 9, env: ENV,
    payload: { ...buildReport(), companyCode: 'PFN', fingerprint: p.fingerprint, updates: [p.people[3].key] },
  });
  assert.deepEqual(
    { ...out, fingerprint: undefined },
    {
      locationsCreated: 0, peopleCreated: 2, peopleLinked: 2, peopleUpdated: 1, devicesCreated: 10, devicesUpdated: 0,
      assignmentsCreated: 6, unchanged: 0, skipped: 0, companyCode: 'PFN', fingerprint: undefined,
    },
  );
  const firstDevice = conn.calls.findIndex((c) => /INSERT INTO devices/.test(c.sql));
  const lastPerson = conn.calls.map((c) => /INSERT INTO people_directory/.test(c.sql)).lastIndexOf(true);
  assert.ok(lastPerson < firstDevice, 'people before devices');
  // Locks are taken before the plan is read again.
  assert.match(conn.calls.find((c) => /FOR UPDATE/.test(c.sql)).sql, /people_directory/);
  // Citra's device goes to the person row created for her in the same run.
  const citraId = conn.calls.filter((c) => /INSERT INTO people_directory/.test(c.sql))
    .find((c) => c.args.includes('Citra Lestari'));
  assert.ok(citraId);
  const assignments = conn.calls.filter((c) => /INSERT INTO device_assignments/.test(c.sql));
  assert.equal(assignments.length, 6);
  assert.ok(assignments.some((c) => c.args[4] != null && c.args[3] == null), 'a person holder (no account)');
  assert.ok(assignments.some((c) => c.args[5] === 'Ops Team'), 'a team label');
  // New devices belong to People & Culture and to this entity only.
  for (const c of conn.calls.filter((x) => /INSERT INTO devices/.test(x.sql))) {
    assert.equal(c.args[0], 1);
    assert.equal(c.args[1], 6);
  }
  const resigned = conn.calls.find((c) => /INSERT INTO people_directory/.test(c.sql) && c.args.includes('Eko Prasetyo'));
  assert.match(resigned.sql, /DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\)/, 'no date in the file → the import day');
  assert.ok(resigned.args.includes('import'));
  const logs = conn.calls.filter((c) => /INSERT INTO activity_logs/.test(c.sql)).map((c) => c.args[2]);
  assert.ok(logs.includes('it_device_import.apply'));
  assert.ok(logs.includes('people_directory.import_update'), 'the explicit "perbarui" is logged');
  assert.equal(logs.filter((a) => a === 'device.import_create').length, 10);
});
