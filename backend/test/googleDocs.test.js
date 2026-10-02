const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const files = require('../src/services/googleWorkspaceFiles.service');
const ctrl = require('../src/controllers/googleDocs.controller');

const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(h) { Object.assign(this.headers, h); return this; },
    send(body) { this.body = body; return this; },
  };
}

const user = (overrides = {}) => ({ sub: 14, entityId: 1, email: 'me@prakasafoods.com', permissions: ['google.docs.use'], ...overrides });
const mustNotCall = () => { throw new Error('must not be called'); };
const rethrow = (e) => { throw e; };
const docFile = (overrides = {}) => ({
  id: FILE_ID, name: 'Laporan', mimeType: files.NATIVE_MIME.document, kind: 'document',
  canRename: true, canTrash: true, ownedByMe: true, ...overrides,
});

test.beforeEach((t) => {
  // activityLog.service + integrationLog write through the pool — irrelevant here.
  t.mock.method(pool, 'query', async () => [[]]);
});

// ── pure helpers ────────────────────────────────────────────────────────────

test('escapeDriveQuery escapes backslash and single quote and drops control characters', () => {
  assert.equal(files.escapeDriveQuery("it's"), "it\\'s");
  assert.equal(files.escapeDriveQuery('a\\b'), 'a\\\\b');
  assert.equal(files.escapeDriveQuery("\\'"), "\\\\\\'");
  assert.equal(files.escapeDriveQuery('a\nb\u0000c'), 'abc');
  assert.equal(files.escapeDriveQuery(undefined), '');
});

test('buildListQuery cannot be broken out of by the search text', () => {
  const q = files.buildListQuery({ kind: 'document', scope: 'mine', search: "x' or name contains '" });
  assert.match(q, /name contains 'x\\' or name contains \\''$/);
  // Exactly one name clause, and the kind/owner filters are still ANDed in.
  assert.equal((q.match(/ and name contains '/g) || []).length, 1);
  assert.match(q, /'me' in owners/);
  assert.match(q, /trashed = false/);
});

test('buildListQuery filters by the whitelisted mime family of the kind, including Office files', () => {
  const q = files.buildListQuery({ kind: 'spreadsheet' });
  assert.match(q, /application\/vnd\.google-apps\.spreadsheet/);
  assert.match(q, /spreadsheetml\.sheet/);
  assert.doesNotMatch(q, /google-apps\.document/);
  assert.doesNotMatch(q, /name contains/);
  assert.match(files.buildListQuery({ kind: 'presentation', scope: 'shared' }), /sharedWithMe = true/);
  assert.throws(() => files.buildListQuery({ kind: 'folder' }), /Unknown kind/);
  assert.throws(() => files.buildListQuery({ kind: '__proto__' }), /Unknown kind/);
});

test('kind / scope / file id / page token validators', () => {
  assert.equal(files.isKind('document'), true);
  for (const bad of ['folder', 'application/pdf', 'toString', '__proto__', '', undefined, ['document']]) {
    assert.equal(files.isKind(bad), false, String(bad));
  }
  assert.equal(files.isScope('shared'), true);
  assert.equal(files.isScope('all'), false);
  assert.equal(files.isValidFileId(FILE_ID), true);
  for (const bad of ['short', '../../etc/passwd', "abc' or '1'='1abc", 'a'.repeat(129), 'abc def ghi jkl', undefined]) {
    assert.equal(files.isValidFileId(bad), false, String(bad));
  }
  // Real Drive tokens look like "~!!~AI9FV7…_-=" and run to several hundred chars.
  assert.equal(files.isValidPageToken(`~!!~AI9FV7${'Qx_-'.repeat(200)}==`), true);
  assert.equal(files.isValidPageToken("tok' or 1=1"), false);
  assert.equal(files.isValidPageToken('tok and trashed = true'), false);
  assert.equal(files.isValidPageToken('a'.repeat(2049)), false);
});

test('clampPageSize caps at 50 and defaults to 30', () => {
  assert.equal(files.clampPageSize('1000'), files.MAX_PAGE_SIZE);
  assert.equal(files.clampPageSize(undefined), 30);
  assert.equal(files.clampPageSize('-3'), 30);
  assert.equal(files.clampPageSize('12'), 12);
});

test('toClientFile marks Office files and never leaks the raw thumbnailLink', () => {
  const out = files.toClientFile({
    id: FILE_ID, name: 'Budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    thumbnailLink: 'https://lh3.googleusercontent.com/x=s220', hasThumbnail: true,
    owners: [{ displayName: 'Someone', me: false }], capabilities: { canTrash: false, canRename: true },
  });
  assert.equal(out.kind, 'spreadsheet');
  assert.equal(out.officeType, 'XLSX');
  assert.equal(out.ownerName, 'Someone');
  assert.equal(out.canTrash, false);
  assert.equal('thumbnailLink' in out, false);
});

test('isAllowedThumbnailUrl only allows https Google hosts', () => {
  assert.equal(files.isAllowedThumbnailUrl('https://lh3.googleusercontent.com/abc=s220'), true);
  assert.equal(files.isAllowedThumbnailUrl('https://docs.google.com/feeds/x'), true);
  assert.equal(files.isAllowedThumbnailUrl('http://lh3.googleusercontent.com/abc'), false);
  assert.equal(files.isAllowedThumbnailUrl('https://evil.com/?h=googleusercontent.com'), false);
  assert.equal(files.isAllowedThumbnailUrl('https://googleusercontent.com.evil.com/'), false);
  assert.equal(files.isAllowedThumbnailUrl('not a url'), false);
});

// ── list ────────────────────────────────────────────────────────────────────

test('listFiles impersonates the caller and passes only sanitized options', async (t) => {
  let seen = null;
  t.mock.method(files, 'listFiles', async (subject, opts) => { seen = { subject, opts }; return { files: [docFile()], nextPageToken: 'next-1', incompleteSearch: false }; });
  const req = { user: user(), query: { kind: 'document', scope: 'shared', q: `  ${'x'.repeat(300)}  `, pageToken: 'abc_DEF-1', pageSize: '500', email: 'boss@prakasafoods.com' } };
  const res = responseDouble();
  await ctrl.listFiles(req, res, rethrow);

  assert.equal(res.statusCode, 200);
  assert.equal(seen.subject, 'me@prakasafoods.com');
  assert.equal(seen.opts.kind, 'document');
  assert.equal(seen.opts.scope, 'shared');
  assert.equal(seen.opts.search.length, 100);
  assert.equal(seen.opts.pageToken, 'abc_DEF-1');
  assert.equal(seen.opts.pageSize, 50);
  assert.equal(res.body.data.nextPageToken, 'next-1');
  assert.equal(res.body.data.files.length, 1);
});

test('listFiles defaults to the recent tab', async (t) => {
  let scope;
  t.mock.method(files, 'listFiles', async (subject, opts) => { scope = opts.scope; return { files: [], nextPageToken: null }; });
  const res = responseDouble();
  await ctrl.listFiles({ user: user(), query: { kind: 'presentation' } }, res, rethrow);
  assert.equal(res.statusCode, 200);
  assert.equal(scope, 'recent');
});

for (const [label, query] of [
  ['an unknown kind', { kind: 'folder' }],
  ['a raw mime type instead of a kind', { kind: 'application/vnd.google-apps.document' }],
  ['a missing kind', {}],
  ['an unknown tab', { kind: 'document', scope: 'trash' }],
  ['a malformed page token', { kind: 'document', pageToken: "x' or '1'='1" }],
  ['an array search', { kind: 'document', q: ['a', 'b'] }],
]) {
  test(`listFiles rejects ${label} before calling Google`, async (t) => {
    t.mock.method(files, 'listFiles', mustNotCall);
    const res = responseDouble();
    await ctrl.listFiles({ user: user(), query }, res, rethrow);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });
}

test('a Google 401 never reaches the browser as a 401 (it would log the user out)', async (t) => {
  t.mock.method(files, 'listFiles', async () => {
    const error = new Error('unauthorized_client: Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.');
    error.code = 401; error.status = 401;
    throw error;
  });
  const res = responseDouble();
  await ctrl.listFiles({ user: user(), query: { kind: 'document' } }, res, rethrow);
  assert.notEqual(res.statusCode, 401);
  assert.equal(res.body.error.code, 'GOOGLE_SCOPE_NOT_GRANTED');
});

test('a user without a Google account gets a clear error', async (t) => {
  t.mock.method(files, 'listFiles', async () => { throw new Error('invalid_grant: Invalid email or User ID'); });
  const res = responseDouble();
  await ctrl.listFiles({ user: user(), query: { kind: 'document' } }, res, rethrow);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'GOOGLE_ACCOUNT_NOT_LINKED');
});

// ── get ─────────────────────────────────────────────────────────────────────

test('getFile validates the id and rejects files outside the Docs/Sheets/Slides family', async (t) => {
  t.mock.method(files, 'getFile', mustNotCall);
  let res = responseDouble();
  await ctrl.getFile({ user: user(), params: { fileId: '../x' } }, res, rethrow);
  assert.equal(res.statusCode, 400);

  t.mock.restoreAll();
  t.mock.method(pool, 'query', async () => [[]]);
  t.mock.method(files, 'getFile', async () => docFile({ mimeType: 'application/pdf', kind: null }));
  res = responseDouble();
  await ctrl.getFile({ user: user(), params: { fileId: FILE_ID } }, res, rethrow);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'UNSUPPORTED_FILE');
});

test('getFile returns metadata for the caller', async (t) => {
  let subject;
  t.mock.method(files, 'getFile', async (s) => { subject = s; return docFile(); });
  const res = responseDouble();
  await ctrl.getFile({ user: user(), params: { fileId: FILE_ID } }, res, rethrow);
  assert.equal(res.statusCode, 200);
  assert.equal(subject, 'me@prakasafoods.com');
  assert.equal(res.body.data.id, FILE_ID);
});

// ── create ──────────────────────────────────────────────────────────────────

test('createFile creates a native file of the whitelisted kind with a default name', async (t) => {
  let seen = null;
  t.mock.method(files, 'createFile', async (subject, args) => { seen = { subject, args }; return docFile({ id: FILE_ID, name: args.name }); });
  const res = responseDouble();
  await ctrl.createFile({ user: user(), body: { kind: 'spreadsheet', mimeType: 'application/x-evil' } }, res, rethrow);
  assert.equal(res.statusCode, 201);
  assert.equal(seen.subject, 'me@prakasafoods.com');
  assert.deepEqual(seen.args, { kind: 'spreadsheet', name: 'Spreadsheet tanpa judul' });
});

test('createFile trims and caps a provided name', async (t) => {
  let name;
  t.mock.method(files, 'createFile', async (subject, args) => { name = args.name; return docFile(); });
  const res = responseDouble();
  await ctrl.createFile({ user: user(), body: { kind: 'document', name: `  Rapat\n${'a'.repeat(300)}` } }, res, rethrow);
  assert.equal(res.statusCode, 201);
  assert.ok(name.startsWith('Rapat a'));
  assert.equal(name.length, files.MAX_NAME_LENGTH);
});

test('createFile refuses an unknown kind or a non-string name', async (t) => {
  t.mock.method(files, 'createFile', mustNotCall);
  for (const body of [{ kind: 'folder' }, { kind: 'document', name: { $gt: '' } }, {}]) {
    const res = responseDouble();
    await ctrl.createFile({ user: user(), body }, res, rethrow);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});

test('service createFile maps kind to the native mime type and puts it in My Drive root', async (t) => {
  // Service-level guard: even if called directly, an unknown kind never reaches Drive.
  await assert.rejects(() => files.createFile('me@prakasafoods.com', { kind: 'folder', name: 'x' }), /Unknown kind/);
  assert.equal(files.NATIVE_MIME.presentation, 'application/vnd.google-apps.presentation');
});

// ── rename ──────────────────────────────────────────────────────────────────

test('renameFile renames when Drive says the caller may', async (t) => {
  let seen = null;
  t.mock.method(files, 'getFile', async () => docFile());
  t.mock.method(files, 'renameFile', async (subject, id, name) => { seen = { subject, id, name }; return docFile({ name }); });
  const res = responseDouble();
  await ctrl.renameFile({ user: user(), params: { fileId: FILE_ID }, body: { name: '  Notulen  ' } }, res, rethrow);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, { subject: 'me@prakasafoods.com', id: FILE_ID, name: 'Notulen' });
});

test('renameFile refuses an empty name, a bad id, a non-doc file and a file the caller cannot rename', async (t) => {
  t.mock.method(files, 'renameFile', mustNotCall);
  t.mock.method(files, 'getFile', mustNotCall);
  let res = responseDouble();
  await ctrl.renameFile({ user: user(), params: { fileId: FILE_ID }, body: { name: '   ' } }, res, rethrow);
  assert.equal(res.statusCode, 400);
  res = responseDouble();
  await ctrl.renameFile({ user: user(), params: { fileId: 'bad id!' }, body: { name: 'x' } }, res, rethrow);
  assert.equal(res.statusCode, 400);

  t.mock.restoreAll();
  t.mock.method(pool, 'query', async () => [[]]);
  t.mock.method(files, 'renameFile', mustNotCall);
  t.mock.method(files, 'getFile', async () => docFile({ canRename: false }));
  res = responseDouble();
  await ctrl.renameFile({ user: user(), params: { fileId: FILE_ID }, body: { name: 'x' } }, res, rethrow);
  assert.equal(res.statusCode, 403);

  t.mock.restoreAll();
  t.mock.method(pool, 'query', async () => [[]]);
  t.mock.method(files, 'renameFile', mustNotCall);
  t.mock.method(files, 'getFile', async () => docFile({ mimeType: 'application/vnd.google-apps.folder', kind: null }));
  res = responseDouble();
  await ctrl.renameFile({ user: user(), params: { fileId: FILE_ID }, body: { name: 'x' } }, res, rethrow);
  assert.equal(res.statusCode, 404);
});

// ── trash ───────────────────────────────────────────────────────────────────

test('trashFile trashes a file the caller can trash', async (t) => {
  let trashed = null;
  t.mock.method(files, 'getFile', async () => docFile());
  t.mock.method(files, 'trashFile', async (subject, id) => { trashed = { subject, id }; return { id, trashed: true }; });
  const res = responseDouble();
  await ctrl.trashFile({ user: user(), params: { fileId: FILE_ID } }, res, rethrow);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(trashed, { subject: 'me@prakasafoods.com', id: FILE_ID });
  assert.equal(res.body.data.trashed, true);
});

test('trashFile refuses a file shared with the caller that they cannot trash', async (t) => {
  t.mock.method(files, 'getFile', async () => docFile({ ownedByMe: false, canTrash: false }));
  t.mock.method(files, 'trashFile', mustNotCall);
  const res = responseDouble();
  await ctrl.trashFile({ user: user(), params: { fileId: FILE_ID } }, res, rethrow);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('trashFile maps a Google 404 to a clean not-found', async (t) => {
  t.mock.method(files, 'getFile', async () => { const e = new Error('File not found'); e.code = 404; throw e; });
  t.mock.method(files, 'trashFile', mustNotCall);
  const res = responseDouble();
  await ctrl.trashFile({ user: user(), params: { fileId: FILE_ID } }, res, rethrow);
  assert.equal(res.statusCode, 404);
});

// ── thumbnail ───────────────────────────────────────────────────────────────

test('thumbnail streams the proxied image with private caching, or 404 when there is none', async (t) => {
  t.mock.method(files, 'fetchThumbnail', async () => ({ contentType: 'image/png', buffer: Buffer.from([1, 2, 3]) }));
  let res = responseDouble();
  await ctrl.thumbnail({ user: user(), params: { fileId: FILE_ID } }, res, rethrow);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'image/png');
  assert.match(res.headers['Cache-Control'], /^private/);
  assert.equal(res.body.length, 3);

  t.mock.restoreAll();
  t.mock.method(pool, 'query', async () => [[]]);
  t.mock.method(files, 'fetchThumbnail', async () => null);
  res = responseDouble();
  await ctrl.thumbnail({ user: user(), params: { fileId: FILE_ID } }, res, rethrow);
  assert.equal(res.statusCode, 404);
});

// ── service → Drive API calls (googleapis mocked) ───────────────────────────

const { google } = require('googleapis');

function fakeDrive(t, responses = {}) {
  const calls = [];
  const record = (method) => async (params) => { calls.push({ method, params }); return { data: responses[method] || {} }; };
  t.mock.method(google, 'drive', () => ({ files: { list: record('list'), get: record('get'), create: record('create'), update: record('update') } }));
  return calls;
}

test('service listFiles sends an escaped, capped query to Drive', async (t) => {
  const calls = fakeDrive(t, { list: { files: [{ id: FILE_ID, name: 'A', mimeType: files.NATIVE_MIME.document }], nextPageToken: 'n2' } });
  const out = await files.listFiles('me@prakasafoods.com', { kind: 'document', scope: 'mine', search: "o'reilly", pageToken: 'p1', pageSize: 999 });
  const { params } = calls[0];
  assert.equal(params.pageSize, 50);
  assert.equal(params.pageToken, 'p1');
  assert.equal(params.orderBy, 'modifiedTime desc');
  assert.match(params.q, /name contains 'o\\'reilly'/);
  assert.equal(params.corpora, undefined);
  assert.equal(out.nextPageToken, 'n2');
  assert.equal(out.files[0].kind, 'document');
});

test('service listFiles recent tab orders by last viewed and spans shared drives', async (t) => {
  const calls = fakeDrive(t, { list: { files: [] } });
  await files.listFiles('me@prakasafoods.com', { kind: 'presentation' });
  assert.equal(calls[0].params.orderBy, 'viewedByMeTime desc,modifiedTime desc');
  assert.equal(calls[0].params.corpora, 'allDrives');
  assert.equal(calls[0].params.includeItemsFromAllDrives, true);
});

test('service createFile creates the native mime type in My Drive root; trash sets trashed=true', async (t) => {
  const calls = fakeDrive(t, { create: { id: FILE_ID, name: 'Presentasi tanpa judul', mimeType: files.NATIVE_MIME.presentation } });
  const created = await files.createFile('me@prakasafoods.com', { kind: 'presentation', name: 'Presentasi tanpa judul' });
  assert.deepEqual(calls[0].params.requestBody, { name: 'Presentasi tanpa judul', mimeType: 'application/vnd.google-apps.presentation', parents: ['root'] });
  assert.equal(created.kind, 'presentation');

  await files.trashFile('me@prakasafoods.com', FILE_ID);
  assert.deepEqual(calls[1].params.requestBody, { trashed: true });
  assert.equal(calls[1].params.fileId, FILE_ID);

  await files.renameFile('me@prakasafoods.com', FILE_ID, 'Baru');
  assert.deepEqual(calls[2].params.requestBody, { name: 'Baru' });
});
