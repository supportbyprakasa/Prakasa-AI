const { google } = require('googleapis');
const integrationLog = require('./integrationLog.service');

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/presentations',
    ],
  });
}

function driveClient() {
  return google.drive({ version: 'v3', auth: getAuth() });
}

async function ensureFolder({ name, parentId, sharedDriveId }, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_drive',
    operation: 'ensureFolder',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { name, parentId, sharedDriveId },
    responseMeta: (result) => ({ id: result?.id, name: result?.name }),
  }, async () => {
    const drive = driveClient();
    const q = [
      `mimeType='application/vnd.google-apps.folder'`,
      `name='${name.replace(/'/g, "\\'")}'`,
      'trashed=false',
      parentId ? `'${parentId}' in parents` : null,
    ].filter(Boolean).join(' and ');

    const list = await drive.files.list({
      q,
      fields: 'files(id,name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: sharedDriveId ? 'drive' : 'user',
      driveId: sharedDriveId || undefined,
    });
    if (list.data.files.length) return list.data.files[0];

    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : undefined,
      },
      fields: 'id,name,webViewLink',
      supportsAllDrives: true,
    });
    return created.data;
  });
}

// Company files live in the Shared Drive only: without a target folder a file
// goes to the Shared Drive root, and without a configured Shared Drive nothing
// is uploaded (never into the service account's own Drive).
function sharedDriveTarget(parentId) {
  const target = parentId || String(process.env.GOOGLE_SHARED_DRIVE_ID || '').trim();
  if (!target) {
    throw Object.assign(new Error('Google Shared Drive belum dikonfigurasi. Isi GOOGLE_SHARED_DRIVE_ID atau folder mapping.'), {
      status: 503, code: 'GOOGLE_DRIVE_NOT_CONFIGURED',
    });
  }
  return target;
}

async function uploadFile({ name, mimeType, buffer, parentId: requestedParent }, ctx = {}) {
  const parentId = sharedDriveTarget(requestedParent);
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_drive',
    operation: 'uploadFile',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: {
      name,
      mimeType,
      size: Buffer.isBuffer(buffer) ? buffer.length : null,
      parentId,
    },
    responseMeta: (result) => ({
      id: result?.id,
      name: result?.name,
      mimeType: result?.mimeType,
      size: result?.size,
    }),
  }, async () => {
    const drive = driveClient();
    const { Readable } = require('stream');
    const created = await drive.files.create({
      requestBody: { name, parents: [parentId] },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id,name,mimeType,size,webViewLink,owners(emailAddress)',
      supportsAllDrives: true,
    });
    return created.data;
  });
}

async function copyFile({ fileId, name, parentId }, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_drive',
    operation: 'copyFile',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { fileId, name, parentId },
    responseMeta: (result) => ({ id: result?.id, name: result?.name }),
  }, async () => {
    const drive = driveClient();
    const created = await drive.files.copy({
      fileId,
      requestBody: { name, parents: parentId ? [parentId] : undefined },
      fields: 'id,name,mimeType,webViewLink',
      supportsAllDrives: true,
    });
    return created.data;
  });
}

async function getFileMeta(fileId, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_drive',
    operation: 'getFileMeta',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { fileId },
    responseMeta: (result) => ({
      id: result?.id,
      name: result?.name,
      mimeType: result?.mimeType,
      size: result?.size,
    }),
  }, async () => {
    const drive = driveClient();
    const response = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size,webViewLink,owners(emailAddress),modifiedTime,parents',
      supportsAllDrives: true,
    });
    return response.data;
  });
}

async function downloadFileBuffer(fileId, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_drive',
    operation: 'downloadFileBuffer',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { fileId },
    responseMeta: (result) => ({
      mimeType: result?.mimeType,
      size: result?.buffer?.length || 0,
    }),
  }, async () => {
    const drive = driveClient();
    const meta = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType',
      supportsAllDrives: true,
    });
    const mimeType = meta.data.mimeType || 'application/octet-stream';

    const exportable = new Set([
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.spreadsheet',
      'application/vnd.google-apps.presentation',
      'application/vnd.google-apps.drawing',
    ]);

    if (exportable.has(mimeType)) {
      const response = await drive.files.export(
        { fileId, mimeType: 'application/pdf' },
        { responseType: 'arraybuffer' }
      );
      return {
        buffer: Buffer.from(response.data),
        mimeType: 'application/pdf',
      };
    }

    const response = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );
    return {
      buffer: Buffer.from(response.data),
      mimeType,
    };
  });
}

async function listFiles({ folderId, sharedDriveId }, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_drive',
    operation: 'listFiles',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { folderId },
    responseMeta: (result) => ({ count: result?.length || 0 }),
  }, async () => {
    const drive = driveClient();
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,owners(displayName,emailAddress))',
      orderBy: 'modifiedTime desc',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: sharedDriveId ? 'drive' : 'user',
      driveId: sharedDriveId || undefined,
    });
    return response.data.files || [];
  });
}

async function createNativeFile({ name, mimeType, folderId }, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_drive',
    operation: 'createNativeFile',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { name, mimeType, folderId },
    responseMeta: (result) => ({ id: result?.id, name: result?.name }),
  }, async () => {
    const drive = driveClient();
    const created = await drive.files.create({
      requestBody: { name, mimeType, parents: folderId ? [folderId] : undefined },
      fields: 'id,name,mimeType,webViewLink,iconLink',
      supportsAllDrives: true,
    });
    return created.data;
  });
}

// Lists who already has direct access to a folder, so ensureFolderMember can
// skip adding someone twice — Drive doesn't dedupe permissions.create by
// email/role, it'll just create a second permission for the same person.
async function listFolderMembers(folderId, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_drive',
    operation: 'listFolderMembers',
    requestMeta: { folderId },
    responseMeta: (result) => ({ count: result?.length || 0 }),
  }, async () => {
    const drive = driveClient();
    const response = await drive.permissions.list({
      fileId: folderId,
      supportsAllDrives: true,
      fields: 'permissions(id,emailAddress,role)',
    });
    return response.data.permissions || [];
  });
}

// Adds someone as a direct member of a division's Shared Drive folder (not
// just reachable through the app's own Division Storage UI) — 'fileOrganizer'
// is the API name for what the Shared Drive UI calls "Content Manager".
async function ensureFolderMember({ folderId, email, role = 'fileOrganizer' }, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_drive',
    operation: 'ensureFolderMember',
    requestMeta: { folderId, email, role },
    responseMeta: (result) => ({ added: result?.added }),
  }, async () => {
    const existing = await listFolderMembers(folderId, ctx);
    const already = existing.find((permission) => permission.emailAddress?.toLowerCase() === email.toLowerCase());
    if (already) return { added: false, reason: 'already_member', role: already.role };

    const drive = driveClient();
    await drive.permissions.create({
      fileId: folderId,
      supportsAllDrives: true,
      sendNotificationEmail: false,
      requestBody: { type: 'user', role, emailAddress: email },
      fields: 'id',
    });
    return { added: true };
  });
}

async function deleteFile(fileId, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_drive',
    operation: 'deleteFile',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { fileId },
    responseMeta: () => ({ deleted: true }),
  }, async () => {
    const drive = driveClient();
    // A hard delete 404s for the service account on Shared Drive items even
    // with Content Manager access — trashing is what that role can actually
    // do, and it removes the file from every listing here just the same.
    await drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
    return { deleted: true };
  });
}

// ------------------------------------------------------------ Word ↔ Google Docs
// Documents made from templates (migration 115) travel as .docx: a Google Doc
// is exported to Word, joined with a division's kop, and imported back.
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';

/** A Google Doc as a .docx Buffer. */
async function exportDocx(fileId, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_drive',
    operation: 'exportDocx',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { fileId },
    responseMeta: (result) => ({ size: result?.length || 0 }),
  }, async () => {
    const response = await driveClient().files.export({ fileId, mimeType: DOCX_MIME }, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  });
}

/** A .docx Buffer imported as a new Google Doc in a Shared Drive folder. */
async function importDocx({ name, buffer, parentId: requestedParent }, ctx = {}) {
  const parentId = sharedDriveTarget(requestedParent);
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_drive',
    operation: 'importDocx',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { name, parentId, size: buffer?.length || 0 },
    responseMeta: (result) => ({ id: result?.id, name: result?.name }),
  }, async () => {
    const { Readable } = require('stream');
    const created = await driveClient().files.create({
      requestBody: { name, mimeType: GOOGLE_DOC_MIME, parents: [parentId] },
      media: { mimeType: DOCX_MIME, body: Readable.from(buffer) },
      fields: 'id,name,mimeType,webViewLink',
      supportsAllDrives: true,
    });
    return created.data;
  });
}

// Google's own conversion engine, for "Pengajuan dokumen" and Prakasa AI
// (owner, 3 Oct 2026: create native Google files and convert between formats
// without LibreOffice): an Office/ODF buffer imported as a native Google file,
// and a native file exported as PDF or Office.
const NATIVE_OF = Object.freeze({
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': GOOGLE_DOC_MIME,
  'application/vnd.oasis.opendocument.text': GOOGLE_DOC_MIME,
  'application/rtf': GOOGLE_DOC_MIME,
  'text/plain': GOOGLE_DOC_MIME,
  'text/html': GOOGLE_DOC_MIME,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.oasis.opendocument.spreadsheet': 'application/vnd.google-apps.spreadsheet',
  'text/csv': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/vnd.google-apps.presentation',
  'application/vnd.oasis.opendocument.presentation': 'application/vnd.google-apps.presentation',
});
const nativeMimeFor = (sourceMime) => NATIVE_OF[String(sourceMime || '').split(';')[0].trim()] || null;

/** A buffer imported as a native Google file (Doc, Sheet or Slides) in a Shared Drive folder. */
async function importAsNative({ name, buffer, sourceMime, targetMime, parentId: requestedParent }, ctx = {}) {
  const target = targetMime || nativeMimeFor(sourceMime);
  if (!target) throw Object.assign(new Error(`Format ${sourceMime} tidak bisa diubah menjadi file Google`), { status: 400, code: 'VALIDATION_ERROR' });
  const parentId = sharedDriveTarget(requestedParent);
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_drive',
    operation: 'importAsNative',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { name, parentId, sourceMime, targetMime: target, size: buffer?.length || 0 },
    responseMeta: (result) => ({ id: result?.id, name: result?.name, mimeType: result?.mimeType }),
  }, async () => {
    const { Readable } = require('stream');
    const created = await driveClient().files.create({
      requestBody: { name, mimeType: target, parents: [parentId] },
      media: { mimeType: sourceMime, body: Readable.from(buffer) },
      fields: 'id,name,mimeType,size,webViewLink,owners(emailAddress)',
      supportsAllDrives: true,
    });
    return created.data;
  });
}

/** A native Google file exported in the given format (PDF, DOCX, XLSX, PPTX, text…). */
async function exportFile(fileId, mimeType, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_drive',
    operation: 'exportFile',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { fileId, mimeType },
    responseMeta: (result) => ({ size: result?.length || 0 }),
  }, async () => {
    const response = await driveClient().files.export({ fileId, mimeType }, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  });
}

/** Replaces the content of an existing Google Doc with a .docx (same file, same link). */
async function replaceDocContent({ fileId, buffer }, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_drive',
    operation: 'replaceDocContent',
    subjectType: ctx.subjectType || null,
    subjectId: ctx.subjectId || null,
    requestMeta: { fileId, size: buffer?.length || 0 },
    responseMeta: (result) => ({ id: result?.id }),
  }, async () => {
    const { Readable } = require('stream');
    const updated = await driveClient().files.update({
      fileId,
      media: { mimeType: DOCX_MIME, body: Readable.from(buffer) },
      fields: 'id,name,webViewLink',
      supportsAllDrives: true,
    });
    return updated.data;
  });
}

module.exports = {
  NATIVE_OF,
  nativeMimeFor,
  importAsNative,
  exportFile,
  ensureFolder,
  uploadFile,
  copyFile,
  getFileMeta,
  downloadFileBuffer,
  deleteFile,
  listFiles,
  createNativeFile,
  exportDocx,
  importDocx,
  replaceDocContent,
  sharedDriveTarget,
  listFolderMembers,
  ensureFolderMember,
  driveClient,
};
