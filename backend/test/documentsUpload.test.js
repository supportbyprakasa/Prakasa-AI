const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const drive = require('../src/services/googleDrive.service');
const ctrl = require('../src/controllers/documents.controller');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function baseReq(overrides = {}) {
  return {
    body: { entityId: 1, departmentId: null, title: 'Kontrak Vendor', documentType: 'contract' },
    file: { originalname: 'kontrak.pdf', mimetype: 'application/pdf', buffer: Buffer.from('x'), size: 1 },
    user: { sub: 10, entityId: 1, departmentId: null, permissions: [] },
    ...overrides,
  };
}

function mockNoFolderRule(t) {
  t.mock.method(pool, 'query', async (sql) => {
    const s = String(sql);
    if (s.includes('FROM folder_mapping_rules')) return [[]];
    if (s.startsWith('INSERT INTO documents')) return [{ insertId: 50 }];
    return [{ insertId: 1, affectedRows: 1 }];
  });
}

test('upload falls back to the Shared Drive when no folder mapping rule matches', async (t) => {
  const original = process.env.GOOGLE_SHARED_DRIVE_ID;
  process.env.GOOGLE_SHARED_DRIVE_ID = 'shared-drive-root';
  t.after(() => { process.env.GOOGLE_SHARED_DRIVE_ID = original; });

  mockNoFolderRule(t);
  let uploadedParentId = null;
  t.mock.method(drive, 'uploadFile', async ({ parentId }) => {
    uploadedParentId = parentId;
    return { id: 'file1', name: 'kontrak.pdf', mimeType: 'application/pdf', size: 1, webViewLink: 'https://drive.google.com/file/d/file1/view' };
  });

  const res = responseDouble();
  await ctrl.upload(baseReq(), res, (e) => { throw e; });
  assert.equal(res.statusCode, 201);
  assert.equal(uploadedParentId, 'shared-drive-root');
  assert.equal(res.body.data.driveFileId, 'file1');
});

test('upload is rejected when neither a folder rule nor the Shared Drive is configured', async (t) => {
  const original = process.env.GOOGLE_SHARED_DRIVE_ID;
  delete process.env.GOOGLE_SHARED_DRIVE_ID;
  t.after(() => { process.env.GOOGLE_SHARED_DRIVE_ID = original; });

  mockNoFolderRule(t);
  t.mock.method(drive, 'uploadFile', async () => { throw new Error('must not upload'); });

  const res = responseDouble();
  await ctrl.upload(baseReq(), res, (e) => { throw e; });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'GOOGLE_DRIVE_NOT_CONFIGURED');
});
