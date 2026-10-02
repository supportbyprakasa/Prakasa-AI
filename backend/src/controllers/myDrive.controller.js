const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const myDrive = require('../services/googleMyDrive.service');

const KIND_MIME = {
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
};

// Impersonating a user who has no matching Google Workspace account (a wrong
// or made-up email on their Prakasa Workspace profile) fails auth with
// invalid_grant — surface that as a clear, actionable error instead of a
// generic 500, since every user hits this page, not just admins.
function isGoogleAccountMissing(error) {
  return /invalid_grant|invalid email or user id/i.test(error.message || '');
}

function handleError(error, res, next) {
  if (isGoogleAccountMissing(error)) {
    return fail(
      res, 'GOOGLE_ACCOUNT_NOT_LINKED',
      'Email Anda belum terhubung ke akun Google Workspace yang valid. Hubungi admin.', 404
    );
  }
  // googleapis sets .status/.code to the raw HTTP status Google returned (e.g.
  // 401 when the service account's domain-wide delegation isn't authorized for
  // the Drive scope yet) — errorHandler would otherwise forward that as THIS
  // route's own HTTP status, and the frontend treats any 401 from anywhere as
  // "your Prakasa Workspace session expired" and force-logs the user out.
  if ([401, 403].includes(error.status) || [401, 403].includes(error.code)) {
    return fail(
      res, 'GOOGLE_DRIVE_UNAVAILABLE',
      'Google Drive belum bisa diakses untuk akun ini. Hubungi admin.', 502
    );
  }
  next(error);
}

async function listFiles(req, res, next) {
  try {
    const folderId = req.query.folderId || null;
    const files = await myDrive.listFiles(
      req.user.email, { folderId }, { entityId: req.user.entityId, userId: req.user.sub }
    );
    return ok(res, { folderId: folderId || 'root', files });
  } catch (error) { handleError(error, res, next); }
}

async function createFolder(req, res, next) {
  try {
    const { name, parentId } = req.body;
    const created = await myDrive.createFolder(
      req.user.email, { name, parentId }, { entityId: req.user.entityId, userId: req.user.sub }
    );
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'mydrive.create_folder', subjectType: 'drive_file',
      metadata: { name, parentId: parentId || 'root', driveFileId: created.id },
    });
    return ok(res, created, undefined, 201);
  } catch (error) { handleError(error, res, next); }
}

async function createFile(req, res, next) {
  try {
    const { name, kind, parentId } = req.body;
    const mimeType = KIND_MIME[kind];
    if (!mimeType) return fail(res, 'VALIDATION_ERROR', 'kind tidak dikenal', 400);
    const created = await myDrive.createNativeFile(
      req.user.email, { name, mimeType, folderId: parentId }, { entityId: req.user.entityId, userId: req.user.sub }
    );
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'mydrive.create_file', subjectType: 'drive_file',
      metadata: { name, kind, parentId: parentId || 'root', driveFileId: created.id },
    });
    return ok(res, created, undefined, 201);
  } catch (error) { handleError(error, res, next); }
}

async function uploadFile(req, res, next) {
  try {
    if (!req.file) return fail(res, 'VALIDATION_ERROR', 'File wajib diunggah', 400);
    const { parentId } = req.body;
    const uploaded = await myDrive.uploadFile(
      req.user.email,
      { name: req.file.originalname, mimeType: req.file.mimetype, buffer: req.file.buffer, folderId: parentId },
      { entityId: req.user.entityId, userId: req.user.sub }
    );
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'mydrive.upload_file', subjectType: 'drive_file',
      metadata: { name: uploaded.name, parentId: parentId || 'root', driveFileId: uploaded.id },
    });
    return ok(res, uploaded, undefined, 201);
  } catch (error) { handleError(error, res, next); }
}

async function removeFile(req, res, next) {
  try {
    const { fileId } = req.params;
    // Impersonation means Drive itself already scopes every call to files this
    // user can act on — no extra ownership check needed like division-storage's
    // (which acts through the always-privileged service account instead).
    const meta = await myDrive.getFileMeta(req.user.email, fileId, { entityId: req.user.entityId, userId: req.user.sub });
    await myDrive.deleteFile(req.user.email, fileId, { entityId: req.user.entityId, userId: req.user.sub });
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'mydrive.remove_file', subjectType: 'drive_file',
      metadata: { driveFileId: fileId, name: meta.name },
    });
    return ok(res, { id: fileId, removed: true });
  } catch (error) { handleError(error, res, next); }
}

module.exports = { listFiles, createFolder, createFile, uploadFile, removeFile };
