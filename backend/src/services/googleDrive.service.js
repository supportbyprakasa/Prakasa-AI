const { google } = require('googleapis');

// Service account + Shared Drive (domain-wide delegation opsional).
// Isi env:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  (escape \n)
//   GOOGLE_SHARED_DRIVE_ID             (opsional, kalau mau default ke satu Shared Drive)

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

async function ensureFolder({ name, parentId, sharedDriveId }) {
  const drive = driveClient();
  const q = [
    `mimeType='application/vnd.google-apps.folder'`,
    `name='${name.replace(/'/g, "\\'")}'`,
    `trashed=false`,
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
}

async function uploadFile({ name, mimeType, buffer, parentId }) {
  const drive = driveClient();
  const { Readable } = require('stream');
  const created = await drive.files.create({
    requestBody: { name, parents: parentId ? [parentId] : undefined },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id,name,mimeType,size,webViewLink,owners(emailAddress)',
    supportsAllDrives: true,
  });
  return created.data;
}

async function copyFile({ fileId, name, parentId }) {
  const drive = driveClient();
  const created = await drive.files.copy({
    fileId,
    requestBody: { name, parents: parentId ? [parentId] : undefined },
    fields: 'id,name,mimeType,webViewLink',
    supportsAllDrives: true,
  });
  return created.data;
}

async function getFileMeta(fileId) {
  const drive = driveClient();
  const r = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,size,webViewLink,owners(emailAddress),modifiedTime',
    supportsAllDrives: true,
  });
  return r.data;
}

module.exports = { ensureFolder, uploadFile, copyFile, getFileMeta, driveClient };
