const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prakasa-ai-store-'));
process.env.UPLOAD_DIR = uploadDir;

const { isLocalFileId, storeForFile, storeForUpload } = require('../src/services/aiFileStore.service');

function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  return Promise.resolve().then(fn).finally(restore);
}

test.after(() => fs.rmSync(uploadDir, { recursive: true, force: true }));

test('local store round-trips a file inside the upload directory only', () => withEnv(
  { AI_DOCUMENT_STORAGE: 'local', NODE_ENV: 'development' },
  async () => {
    const store = storeForUpload();
    assert.equal(store.kind, 'local');
    const saved = await store.upload({ name: 'laporan.txt', mimeType: 'text/plain', buffer: Buffer.from('isi') });
    assert.ok(isLocalFileId(saved.id));
    assert.equal(saved.webViewLink, null);
    assert.ok(fs.readdirSync(path.join(uploadDir, 'ai-local')).length === 2);

    const read = await storeForFile(saved.id).download(saved.id);
    assert.equal(read.buffer.toString(), 'isi');
    assert.equal(read.mimeType, 'text/plain');

    await storeForFile(saved.id).remove(saved.id);
    await assert.rejects(storeForFile(saved.id).download(saved.id), (error) => error.status === 404);
  },
));

test('local storage is refused in production', () => withEnv(
  { AI_DOCUMENT_STORAGE: 'local', NODE_ENV: 'production' },
  async () => {
    assert.throws(() => storeForUpload(), (error) => error.code === 'AI_STORAGE_MISCONFIGURED');
    await assert.rejects(
      storeForFile('local:00000000-0000-4000-8000-000000000000').download('local:00000000-0000-4000-8000-000000000000'),
      (error) => error.code === 'AI_STORAGE_MISCONFIGURED',
    );
  },
));

test('malformed local ids cannot address paths outside the store', () => withEnv(
  { NODE_ENV: 'development' },
  async () => {
    await assert.rejects(
      storeForFile('local:../../etc/passwd').download('local:../../etc/passwd'),
      (error) => error.code === 'VALIDATION_ERROR',
    );
  },
));

test('Google Drive stays the default store and routes non-local ids', () => withEnv(
  { AI_DOCUMENT_STORAGE: undefined, NODE_ENV: 'development' },
  () => {
    assert.equal(storeForUpload().kind, 'drive');
    assert.equal(storeForFile('1AbCdEfGhIjK').kind, 'drive');
    assert.equal(storeForFile('local:00000000-0000-4000-8000-000000000000').kind, 'local');
  },
));
