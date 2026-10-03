const { google } = require('googleapis');
const { Readable } = require('stream');
const integrationLog = require('./integrationLog.service');

// Unlike googleDrive.service.js (which acts as the service account itself,
// a direct member of the Prakasa Workspace Shared Drive), every call here
// impersonates the real Workspace user via domain-wide delegation — reading
// or changing their own My Drive, never anyone else's. Requires the Drive
// scope to be authorized for this service account's Client ID in Admin
// Console (Security > API controls > Domain-wide delegation).
function getAuth(subject) {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject,
  });
}

function driveClient(subject) {
  return google.drive({ version: 'v3', auth: getAuth(subject) });
}

const FILE_FIELDS = 'files(id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size,parents,owners(displayName,emailAddress))';

async function listFiles(subject, { folderId } = {}, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_mydrive',
    operation: 'listFiles',
    requestMeta: { subject, folderId: folderId || 'root' },
    responseMeta: (result) => ({ count: result?.length || 0 }),
  }, async () => {
    const drive = driveClient(subject);
    const response = await drive.files.list({
      q: `'${folderId || 'root'}' in parents and trashed=false`,
      fields: FILE_FIELDS,
      orderBy: 'folder,modifiedTime desc',
      pageSize: 200,
    });
    return response.data.files || [];
  });
}

async function getFileMeta(subject, fileId, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_mydrive',
    operation: 'getFileMeta',
    requestMeta: { subject, fileId },
    responseMeta: (result) => ({ id: result?.id, name: result?.name }),
  }, async () => {
    const drive = driveClient(subject);
    const response = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size,webViewLink,parents,modifiedTime,owners(emailAddress)',
    });
    return response.data;
  });
}

async function createFolder(subject, { name, parentId }, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_mydrive',
    operation: 'createFolder',
    requestMeta: { subject, name, parentId: parentId || 'root' },
    responseMeta: (result) => ({ id: result?.id, name: result?.name }),
  }, async () => {
    const drive = driveClient(subject);
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId || 'root'],
      },
      fields: 'id,name,mimeType,webViewLink',
    });
    return created.data;
  });
}

async function createNativeFile(subject, { name, mimeType, folderId }, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_mydrive',
    operation: 'createNativeFile',
    requestMeta: { subject, name, mimeType, folderId: folderId || 'root' },
    responseMeta: (result) => ({ id: result?.id, name: result?.name }),
  }, async () => {
    const drive = driveClient(subject);
    const created = await drive.files.create({
      requestBody: { name, mimeType, parents: [folderId || 'root'] },
      fields: 'id,name,mimeType,webViewLink,iconLink',
    });
    return created.data;
  });
}

async function uploadFile(subject, { name, mimeType, buffer, folderId }, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_mydrive',
    operation: 'uploadFile',
    requestMeta: { subject, name, mimeType, size: Buffer.isBuffer(buffer) ? buffer.length : null, folderId: folderId || 'root' },
    responseMeta: (result) => ({ id: result?.id, name: result?.name }),
  }, async () => {
    const drive = driveClient(subject);
    const created = await drive.files.create({
      requestBody: { name, parents: [folderId || 'root'] },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id,name,mimeType,size,webViewLink,iconLink',
    });
    return created.data;
  });
}

async function deleteFile(subject, fileId, ctx = {}) {
  return integrationLog.wrap({
    entityId: ctx.entityId || null,
    userId: ctx.userId || null,
    provider: 'google_mydrive',
    operation: 'deleteFile',
    requestMeta: { subject, fileId },
    responseMeta: () => ({ deleted: true }),
  }, async () => {
    const drive = driveClient(subject);
    // Trash, not a hard delete — reversible from the user's own Drive trash,
    // and consistent with how googleDrive.service.js treats Shared Drive files.
    await drive.files.update({ fileId, requestBody: { trashed: true } });
    return { deleted: true };
  });
}

module.exports = { listFiles, getFileMeta, createFolder, createNativeFile, uploadFile, deleteFile, driveClient };
