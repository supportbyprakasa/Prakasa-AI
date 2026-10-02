const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const drive = require('../src/services/googleDrive.service');
const ctrl = require('../src/controllers/divisionStorage.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function mockFolderRule(t, driveFolderId = 'div-folder-1') {
  t.mock.method(pool, 'query', async (sql) => {
    const s = String(sql);
    if (s.includes('FROM folder_mapping_rules')) return [[{ driveFolderId }]];
    return [[]];
  });
}

function baseUser(overrides = {}) {
  return { sub: 10, entityId: 1, departmentId: 3, permissions: [], ...overrides };
}

test('removeFile trashes a file that belongs to the resolved division folder', async (t) => {
  mockFolderRule(t, 'div-folder-1');
  t.mock.method(drive, 'getFileMeta', async () => ({ id: 'f1', name: 'Draft', parents: ['div-folder-1'] }));
  let trashedId = null;
  t.mock.method(drive, 'deleteFile', async (fileId) => { trashedId = fileId; return { deleted: true }; });

  const req = { user: baseUser(), params: { fileId: 'f1' }, query: { departmentId: '3' } };
  const res = responseDouble();
  await ctrl.removeFile(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 200);
  assert.equal(trashedId, 'f1');
});

test('removeFile refuses a fileId that does not live in the resolved division folder', async (t) => {
  mockFolderRule(t, 'div-folder-1');
  t.mock.method(drive, 'getFileMeta', async () => ({ id: 'f2', name: 'Elsewhere', parents: ['some-other-folder'] }));
  t.mock.method(drive, 'deleteFile', async () => { throw new Error('must not trash'); });

  const req = { user: baseUser(), params: { fileId: 'f2' }, query: { departmentId: '3' } };
  const res = responseDouble();
  await ctrl.removeFile(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('removeFile refuses a department the caller has no access to', async (t) => {
  mockFolderRule(t, 'div-folder-1');
  t.mock.method(drive, 'getFileMeta', async () => { throw new Error('must not look up file'); });
  t.mock.method(drive, 'deleteFile', async () => { throw new Error('must not trash'); });

  const req = { user: baseUser({ departmentId: 3, permissions: [] }), params: { fileId: 'f1' }, query: { departmentId: '9' } };
  const res = responseDouble();
  await ctrl.removeFile(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('removeFile allows a cross-division admin to act on a department outside their own', async (t) => {
  mockFolderRule(t, 'div-folder-9');
  t.mock.method(drive, 'getFileMeta', async () => ({ id: 'f9', name: 'Report', parents: ['div-folder-9'] }));
  let trashedId = null;
  t.mock.method(drive, 'deleteFile', async (fileId) => { trashedId = fileId; return { deleted: true }; });

  const req = {
    user: baseUser({ departmentId: 3, permissions: ['workspace.cross_division.view'] }),
    params: { fileId: 'f9' },
    query: { departmentId: '9' },
  };
  const res = responseDouble();
  await ctrl.removeFile(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 200);
  assert.equal(trashedId, 'f9');
});
