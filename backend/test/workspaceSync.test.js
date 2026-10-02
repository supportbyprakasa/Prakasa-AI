const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const directory = require('../src/services/googleDirectory.service');
const drive = require('../src/services/googleDrive.service');
const folderMappingRules = require('../src/controllers/folderMappingRules.controller');
const ctrl = require('../src/controllers/workspaceSync.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function baseUser(overrides = {}) {
  return { sub: 10, entityId: 1, permissions: ['user.manage'], ...overrides };
}

test('fetchCandidates stages Workspace members not already in users, skips existing ones', async (t) => {
  t.mock.method(directory, 'listDomainUsers', async () => ([
    { email: 'new.person@prakasafoods.com', name: 'New Person', orgUnitPath: '/PFN', isAdmin: false },
    { email: 'existing@prakasafoods.com', name: 'Existing', orgUnitPath: '/PFN', isAdmin: false },
  ]));

  const inserts = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    const s = String(sql);
    if (s.includes('SELECT email FROM users')) return [[{ email: 'existing@prakasafoods.com' }]];
    if (s.includes('INSERT INTO workspace_sync_candidates')) {
      inserts.push(args);
      return [{ affectedRows: 1, insertId: inserts.length }];
    }
    return [[]];
  });

  const req = { user: baseUser() };
  const res = responseDouble();
  await ctrl.fetchCandidates(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.found, 2);
  assert.equal(res.body.data.staged, 1);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][1], 'new.person@prakasafoods.com');
});

test('fetchCandidates reports a clear error when GOOGLE_ADMIN_DELEGATED_USER is missing', async (t) => {
  t.mock.method(directory, 'listDomainUsers', async () => {
    const error = new Error('GOOGLE_ADMIN_DELEGATED_USER belum diisi di .env');
    error.code = 'GOOGLE_ADMIN_NOT_CONFIGURED';
    throw error;
  });

  const req = { user: baseUser() };
  const res = responseDouble();
  await ctrl.fetchCandidates(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'GOOGLE_ADMIN_NOT_CONFIGURED');
});

test('updateCandidate stages department + role on a pending candidate', async (t) => {
  let updateArgs = null;
  t.mock.method(pool, 'query', async (sql, args) => {
    if (String(sql).includes('UPDATE workspace_sync_candidates')) {
      updateArgs = args;
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  const req = { user: baseUser(), params: { id: '5' }, body: { departmentId: 3, roleId: 24 } };
  const res = responseDouble();
  await ctrl.updateCandidate(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(updateArgs, [3, 24, '5', 1]);
});

test('applyCandidate refuses when department/role were never set', async (t) => {
  const conn = {
    query: async (sql) => {
      if (String(sql).includes('SELECT * FROM workspace_sync_candidates')) {
        return [[{ id: 5, entity_id: 1, email: 'x@prakasafoods.com', name: 'X', department_id: null, role_id: null, status: 'pending' }]];
      }
      return [[]];
    },
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
  t.mock.method(pool, 'getConnection', async () => conn);

  const req = { user: baseUser(), params: { id: '5' }, body: {} };
  const res = responseDouble();
  await ctrl.applyCandidate(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

// Passwords are managed by the Super Admin only: the temporary password is
// made (and returned) for a Super Admin; anyone else creates a Google sign-in
// account without one.
function applyConn(superAdmin, queries, inserts) {
  return {
    query: async (sql, args) => {
      queries.push(String(sql));
      if (String(sql).includes('SELECT * FROM workspace_sync_candidates')) {
        return [[{ id: 5, entity_id: 1, email: 'new.person@prakasafoods.com', name: 'New Person', department_id: null, role_id: null, status: 'pending' }]];
      }
      if (args?.[1] === 'system.super_admin') return [superAdmin ? [{ 1: 1 }] : []];
      if (String(sql).includes('INSERT INTO users')) { inserts.push(args); return [{ insertId: 99 }]; }
      if (String(sql).includes('WHERE r.id IN')) return [[{ id: 15, entity_id: 1, department_id: 6, role_key: 'sales.member', role_level: 'member', name: 'Sales Member' }]];
      return [{ affectedRows: 1 }];
    },
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
}

test('applyCandidate creates the real account, assigns the role, and marks the candidate applied', async (t) => {
  const queries = [];
  const inserts = [];
  t.mock.method(pool, 'getConnection', async () => applyConn(true, queries, inserts));
  t.mock.method(pool, 'query', async () => [{ affectedRows: 1 }]); // activityLog.service's own pool.query call

  const req = { user: baseUser(), params: { id: '5' }, body: { departmentId: 6, roleId: 15 } };
  const res = responseDouble();
  await ctrl.applyCandidate(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.userId, 99);
  assert.equal(res.body.data.email, 'new.person@prakasafoods.com');
  // A Super Admin gets a temporary password to hand over.
  assert.ok(res.body.data.password.length >= 10);
  assert.equal(inserts[0][5], 1, 'must be replaced at first sign-in');
  assert.ok(queries.some((q) => q.includes('INTO user_roles')));
  assert.ok(queries.some((q) => q.includes("status='applied'")));
});

test('applyCandidate below Super Admin creates a Google sign-in account: no password is made or returned', async (t) => {
  const queries = [];
  const inserts = [];
  t.mock.method(pool, 'getConnection', async () => applyConn(false, queries, inserts));
  t.mock.method(pool, 'query', async () => [{ affectedRows: 1 }]);

  const res = responseDouble();
  await ctrl.applyCandidate({ user: baseUser(), params: { id: '5' }, body: { departmentId: 6, roleId: 15 } }, res, (e) => { throw e; });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.password, null);
  assert.equal(inserts[0][4], null, 'no password_hash');
  assert.equal(inserts[0][5], 0, 'nothing to replace at sign-in');
  assert.ok(queries.some((q) => q.includes("status='applied'")));
});

test('applyCandidate grants Shared Drive access when a folder mapping exists for the department', async (t) => {
  const conn = {
    query: async (sql) => {
      if (String(sql).includes('SELECT * FROM workspace_sync_candidates')) {
        return [[{ id: 5, entity_id: 1, email: 'new.person@prakasafoods.com', name: 'New Person', department_id: null, role_id: null, status: 'pending' }]];
      }
      if (String(sql).includes('INSERT INTO users')) return [{ insertId: 99 }];
      if (String(sql).includes('WHERE r.id IN')) return [[{ id: 15, entity_id: 1, department_id: 6, role_key: 'sales.member', role_level: 'member', name: 'Sales Member' }]];
      return [{ affectedRows: 1 }];
    },
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
  t.mock.method(pool, 'getConnection', async () => conn);
  t.mock.method(pool, 'query', async () => [{ affectedRows: 1 }]);
  t.mock.method(folderMappingRules, 'resolveFolder', async () => 'folder-abc');
  const ensureCalls = [];
  t.mock.method(drive, 'ensureFolderMember', async (args) => { ensureCalls.push(args); return { added: true }; });

  const req = { user: baseUser(), params: { id: '5' }, body: { departmentId: 6, roleId: 15 } };
  const res = responseDouble();
  await ctrl.applyCandidate(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 201);
  assert.equal(ensureCalls.length, 1);
  assert.deepEqual(ensureCalls[0], { folderId: 'folder-abc', email: 'new.person@prakasafoods.com', role: 'fileOrganizer' });
  assert.deepEqual(res.body.data.driveAccess, { granted: true, added: true });
});

test('applyCandidate still succeeds when granting Shared Drive access fails', async (t) => {
  const conn = {
    query: async (sql) => {
      if (String(sql).includes('SELECT * FROM workspace_sync_candidates')) {
        return [[{ id: 5, entity_id: 1, email: 'new.person@prakasafoods.com', name: 'New Person', department_id: null, role_id: null, status: 'pending' }]];
      }
      if (String(sql).includes('INSERT INTO users')) return [{ insertId: 99 }];
      if (String(sql).includes('WHERE r.id IN')) return [[{ id: 15, entity_id: 1, department_id: 6, role_key: 'sales.member', role_level: 'member', name: 'Sales Member' }]];
      return [{ affectedRows: 1 }];
    },
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
  t.mock.method(pool, 'getConnection', async () => conn);
  t.mock.method(pool, 'query', async () => [{ affectedRows: 1 }]);
  t.mock.method(folderMappingRules, 'resolveFolder', async () => 'folder-abc');
  t.mock.method(drive, 'ensureFolderMember', async () => { throw new Error('Drive API down'); });

  const req = { user: baseUser(), params: { id: '5' }, body: { departmentId: 6, roleId: 15 } };
  const res = responseDouble();
  await ctrl.applyCandidate(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.userId, 99);
  assert.equal(res.body.data.driveAccess.granted, false);
  assert.equal(res.body.data.driveAccess.reason, 'error');
});

test('backfillDriveAccess processes every active user with a department and reports totals', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('FROM users')) {
      return [[
        { id: 1, email: 'a@prakasafoods.com', departmentId: 2 },
        { id: 2, email: 'b@prakasafoods.com', departmentId: 3 },
        { id: 3, email: 'c@prakasafoods.com', departmentId: 4 },
      ]];
    }
    return [{ affectedRows: 1 }];
  });
  t.mock.method(folderMappingRules, 'resolveFolder', async ({ departmentId }) => (departmentId === 4 ? null : 'folder-x'));
  t.mock.method(drive, 'ensureFolderMember', async ({ email }) => (
    email === 'a@prakasafoods.com' ? { added: true } : { added: false, reason: 'already_member' }
  ));

  const req = { user: baseUser() };
  const res = responseDouble();
  await ctrl.backfillDriveAccess(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.total, 3);
  assert.equal(res.body.data.granted, 1);
  assert.equal(res.body.data.alreadyMember, 1);
  assert.equal(res.body.data.failed, 1);
});

test('applyCandidate refuses a role that does not fit the chosen division', async (t) => {
  const queries = [];
  const conn = {
    query: async (sql) => {
      queries.push(String(sql));
      if (String(sql).includes('SELECT * FROM workspace_sync_candidates')) {
        return [[{ id: 5, entity_id: 1, email: 'new.person@prakasafoods.com', name: 'New Person', department_id: null, role_id: null, status: 'pending' }]];
      }
      if (String(sql).includes('WHERE r.id IN')) return [[{ id: 16, entity_id: 1, department_id: 8, role_key: 'warehouse.head', role_level: 'head', name: 'Warehouse Head' }]];
      return [{ affectedRows: 1 }];
    },
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
  t.mock.method(pool, 'getConnection', async () => conn);
  t.mock.method(pool, 'query', async () => [{ affectedRows: 1 }]);
  let error;
  await ctrl.applyCandidate({ user: baseUser(), params: { id: '5' }, body: { departmentId: 6, roleId: 16 } }, responseDouble(), (e) => { error = e; });
  assert.equal(error?.code, 'ROLE_ASSIGNMENT_INVALID');
  assert.equal(queries.some((q) => q.includes('INSERT INTO users')), false);
});
