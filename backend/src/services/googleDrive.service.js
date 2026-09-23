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

async function uploadFile({ name, mimeType, buffer, parentId }, ctx = {}) {
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
      requestBody: { name, parents: parentId ? [parentId] : undefined },
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
      fields: 'id,name,mimeType,size,webViewLink,owners(emailAddress),modifiedTime',
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
    await drive.files.delete({ fileId, supportsAllDrives: true });
    return { deleted: true };
  });
}

module.exports = {
  ensureFolder,
  uploadFile,
  copyFile,
  getFileMeta,
  downloadFileBuffer,
  deleteFile,
  driveClient,
};
