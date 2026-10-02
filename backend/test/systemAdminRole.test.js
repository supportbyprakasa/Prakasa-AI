const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db/pool');
const rolePolicy = require('../src/services/rolePolicy.service');
const usersController = require('../src/controllers/users.controller');
const { SYSTEM_ADMIN_PERMISSIONS, GLOBAL_ROLE_KEYS } = require('../src/config/standardOrganization');

// Administrator Sistem (owner, 1 Oct 2026): a global role tied to no division
// that configures the system and reads no division's data.

// Codes listed after `p.code IN (` in a migration.
const codesIn = (file, end) => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8');
  const list = sql.slice(sql.indexOf('p.code IN ('), end ? sql.indexOf(end) : undefined);
  return { sql, codes: [...list.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]) };
};
const REVOKED = ['integration.accurate.manage', 'ai.provider.manage', 'ai.routing.manage', 'ai.config.manage'];

test('migration 112 minus migration 123 equals the configured permission list', () => {
  const { sql, codes } = codesIn('112_system_admin_role.sql', ')\n WHERE');
  const revoked = codesIn('123_system_admin_scope.sql', ');').codes;
  assert.deepEqual([...revoked].sort(), [...REVOKED].sort());
  assert.deepEqual(codes.filter((c) => !revoked.includes(c)).sort(), [...SYSTEM_ADMIN_PERMISSIONS].sort());
  for (const code of REVOKED) assert.equal(SYSTEM_ADMIN_PERMISSIONS.includes(code), false, code);
  assert.match(sql, /'system\.admin', 'admin'/);
  assert.match(sql, /NULL, 'Administrator Sistem'/, 'no division');
});

test('no permission that reads division data', () => {
  const DATA = [
    /^sales\./, /^warehouse\./, /^procurement\./, /^finance\./, /^hrga\./, /^ga\./, /^device\./, /^subscription\./,
    /^software_vendor\./, /^it\.(dashboard|infra)/, /^management_dashboard\./, /^activity_log\./, /^document\./,
    /^accurate\./, /^analytics\./, /^task\./, /^board\./, /^people\.directory\.manage/, /^ai_command\.(admin|private_audit|usage)/,
    /^entity\.cross_access/, /^workspace\./, /^it_ticket\.manage/, /^search\./, /^approval\./, /^signature\./, /^meeting\.ai_summary/,
  ];
  for (const code of SYSTEM_ADMIN_PERMISSIONS) {
    assert.equal(DATA.some((re) => re.test(code)), false, code);
  }
  assert.deepEqual(GLOBAL_ROLE_KEYS, ['system.super_admin', 'system.admin']);
});

test('the role needs no division', () => {
  const role = { id: 29, entity_id: 1, department_id: null, role_key: 'system.admin', role_level: 'admin', name: 'Administrator Sistem' };
  assert.deepEqual(rolePolicy.validateRoleAssignment({ entityId: 1, departmentId: null, roleRows: [role] }), [role]);
  assert.throws(() => rolePolicy.validateRoleAssignment({ entityId: 1, departmentId: null, roleRows: [{ ...role, role_key: 'custom.global' }] }));
});

// actorRoles: the actor's role keys (isSuperAdmin asks for system.super_admin).
const db = (actorRoles) => ({
  async query(sql, args) {
    if (/LIMIT 1/.test(sql) && args[1] === 'system.super_admin') return [actorRoles.includes('system.super_admin') ? [{ 1: 1 }] : []];
    return [[]];
  },
});
const SALES_HEAD = { role_key: 'sales.head' };
const SALES_MEMBER = { id: 41, role_key: 'sales.member', role_level: 'member' };
const SYSADMIN = { id: 29, role_key: 'system.admin', role_level: 'admin' };
const SUPER = { role_key: 'system.super_admin' };
const forbidden = (code) => (error) => error.status === 403 && error.code === code;

test('an Administrator Sistem cannot change their own roles or division', async () => {
  const connection = db(['system.admin']);
  await assert.rejects(rolePolicy.assertCanChangeAccount({ connection, actorId: 7, targetUserId: '7', nextRoles: [SALES_HEAD] }), forbidden('SELF_ACCESS_CHANGE'));
  await assert.rejects(rolePolicy.assertCanChangeAccount({ connection, actorId: 7, targetUserId: 7, changesDivision: true }), forbidden('SELF_ACCESS_CHANGE'));
  // Their own name or email: fine. Someone else's member role: fine (that is the job).
  await rolePolicy.assertCanChangeAccount({ connection, actorId: 7, targetUserId: 7, targetRoles: [SYSADMIN] });
  await rolePolicy.assertCanChangeAccount({ connection, actorId: 7, targetUserId: 8, targetRoles: [], nextRoles: [SALES_MEMBER] });
});

test('only a Super Admin grants, edits, resets or removes a Super Admin', async () => {
  const connection = db(['system.admin']);
  await assert.rejects(rolePolicy.assertCanChangeAccount({ connection, actorId: 7, targetUserId: 8, nextRoles: [SUPER] }), forbidden('SUPER_ADMIN_ONLY'));
  await assert.rejects(rolePolicy.assertCanChangeAccount({ connection, actorId: 7, targetUserId: 1, targetRoles: [SUPER] }), forbidden('SUPER_ADMIN_ONLY'));
  await rolePolicy.assertCanChangeAccount({ connection: db(['system.super_admin']), actorId: 1, targetUserId: 1, targetRoles: [SUPER], nextRoles: [SALES_HEAD] });
});

test('the two global roles are changed by a Super Admin only', async () => {
  await assert.rejects(rolePolicy.assertCanChangeRole({ connection: db(['system.admin']), actorId: 7, roleKey: 'system.admin' }), forbidden('SUPER_ADMIN_ONLY'));
  await assert.rejects(rolePolicy.assertCanChangeRole({ connection: db(['system.admin']), actorId: 7, roleKey: 'system.super_admin' }), forbidden('SUPER_ADMIN_ONLY'));
  await rolePolicy.assertCanChangeRole({ connection: db(['system.admin']), actorId: 7, roleKey: 'sales.member' });
  await rolePolicy.assertCanChangeRole({ connection: db(['system.super_admin']), actorId: 1, roleKey: 'system.admin' });
});

// Passwords are managed by the Super Admin only (owner, 2 Oct 2026).
const resDouble = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('a password reset is Super Admin only: an Administrator Sistem gets 403 and nothing is written', async (t) => {
  const writes = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    const text = String(sql);
    if (/LIMIT 1/.test(text) && args?.[1] === 'system.super_admin') return [[]];
    if (/FROM user_roles/.test(text)) return [[SALES_MEMBER]];
    writes.push(text);
    return [{ affectedRows: 1 }];
  });
  const res = resDouble();
  // Even for a plain member account the administrator could otherwise edit.
  await usersController.resetPassword({ params: { id: '8' }, body: { password: 'sementara-123' }, user: { sub: 7, entityId: 1 } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body.error, { code: 'SUPER_ADMIN_ONLY', message: 'Hanya Super Admin yang bisa mereset kata sandi' });
  assert.deepEqual(writes, [], 'no password written, no log entry');
});

test('a password reset by a Super Admin works and is always temporary', async (t) => {
  const writes = [];
  const logs = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    const text = String(sql);
    if (/LIMIT 1/.test(text) && args?.[1] === 'system.super_admin') return [[{ 1: 1 }]];
    if (/UPDATE users/.test(text)) { writes.push({ text, args }); return [{ affectedRows: 1 }]; }
    if (/activity_logs/.test(text)) logs.push(args);
    return [{ affectedRows: 1 }];
  });
  const res = resDouble();
  // `mustChangePassword: false` no longer makes it permanent.
  await usersController.resetPassword({ params: { id: '8' }, body: { password: 'sementara-123', mustChangePassword: false }, user: { sub: 1, entityId: 1 } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 200);
  assert.equal(writes.length, 1);
  assert.match(writes[0].text, /must_change_password = \?, password_changed_at = NOW\(\)/);
  assert.equal(writes[0].args[1], 1, 'must change at next sign-in');
  assert.equal(writes[0].args[2], '8');
  assert.match(JSON.stringify(logs), /user\.password_reset/);
  assert.equal(JSON.stringify(logs).includes('sementara-123'), false, 'the log holds no password');
});

// Puppet accounts (security review, Oct 2026): below Super Admin only member
// roles are newly granted, and global roles are never granted.
test('an Administrator Sistem grants member roles only; Head, Supervisor, custom and global roles need a Super Admin', async () => {
  const connection = db(['system.admin']);
  for (const role of [SALES_HEAD, { id: 42, role_key: 'sales.supervisor', role_level: 'supervisor' }, { id: 43, role_key: 'x', role_level: 'custom', name: 'Khusus' }, SYSADMIN]) {
    await assert.rejects(
      rolePolicy.assertCanChangeAccount({ connection, actorId: 7, targetUserId: null, nextRoles: [role] }),
      forbidden('SUPER_ADMIN_ONLY'),
      role.role_key,
    );
  }
  // A Head role the account already has (granted by a Super Admin) may stay
  // while a member role is added, or be removed.
  const head = { id: 44, role_key: 'sales.head', role_level: 'head' };
  await rolePolicy.assertCanChangeAccount({ connection, actorId: 7, targetUserId: 8, targetRoles: [head], nextRoles: [head, SALES_MEMBER] });
  await rolePolicy.assertCanChangeAccount({ connection, actorId: 7, targetUserId: 8, targetRoles: [head], nextRoles: [] });
  // Another Administrator Sistem's account is Super Admin only.
  await assert.rejects(rolePolicy.assertCanChangeAccount({ connection, actorId: 7, targetUserId: 9, targetRoles: [SYSADMIN] }), forbidden('SUPER_ADMIN_ONLY'));
  // A Super Admin may do all of it.
  await rolePolicy.assertCanChangeAccount({ connection: db(['system.super_admin']), actorId: 1, targetUserId: null, nextRoles: [SALES_HEAD, SYSADMIN] });
});

// Creating an account: a Super Admin sets a temporary password; anyone else
// creates Google sign-in accounts only.
function createConn(superAdmin, inserts) {
  return {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, args) {
      const text = String(sql);
      if (/LIMIT 1/.test(text) && args?.[1] === 'system.super_admin') return [superAdmin ? [{ 1: 1 }] : []];
      if (/FROM roles r/.test(text)) return [[{ id: 41, name: 'Sales Member', entity_id: 1, department_id: 3, role_key: 'sales.member', role_level: 'member', department_entity_id: 1 }]];
      if (/INSERT INTO users/.test(text)) { inserts.push(args); return [{ insertId: 90 }]; }
      return [[]];
    },
  };
}
const NEW_USER = { name: 'Boneka', email: 'b@x.test', entityId: 1, departmentId: 3, roleIds: [41] };

test('an Administrator Sistem cannot create an account with a password, only a Google sign-in account', async (t) => {
  const inserts = [];
  t.mock.method(pool, 'getConnection', async () => createConn(false, inserts));
  t.mock.method(pool, 'query', async () => [[]]);

  const refused = resDouble();
  await usersController.create({ body: { ...NEW_USER, password: 'Sementara123' }, user: { sub: 7, entityId: 1 } }, refused, (e) => { throw e; });
  assert.equal(refused.statusCode, 403);
  assert.deepEqual(refused.body.error, { code: 'SUPER_ADMIN_ONLY', message: 'Hanya Super Admin yang bisa mengatur kata sandi' });
  assert.deepEqual(inserts, []);

  const res = resDouble();
  await usersController.create({ body: NEW_USER, user: { sub: 7, entityId: 1 } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 201);
  assert.equal(inserts[0][4], null, 'no password_hash: Google sign-in only');
  assert.equal(inserts[0][5], 0, 'nothing to replace at sign-in');
});

test('a user created by a Super Admin with a password always gets a temporary one', async (t) => {
  const inserts = [];
  t.mock.method(pool, 'getConnection', async () => createConn(true, inserts));
  t.mock.method(pool, 'query', async () => [[]]);
  const res = resDouble();
  await usersController.create({ body: { ...NEW_USER, password: 'Sementara123', mustChangePassword: false }, user: { sub: 1, entityId: 1 } }, res, (e) => { throw e; });
  assert.equal(res.statusCode, 201);
  assert.match(String(inserts[0][4]), /^\$2[aby]\$/, 'a bcrypt hash, never the password');
  assert.equal(inserts[0][5], 1, 'must_change_password is always 1');
});
