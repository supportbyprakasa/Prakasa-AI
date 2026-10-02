const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db/pool');
const directory = require('../src/services/peopleDirectory.service');
const { workEmailDomains, checkWorkEmail, PERSONAL_DOMAINS } = require('../src/services/workEmail');
const { STANDARD_ROLES, permissionsForStandardRole } = require('../src/config/standardOrganization');

// People & Culture wave 1, row 1.1 — the directory (docs/rancangan-people-culture-g1.md, Part 1).

const MIGRATIONS = path.join(__dirname, '../migrations');
const read = (f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const ENV = { GOOGLE_ALLOWED_DOMAIN: 'prakasagroup.com, prakasafoods.com' };

// A connection double: answers by SQL pattern and records every statement.
function fakeConn(answer = () => null) {
  const calls = [];
  const conn = {
    calls,
    async query(sql, args = []) {
      const s = String(sql);
      calls.push({ sql: s, args });
      const out = answer(s, args, calls);
      if (out !== null && out !== undefined) return out;
      if (/^\s*(UPDATE|INSERT|DELETE)/i.test(s)) return [{ affectedRows: 1, insertId: 900 }];
      return [[]];
    },
    beginTransaction: async () => {}, commit: async () => { conn.committed = true; }, rollback: async () => { conn.rolledBack = true; }, release: () => {},
  };
  return conn;
}

// ------------------------------------------------------------ rule 2 / 5

test('migration 106: both tables are utf8mb4_0900_ai_ci, no unicode_ci column (rule 2)', () => {
  const sql = read('106_people_directory.sql');
  const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=(\w+);/g)];
  assert.deepEqual(tables.map((t) => t[1]), ['org_locations', 'people_directory']);
  for (const t of tables) {
    assert.equal(t[3], 'utf8mb4_0900_ai_ci', t[1]);
    assert.doesNotMatch(t[2], /unicode_ci/, `${t[1]} has no unicode_ci column`);
  }
});

test('migration 106: same-entity integrity and the checks of rules 3, 5, 6, 10', () => {
  const sql = read('106_people_directory.sql');
  assert.match(sql, /UNIQUE KEY uq_org_locations_entity_id \(entity_id, id\)/);
  assert.match(sql, /UNIQUE KEY uq_people_directory_entity_id \(entity_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(entity_id, manager_id\) REFERENCES people_directory\(entity_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(entity_id, location_id\) REFERENCES org_locations\(entity_id, id\)/);
  assert.match(sql, /UNIQUE KEY uq_people_directory_entity_user \(entity_id, user_id\)/);
  assert.match(sql, /UNIQUE KEY uq_people_directory_entity_email \(entity_id, work_email\)/);
  assert.match(sql, /name_key VARCHAR\(150\) GENERATED ALWAYS AS \(LOWER\(TRIM\(full_name\)\)\) STORED/);
  assert.match(sql, /KEY idx_people_directory_entity_name \(entity_id, name_key\)/);
  assert.match(sql, /kind <> 'excluded' OR CHAR_LENGTH\(TRIM\(COALESCE\(excluded_reason, ''\)\)\) > 0/);
  assert.match(sql, /user_id IS NOT NULL AND full_name IS NULL AND work_email IS NULL AND department_id IS NULL/, 'an account is never copied (rule 6)');
  assert.match(sql, /status = 'resigned' AND resigned_on IS NOT NULL AND resigned_on_source IS NOT NULL/, 'a resign always has a date (rule 10)');
  assert.match(sql, /resigned_on_source ENUM\('entered', 'import', 'account'\)/);
  // MySQL refuses CHECK (manager_id <> id) — id is AUTO_INCREMENT (error 3818); the service refuses it.
  assert.match(sql, /error 3818/);
});

test('no personal data: the directory has no salary, bank, NIK, NPWP, BPJS, address, birth date or credential column', () => {
  const sql = read('106_people_directory.sql') + read('107_it_assets_wave1.sql');
  const columns = [...sql.matchAll(/^\s+(\w+) (?:INT|VARCHAR|ENUM|DATE|TINYINT|TIMESTAMP|SMALLINT)/gm)].map((m) => m[1].toLowerCase());
  assert.ok(columns.includes('work_email') && columns.includes('work_phone'));
  for (const c of columns) {
    assert.doesNotMatch(c, /salary|gaji|bank|rekening|nik|ktp|npwp|bpjs|address|alamat|birth|lahir|password|sandi|username|credential/, c);
  }
});

// ------------------------------------------------------------ rule 9

test('work email domains come from GOOGLE_ALLOWED_DOMAIN (comma list, exact match after the last @)', () => {
  assert.deepEqual(workEmailDomains(ENV), ['prakasagroup.com', 'prakasafoods.com']);
  assert.deepEqual(checkWorkEmail('  Ani.Wijaya@PrakasaFoods.com ', ENV), { ok: true, email: 'ani.wijaya@prakasafoods.com' });
  assert.equal(checkWorkEmail('x@prakasagroup.com', ENV).ok, true);
  for (const bad of ['x@evil-prakasafoods.com', 'x@prakasafoods.com.evil.id', 'x@sub.prakasafoods.com', 'prakasafoods.com@evil.com', 'x@indoseas.com']) {
    assert.equal(checkWorkEmail(bad, ENV).code, 'WORK_EMAIL_DOMAIN', bad);
  }
  assert.equal(checkWorkEmail('bukan-email', ENV).code, 'WORK_EMAIL_INVALID');
});

test('work email: refused when the domain list is unset, and personal mailboxes are always refused', () => {
  assert.equal(checkWorkEmail('ani@prakasafoods.com', {}).code, 'WORK_EMAIL_DOMAINS_UNSET');
  assert.equal(checkWorkEmail('ani@prakasafoods.com', { GOOGLE_ALLOWED_DOMAIN: ' , ' }).code, 'WORK_EMAIL_DOMAINS_UNSET');
  for (const domain of ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.id', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'ymail.com']) {
    assert.ok(PERSONAL_DOMAINS.includes(domain));
    // Even a misconfiguration that lists gmail.com cannot let a personal mailbox in.
    assert.equal(checkWorkEmail(`ani@${domain}`, { GOOGLE_ALLOWED_DOMAIN: `${domain},prakasafoods.com` }).code, 'WORK_EMAIL_PERSONAL', domain);
  }
});

test('.env.example lists both company domains', () => {
  const env = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
  assert.match(env, /^GOOGLE_ALLOWED_DOMAIN=prakasagroup\.com,prakasafoods\.com$/m);
  assert.match(env, /^# ?IT_REPORT_ENTITY_CODE=/m);
});

// ------------------------------------------------------------ rule 11

test('permissions: everyone views the directory, only People & Culture Supervisor/Head manage it', () => {
  for (const role of STANDARD_ROLES) {
    assert.ok(role.permissions.includes('people.directory.view'), role.key);
    const manages = role.permissions.includes('people.directory.manage');
    assert.equal(manages, ['people_culture.supervisor', 'people_culture.head'].includes(role.key), role.key);
  }
  assert.ok(!permissionsForStandardRole('people_culture.member').includes('people.directory.manage'));
  const sql = read('106_people_directory.sql');
  assert.match(sql, /p\.code = 'people\.directory\.manage'\s+WHERE r\.deleted_at IS NULL AND r\.role_key IN \('people_culture\.supervisor', 'people_culture\.head'\)/);
  assert.match(sql, /r\.role_key = 'system\.super_admin'/);
});

test('a viewer sees work contacts only; kind, exclusion, resign details and notes are for People & Culture', () => {
  const row = {
    person_id: 4, user_id: null, full_name: 'Eko Prasetyo', work_email: null, department_id: '2', kind: 'employee',
    excluded_reason: null, position: 'Driver', manager_id: '3', work_phone: '0812', location_id: '1', status: 'resigned',
    resigned_on: '2026-09-30', resigned_on_source: 'import', notes: 'catatan', account_status: null, reviewed: 1,
    department_name: 'Operations', location_name: 'PFN Office', manager_name: 'Budi',
  };
  const viewer = directory.shapeEntry(row, false);
  for (const hidden of ['kind', 'excludedReason', 'resignedOn', 'resignedOnSource', 'notes', 'reviewed']) {
    assert.equal(hidden in viewer, false, hidden);
  }
  assert.equal(viewer.key, 'p4');
  assert.equal(viewer.departmentId, 2, 'mysql2 strings become numbers');
  assert.equal(viewer.managerKey, 'p3');
  assert.equal(viewer.hasAccount, false);
  const manager = directory.shapeEntry(row, true);
  assert.equal(manager.resignedOn, '2026-09-30');
  assert.equal(manager.resignedOnSourceLabel, 'Tanggal resign tidak ada di file');
  assert.equal(manager.notes, 'catatan');
});

test('list: bound to the caller\'s entity (twice: accounts and rows), viewers never see excluded or resigned people', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql: String(sql), args });
    return /COUNT\(\*\) AS total/.test(sql) ? [[{ total: '3' }]] : [[]];
  });
  const out = await directory.list(1, { status: 'resigned', kind: 'excluded', entityId: '99' }, { canManage: false });
  assert.equal(out.meta.total, 3);
  for (const c of calls) {
    assert.deepEqual(c.args.slice(0, 2), [1, 1]);
    assert.ok(!c.args.includes(99) && !c.args.includes('99'));
    assert.match(c.sql, /dir\.status = \?/);
    assert.match(c.sql, /dir\.kind <> 'excluded'/);
    assert.ok(c.args.includes('active') && !c.args.includes('resigned'));
    // Accounts of the entity (active ones, or any with a row) + rows without an account.
    assert.match(c.sql, /u\.entity_id = \? AND \(\(u\.deleted_at IS NULL AND u\.status = 'active'\) OR p\.id IS NOT NULL\)/);
    assert.match(c.sql, /p\.entity_id = \? AND p\.user_id IS NULL/);
  }
  calls.length = 0;
  await directory.list(1, { status: 'resigned', kind: 'excluded' }, { canManage: true });
  assert.ok(calls[0].args.includes('resigned') && calls[0].args.includes('excluded'), 'People & Culture filters by both');
});

test('headcount (rule 7): active employees incl. accounts without a row; excluded and group staff never count', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql: String(sql), args });
    return [[{ headcount: '31', unreviewed: '12', group_staff: '2', without_account: '11', resigned: '2', excluded: '5' }]];
  });
  assert.deepEqual(await directory.summary(1), {
    headcount: 31, unreviewedAccounts: 12, groupStaff: 2, withoutAccount: 11, resigned: 2, excluded: 5, upcoming: 0, leaving: 0,
  });
  const [{ sql, args }] = calls;
  assert.deepEqual(args, [1, 1]);
  // Date-aware (wave 2): working until the last day, counted from the join date.
  assert.match(sql, /SUM\(\(dir\.status = 'active' OR \(dir\.status = 'resigned' AND dir\.resigned_on >= DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\)\)\) AND dir\.kind = 'employee' AND \(dir\.starts_on IS NULL OR dir\.starts_on <= DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\)\)\) AS headcount/);
  assert.match(sql, /COALESCE\(p\.kind, 'employee'\) AS kind/, 'an account without a row is an employee');
  assert.match(sql, /dir\.user_id IS NOT NULL AND dir\.person_id IS NULL\) AS unreviewed/);
});

// ------------------------------------------------------------ rule 8

test('ensurePersonForUser: the account\'s own row, else a row with its email (linked, copies cleared), else a new row', async () => {
  // Own row.
  let conn = fakeConn((s) => {
    if (/FROM users WHERE id = \?/.test(s)) return [[{ id: 7, email: 'ani@prakasafoods.com', name: 'Ani' }]];
    if (/WHERE entity_id = \? AND user_id = \?/.test(s)) return [[{ id: 12 }]];
    return null;
  });
  assert.deepEqual(await directory.ensurePersonForUser(conn, 1, 7, 2), { id: 12, action: 'existing' });

  // Linked by work email.
  conn = fakeConn((s) => {
    if (/FROM users WHERE id = \?/.test(s)) return [[{ id: 7, email: 'Ani@PrakasaFoods.com', name: 'Ani' }]];
    if (/user_id IS NULL AND work_email = \?/.test(s)) return [[{ id: 15, full_name: 'Ani W', work_email: 'ani@prakasafoods.com', department_id: 3 }]];
    return null;
  });
  assert.deepEqual(await directory.ensurePersonForUser(conn, 1, 7, 2), { id: 15, action: 'linked' });
  const lookup = conn.calls.find((c) => /work_email = \?/.test(c.sql));
  assert.deepEqual(lookup.args, [1, 'ani@prakasafoods.com'], 'lowercased email, same entity');
  const link = conn.calls.find((c) => /^\s*UPDATE people_directory/.test(c.sql));
  assert.match(link.sql, /SET user_id = \?, full_name = NULL, work_email = NULL, department_id = NULL/);
  assert.ok(conn.calls.some((c) => /INSERT INTO activity_logs/.test(c.sql)), 'logged on the same connection (rule 4)');

  // New row, only when asked to create.
  conn = fakeConn((s) => (/FROM users WHERE id = \?/.test(s) ? [[{ id: 7, email: 'ani@prakasafoods.com', name: 'Ani' }]] : null));
  assert.equal(await directory.ensurePersonForUser(conn, 1, 7, 2, { create: false }), null, 'linkAccount never creates');
  const created = await directory.ensurePersonForUser(conn, 1, 7, 2);
  assert.equal(created.action, 'created');
  assert.match(conn.calls.find((c) => /INSERT INTO people_directory/.test(c.sql)).sql, /ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID\(id\)/);

  // Another entity's account is not found.
  conn = fakeConn();
  assert.equal(await directory.ensurePersonForUser(conn, 1, 7, 2), null);
  assert.deepEqual(conn.calls[0].args, [7, 1]);
});

test('users: creating an account or changing its email attaches it to its directory entry; deactivating resigns it', async (t) => {
  const bcrypt = require('bcryptjs');
  const users = require('../src/controllers/users.controller');
  const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  t.mock.method(bcrypt, 'hash', async () => 'hash');
  t.mock.method(pool, 'query', async () => [{ affectedRows: 1 }]);

  const conn = fakeConn((s) => {
    if (s.includes('INSERT INTO users')) return [{ insertId: 44 }];
    if (/FROM users WHERE id = \? AND entity_id = \?/.test(s)) return [[{ id: 44, email: 'new@prakasafoods.com', name: 'New' }]];
    return null;
  });
  t.mock.method(pool, 'getConnection', async () => conn);
  const r1 = res();
  await users.create({ body: { name: 'New', email: 'New@prakasafoods.com', entityId: 1 }, user: { sub: 1 } }, r1, (e) => { throw e; });
  assert.equal(r1.statusCode, 201);
  const linkQuery = conn.calls.find((c) => /user_id IS NULL AND work_email = \?/.test(c.sql));
  assert.deepEqual(linkQuery.args, [1, 'new@prakasafoods.com']);
  assert.ok(!conn.calls.some((c) => /INSERT INTO people_directory/.test(c.sql)), 'no row is created for a plain new account');
  const commitIndex = conn.calls.length;
  assert.ok(commitIndex > 0 && conn.committed);

  const conn2 = fakeConn((s) => {
    if (s.includes('FOR UPDATE') && s.includes('FROM users')) return [[{ id: 20, entity_id: 1, department_id: null, email: 'old@prakasafoods.com', status: 'active' }]];
    if (s.includes('system.super_admin')) return [[{ total: 1 }]];
    if (/FROM users WHERE id = \? AND entity_id = \?/.test(s)) return [[{ id: 20, email: 'x@prakasafoods.com', name: 'X' }]];
    if (/WHERE entity_id = \? AND user_id = \?/.test(s)) return [[{ id: 31 }]];
    return null;
  });
  t.mock.method(pool, 'getConnection', async () => conn2);
  const r2 = res();
  await users.update({ params: { id: '20' }, body: { status: 'inactive' }, user: { sub: 1, entityId: 1 } }, r2, (e) => { throw e; });
  assert.equal(r2.statusCode, 200);
  const resign = conn2.calls.find((c) => /SET status = 'resigned'/.test(c.sql));
  assert.ok(resign, 'the deactivated account resigns in the directory');
  assert.match(resign.sql, /resigned_on = DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\), resigned_on_source = 'account'/);
  assert.deepEqual(resign.args, [1, 31, 1]);
});

// ------------------------------------------------------------ rule 3

test('manager cycles are refused, including a person managing themself', () => {
  const managers = new Map([[1, null], [2, 1], [3, 2], [4, 3]]);
  assert.equal(directory.createsCycle(managers, 1, 4), true, '1 → 4 → 3 → 2 → 1');
  assert.equal(directory.createsCycle(managers, 1, 1), true);
  assert.equal(directory.createsCycle(managers, 4, 1), false);
  assert.equal(directory.createsCycle(new Map([[5, 6], [6, 5]]), 7, 5), true, 'never extends an existing loop');
});

function updateConn(rows, extra = () => null) {
  return fakeConn((s, args) => {
    if (/SELECT id, manager_id FROM people_directory WHERE entity_id = \? ORDER BY id FOR UPDATE/.test(s)) {
      return [rows.map((r) => ({ id: r.id, manager_id: r.manager_id }))];
    }
    if (/SELECT \* FROM people_directory WHERE id = \? AND entity_id = \?/.test(s)) {
      return [[rows.find((r) => r.id === Number(args[0]))].filter(Boolean)];
    }
    if (/FROM people_directory p LEFT JOIN users u ON u\.id = p\.user_id\s+WHERE p\.id = \? AND p\.entity_id = \?/.test(s)) {
      const r = rows.find((x) => x.id === Number(args[0]));
      return [r ? [{ id: r.id, kind: r.kind || 'employee', status: r.status || 'active', account_status: null, account_deleted: null }] : []];
    }
    return extra(s, args);
  });
}

const person = (id, managerId = null, more = {}) => ({
  id, entity_id: 1, user_id: null, kind: 'employee', excluded_reason: null, full_name: `P${id}`, position: null,
  department_id: null, manager_id: managerId, work_email: null, work_phone: null, location_id: null,
  status: 'active', resigned_on: null, resigned_on_source: null, notes: null, ...more,
});

test('update: the manager check runs in a transaction that locks the entity\'s rows (rule 3)', async (t) => {
  const rows = [person(1), person(2, 1), person(3, 2)];
  let conn = updateConn(rows);
  t.mock.method(pool, 'getConnection', async () => conn);
  await assert.rejects(() => directory.update(1, 9, 'p1', { managerKey: 'p3' }), (e) => e.code === 'MANAGER_CYCLE' && e.status === 409);
  assert.ok(conn.rolledBack && !conn.committed);
  assert.match(conn.calls[0].sql, /FOR UPDATE/);
  assert.deepEqual(conn.calls[0].args, [1]);

  conn = updateConn(rows);
  await assert.rejects(() => directory.update(1, 9, 'p2', { managerKey: 'p2' }), (e) => e.code === 'MANAGER_SELF');

  conn = updateConn(rows);
  const out = await directory.update(1, 9, 'p3', { managerKey: 'p1', position: '  Kepala   Gudang ' });
  assert.deepEqual(out.changed.sort(), ['managerId', 'position']);
  const write = conn.calls.find((c) => /^\s*UPDATE people_directory SET/.test(c.sql));
  assert.ok(write.args.includes('Kepala Gudang'), 'names and texts are trimmed before every write (rule 2)');
  const logged = conn.calls.find((c) => /INSERT INTO activity_logs/.test(c.sql));
  assert.ok(logged, 'logged on the transaction connection (rule 4)');
  assert.deepEqual(JSON.parse(logged.args[5]).before, { managerId: 2, position: null });
  assert.ok(conn.committed);
});

test('update: an account\'s name/email/division are never written to the directory (rule 6)', async (t) => {
  const conn = updateConn([person(5, null, { user_id: 7, full_name: null })]);
  t.mock.method(pool, 'getConnection', async () => conn);
  await assert.rejects(() => directory.update(1, 9, 'p5', { name: 'Lain' }), (e) => e.code === 'ACCOUNT_FIELDS');
  await assert.rejects(() => directory.update(1, 9, 'p5', { departmentId: 3 }), (e) => e.code === 'ACCOUNT_FIELDS');
});

test('update: resign needs a date (rule 10), exclusion needs a reason (rule 7)', async (t) => {
  let conn = updateConn([person(6)]);
  t.mock.method(pool, 'getConnection', async () => conn);
  await assert.rejects(() => directory.update(1, 9, 'p6', { status: 'resigned' }), (e) => e.code === 'RESIGN_DATE_REQUIRED');
  conn = updateConn([person(6)]);
  await assert.rejects(() => directory.update(1, 9, 'p6', { kind: 'excluded' }), (e) => e.code === 'EXCLUDED_REASON_REQUIRED');
  conn = updateConn([person(6)]);
  await directory.update(1, 9, 'p6', { status: 'resigned', resignedOn: '2026-09-15' });
  const write = conn.calls.find((c) => /^\s*UPDATE people_directory SET/.test(c.sql));
  assert.match(write.sql, /status = \?, resigned_on = \?, resigned_on_source = \?/);
  assert.ok(write.args.includes('entered'));
});

test('create: same name as an account or a row needs an explicit confirmation; personal email refused', async (t) => {
  const before = process.env.GOOGLE_ALLOWED_DOMAIN;
  process.env.GOOGLE_ALLOWED_DOMAIN = ENV.GOOGLE_ALLOWED_DOMAIN;
  try {
    let conn = fakeConn((s) => (/LOWER\(TRIM\(u\.name\)\) = \?/.test(s) ? [[{ t: 'u', id: 40, name: 'Selin Kusno' }]] : null));
    t.mock.method(pool, 'getConnection', async () => conn);
    await assert.rejects(() => directory.createPerson(1, 9, { name: ' selin  kusno ' }), (e) => e.code === 'NAME_EXISTS' && e.details.key === 'u40');
    const dup = conn.calls.find((c) => /LOWER\(TRIM\(u\.name\)\)/.test(c.sql));
    assert.deepEqual(dup.args, [1, 'selin kusno', 1, 'selin kusno']);

    conn = fakeConn();
    await assert.rejects(() => directory.createPerson(1, 9, { name: 'Baru', workEmail: 'baru@gmail.com' }), (e) => e.code === 'WORK_EMAIL_PERSONAL');

    conn = fakeConn((s) => (/FROM users WHERE entity_id = \? AND email = \?/.test(s) ? [[{ id: 41, name: 'Ani' }]] : null));
    await assert.rejects(() => directory.createPerson(1, 9, { name: 'Ani 2', workEmail: 'ani@prakasafoods.com', confirmDuplicateName: true }), (e) => e.code === 'WORK_EMAIL_IS_ACCOUNT' && e.status === 409);

    conn = fakeConn((s, args) => (/SELECT \* FROM people_directory WHERE id = \?/.test(s) ? [[person(900, null, { full_name: 'Baru' })]] : null));
    const out = await directory.createPerson(1, 9, { name: 'Baru', workEmail: 'Baru@PrakasaFoods.com', position: 'Driver' });
    assert.deepEqual(out, { key: 'p900', personId: 900 });
    const insert = conn.calls.find((c) => /INSERT INTO people_directory/.test(c.sql));
    assert.deepEqual(insert.args.slice(0, 3), [1, 'Baru', 'baru@prakasafoods.com']);
  } finally {
    if (before === undefined) delete process.env.GOOGLE_ALLOWED_DOMAIN; else process.env.GOOGLE_ALLOWED_DOMAIN = before;
  }
});

test('directory keys: p<id> is a row, u<id> an account without a row; anything else is refused', () => {
  assert.deepEqual(directory.parseKey('p12'), { personId: 12 });
  assert.deepEqual(directory.parseKey('u7'), { userId: 7 });
  for (const bad of ['12', 'x1', 'p', 'p1;DROP', '', null]) assert.equal(directory.parseKey(bad), null, String(bad));
});

test('routes: every directory endpoint needs a directory permission; writes and import need manage', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/people.routes.js'), 'utf8');
  // /settings/pic is the onboarding/offboarding PIC setting (wave 2), guarded by hrga.checklist_template.manage.
  const lines = src.split('\n').filter((l) => /^router\.(get|post|patch|delete)\(/.test(l) && !/^router\.(get|put)\('\/settings\//.test(l));
  assert.ok(lines.length >= 8);
  for (const l of lines) {
    if (/^router\.get/.test(l)) assert.match(l, /requirePermission\('people\.directory\.view'\)/, l);
    else assert.match(l, /requirePermission\('people\.directory\.manage'\)/, l);
  }
  assert.match(src, /router\.post\('\/directory\/import\/preview'/);
  assert.match(src, /router\.post\('\/directory\/import\/apply'/);
});
