const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const myDrive = require('../src/services/googleMyDrive.service');
const ctrl = require('../src/controllers/myDrive.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function baseUser(overrides = {}) {
  return { sub: 10, entityId: 1, email: 'user@prakasafoods.com', permissions: [], ...overrides };
}

test.beforeEach((t) => {
  // activityLog.service's log() call — irrelevant to every test below.
  t.mock.method(pool, 'query', async () => [[]]);
});

test('listFiles impersonates the caller and returns their My Drive root by default', async (t) => {
  let calledWith = null;
  t.mock.method(myDrive, 'listFiles', async (subject, opts) => { calledWith = { subject, opts }; return [{ id: 'f1', name: 'Report.docx' }]; });

  const req = { user: baseUser(), query: {} };
  const res = responseDouble();
  await ctrl.listFiles(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 200);
  assert.equal(calledWith.subject, 'user@prakasafoods.com');
  assert.equal(calledWith.opts.folderId, null);
  assert.equal(res.body.data.folderId, 'root');
  assert.equal(res.body.data.files.length, 1);
});

test('listFiles passes a folderId through to browse a subfolder', async (t) => {
  let folderIdSeen;
  t.mock.method(myDrive, 'listFiles', async (subject, opts) => { folderIdSeen = opts.folderId; return []; });

  const req = { user: baseUser(), query: { folderId: 'sub-1' } };
  const res = responseDouble();
  await ctrl.listFiles(req, res, (e) => { throw e; });

  assert.equal(folderIdSeen, 'sub-1');
  assert.equal(res.body.data.folderId, 'sub-1');
});

test('listFiles maps a Google impersonation failure to a clear, actionable error', async (t) => {
  t.mock.method(myDrive, 'listFiles', async () => {
    throw new Error('invalid_grant: Invalid email or User ID');
  });

  const req = { user: baseUser({ email: 'not.a.real.account@prakasafoods.com' }), query: {} };
  const res = responseDouble();
  await ctrl.listFiles(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'GOOGLE_ACCOUNT_NOT_LINKED');
});

test('an unrelated error from Drive is passed to the error handler unchanged', async (t) => {
  t.mock.method(myDrive, 'listFiles', async () => { throw new Error('Drive API is down'); });

  const req = { user: baseUser(), query: {} };
  const res = responseDouble();
  let passedToNext = null;
  await ctrl.listFiles(req, res, (e) => { passedToNext = e; });

  assert.ok(passedToNext);
  assert.equal(passedToNext.message, 'Drive API is down');
});

test('a raw 401 from googleapis (e.g. Drive scope not yet authorized) never reaches the client as this route\'s own 401', async (t) => {
  // The frontend treats ANY 401 response as "your Prakasa Workspace session
  // expired" and wipes the user's login — a googleapis auth error must not be
  // allowed to trigger that for every user, every time they open this page.
  t.mock.method(myDrive, 'listFiles', async () => {
    const error = new Error('unauthorized_client: Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.');
    error.code = 401;
    error.status = 401;
    throw error;
  });

  const req = { user: baseUser(), query: {} };
  const res = responseDouble();
  let passedToNext = null;
  await ctrl.listFiles(req, res, (e) => { passedToNext = e; });

  assert.equal(passedToNext, null);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error.code, 'GOOGLE_DRIVE_UNAVAILABLE');
});

test('createFolder creates under the current folder for the caller only', async (t) => {
  let calledWith = null;
  t.mock.method(myDrive, 'createFolder', async (subject, args) => { calledWith = { subject, args }; return { id: 'new-folder', name: 'Laporan' }; });

  const req = { user: baseUser(), body: { name: 'Laporan', parentId: 'root-sub' } };
  const res = responseDouble();
  await ctrl.createFolder(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 201);
  assert.equal(calledWith.subject, 'user@prakasafoods.com');
  assert.deepEqual(calledWith.args, { name: 'Laporan', parentId: 'root-sub' });
});

test('createFile refuses an unrecognized kind before calling Drive at all', async (t) => {
  t.mock.method(myDrive, 'createNativeFile', async () => { throw new Error('must not be called'); });

  const req = { user: baseUser(), body: { name: 'X', kind: 'video', parentId: null } };
  const res = responseDouble();
  await ctrl.createFile(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('createFile maps kind to the matching native Google mime type', async (t) => {
  let mimeTypeSeen;
  t.mock.method(myDrive, 'createNativeFile', async (subject, args) => { mimeTypeSeen = args.mimeType; return { id: 'doc-1', name: args.name }; });

  const req = { user: baseUser(), body: { name: 'Notulen', kind: 'document', parentId: null } };
  const res = responseDouble();
  await ctrl.createFile(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 201);
  assert.equal(mimeTypeSeen, 'application/vnd.google-apps.document');
});

test('uploadFile refuses when no file was attached', async (t) => {
  const req = { user: baseUser(), body: {}, file: null };
  const res = responseDouble();
  await ctrl.uploadFile(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('uploadFile streams the attached file to the caller\'s own My Drive', async (t) => {
  let argsSeen = null;
  t.mock.method(myDrive, 'uploadFile', async (subject, args) => { argsSeen = { subject, args }; return { id: 'up-1', name: args.name }; });

  const req = {
    user: baseUser(),
    body: { parentId: 'folder-9' },
    file: { originalname: 'invoice.pdf', mimetype: 'application/pdf', buffer: Buffer.from('x') },
  };
  const res = responseDouble();
  await ctrl.uploadFile(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 201);
  assert.equal(argsSeen.subject, 'user@prakasafoods.com');
  assert.equal(argsSeen.args.name, 'invoice.pdf');
  assert.equal(argsSeen.args.folderId, 'folder-9');
});

test('removeFile trashes the file after reading its own metadata (no cross-user check needed)', async (t) => {
  t.mock.method(myDrive, 'getFileMeta', async () => ({ id: 'f1', name: 'Draft' }));
  let trashedId = null;
  t.mock.method(myDrive, 'deleteFile', async (subject, fileId) => { trashedId = fileId; return { deleted: true }; });

  const req = { user: baseUser(), params: { fileId: 'f1' } };
  const res = responseDouble();
  await ctrl.removeFile(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 200);
  assert.equal(trashedId, 'f1');
});
