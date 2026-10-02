const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const ctrl = require('../src/controllers/letterhead.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function baseUser(overrides = {}) {
  return { sub: 10, entityId: 1, departmentId: 3, permissions: [], ...overrides };
}

test('get refuses a department the caller has no access to', async (t) => {
  t.mock.method(pool, 'query', async () => { throw new Error('must not query'); });
  const req = { user: baseUser(), query: { departmentId: '9' } };
  const res = responseDouble();
  await ctrl.get(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('get reports no letterhead when none is stored yet', async (t) => {
  t.mock.method(pool, 'query', async () => [[]]);
  const req = { user: baseUser(), query: { departmentId: '3' } };
  const res = responseDouble();
  await ctrl.get(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.exists, false);
});

test('get decrypts and returns a stored letterhead for anyone in the division', async (t) => {
  const original = process.env.SIGNATURE_ENCRYPTION_KEY;
  process.env.SIGNATURE_ENCRYPTION_KEY = 'x'.repeat(32);
  t.after(() => { process.env.SIGNATURE_ENCRYPTION_KEY = original; });

  const sigSvc = require('../src/services/signature.service');
  const plain = Buffer.from('fake-image-bytes');
  const { encrypted, iv, authTag } = sigSvc.encryptBuffer(plain);

  t.mock.method(pool, 'query', async () => [[{
    encrypted_blob: encrypted, iv, auth_tag: authTag, mime_type: 'image/png',
    uploaded_by: 5, updated_at: new Date(),
  }]]);

  const req = { user: baseUser({ departmentId: 3 }), query: { departmentId: '3' } };
  const res = responseDouble();
  await ctrl.get(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.exists, true);
  assert.equal(Buffer.from(res.body.data.imageBase64, 'base64').toString(), 'fake-image-bytes');
});

test('save refuses a department the caller has no access to', async (t) => {
  t.mock.method(pool, 'query', async () => { throw new Error('must not query'); });
  const req = { user: baseUser(), body: { departmentId: 9, imageBase64: 'x'.repeat(30) } };
  const res = responseDouble();
  await ctrl.save(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('save allows a cross-division admin to manage another division\'s letterhead', async (t) => {
  const original = process.env.SIGNATURE_ENCRYPTION_KEY;
  process.env.SIGNATURE_ENCRYPTION_KEY = 'x'.repeat(32);
  t.after(() => { process.env.SIGNATURE_ENCRYPTION_KEY = original; });

  let insertedDepartmentId = null;
  t.mock.method(pool, 'query', async (sql, args) => {
    if (String(sql).includes('INSERT INTO letterhead_assets')) insertedDepartmentId = args[1];
    return [{ affectedRows: 1 }];
  });

  const req = {
    user: baseUser({ departmentId: 3, permissions: ['workspace.cross_division.view'] }),
    body: { departmentId: 9, imageBase64: Buffer.from('cap-image').toString('base64') },
  };
  const res = responseDouble();
  await ctrl.save(req, res, (e) => { throw e; });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.saved, true);
  assert.equal(insertedDepartmentId, 9);
});
