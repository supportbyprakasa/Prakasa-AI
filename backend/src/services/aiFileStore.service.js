const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const drive = require('./googleDrive.service');

// Where AI document binaries live. Google Shared Drive is the only production store;
// a local-disk store exists for development (AI_DOCUMENT_STORAGE=local) and is refused
// when NODE_ENV=production. Stored ids keep their origin, so downloads route by id.

const LOCAL_PREFIX = 'local:';
const LOCAL_ID_PATTERN = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCAL_FOLDER_ID = 'local:ai-dev';

function storeError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function localRoot() {
  return path.resolve(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads', 'ai-local');
}

function localStorageRequested() {
  return String(process.env.AI_DOCUMENT_STORAGE || '').trim().toLowerCase() === 'local';
}

function assertLocalAllowed() {
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    throw storeError(
      'Penyimpanan lokal file AI tidak diizinkan di production. Gunakan Google Shared Drive.',
      503,
      'AI_STORAGE_MISCONFIGURED'
    );
  }
}

function isLocalFileId(id) {
  return String(id || '').startsWith(LOCAL_PREFIX);
}

function localPaths(id) {
  if (!LOCAL_ID_PATTERN.test(String(id || ''))) {
    throw storeError('ID file lokal tidak valid', 400, 'VALIDATION_ERROR');
  }
  const key = id.slice(LOCAL_PREFIX.length);
  return {
    data: path.join(localRoot(), `${key}.bin`),
    meta: path.join(localRoot(), `${key}.json`),
  };
}

const localStore = {
  kind: 'local',

  async resolveFolder() {
    assertLocalAllowed();
    return LOCAL_FOLDER_ID;
  },

  async upload({ name, mimeType, buffer }) {
    assertLocalAllowed();
    await fs.mkdir(localRoot(), { recursive: true });
    const id = `${LOCAL_PREFIX}${crypto.randomUUID()}`;
    const paths = localPaths(id);
    await fs.writeFile(paths.data, buffer, { flag: 'wx' });
    await fs.writeFile(paths.meta, JSON.stringify({ name, mimeType }), { flag: 'wx' });
    return { id, name, mimeType, size: buffer.length, webViewLink: null };
  },

  async download(id) {
    assertLocalAllowed();
    const paths = localPaths(id);
    let buffer;
    try {
      buffer = await fs.readFile(paths.data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw storeError('File tidak ditemukan di penyimpanan lokal', 404, 'NOT_FOUND');
      }
      throw error;
    }
    let meta = {};
    try {
      meta = JSON.parse(await fs.readFile(paths.meta, 'utf8'));
    } catch {
      // Metadata is optional; callers fall back to the stored document mime type.
    }
    return { buffer, mimeType: meta.mimeType || 'application/octet-stream' };
  },

  async remove(id) {
    const paths = localPaths(id);
    await Promise.all([
      fs.rm(paths.data, { force: true }),
      fs.rm(paths.meta, { force: true }),
    ]);
  },
};

const driveStore = {
  kind: 'drive',
  upload: (file, logContext) => drive.uploadFile(file, logContext),
  download: (id, logContext) => drive.downloadFileBuffer(id, logContext),
  remove: (id, logContext) => drive.deleteFile(id, logContext),
};

function storeForUpload() {
  if (!localStorageRequested()) return driveStore;
  assertLocalAllowed();
  return localStore;
}

function storeForFile(id) {
  return isLocalFileId(id) ? localStore : driveStore;
}

module.exports = {
  isLocalFileId,
  storeForFile,
  storeForUpload,
};
