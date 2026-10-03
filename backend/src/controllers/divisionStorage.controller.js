const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { resolveFolder } = require('./folderMappingRules.controller');
const drive = require('../services/googleDrive.service');
const { log } = require('../services/activityLog.service');

const KIND_MIME = {
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
};

function hasPerm(user, code) {
  return Boolean(user && (user.permissions || []).includes(code));
}

// A user may browse their own division's folder; ai_command-style cross-division
// permission opens every division in the entity, same rule used elsewhere for
// "who may act outside their own department".
async function assertDepartmentAccess(user, departmentId) {
  if (hasPerm(user, 'workspace.cross_division.view')) return true;
  if (Number(user.departmentId) === Number(departmentId)) return true;
  return false;
}

async function listDivisions(req, res, next) {
  try {
    const crossDivision = hasPerm(req.user, 'workspace.cross_division.view');
    if (!crossDivision && !req.user.departmentId) {
      return ok(res, { divisions: [], defaultDepartmentId: null });
    }
    const [rows] = await pool.query(
      `SELECT id, name, code FROM departments
        WHERE entity_id=? AND deleted_at IS NULL ${crossDivision ? '' : 'AND id=?'}
        ORDER BY name`,
      crossDivision ? [req.user.entityId] : [req.user.entityId, req.user.departmentId]
    );
    return ok(res, {
      divisions: rows.map((row) => ({ id: row.id, name: row.name, code: row.code })),
      defaultDepartmentId: req.user.departmentId || null,
    });
  } catch (e) { next(e); }
}

// Shared by every route below: confirm the caller may act on this department,
// then resolve its Shared Drive folder. Returns the folderId, or null after
// already sending the appropriate error response.
async function resolveDivisionFolder(req, res, departmentId) {
  if (!(await assertDepartmentAccess(req.user, departmentId))) {
    fail(res, 'FORBIDDEN', 'Tidak punya akses ke divisi ini', 403);
    return null;
  }
  const folderId = await resolveFolder({
    entityId: req.user.entityId, departmentId, documentType: '*',
  });
  if (!folderId) {
    fail(res, 'FOLDER_NOT_CONFIGURED', 'Folder Shared Drive divisi ini belum diatur.', 404);
    return null;
  }
  return folderId;
}

async function listFiles(req, res, next) {
  try {
    const departmentId = Number(req.query.departmentId);
    if (!departmentId) return fail(res, 'VALIDATION_ERROR', 'departmentId wajib diisi', 400);
    const folderId = await resolveDivisionFolder(req, res, departmentId);
    if (!folderId) return;
    const sharedDriveId = String(process.env.GOOGLE_SHARED_DRIVE_ID || '').trim() || null;
    const files = await drive.listFiles(
      { folderId, sharedDriveId },
      { entityId: req.user.entityId, userId: req.user.sub }
    );
    return ok(res, { folderId, files });
  } catch (e) { next(e); }
}

async function createFile(req, res, next) {
  try {
    const { departmentId, name, kind } = req.body;
    const mimeType = KIND_MIME[kind];
    if (!mimeType) return fail(res, 'VALIDATION_ERROR', 'kind tidak dikenal', 400);
    const folderId = await resolveDivisionFolder(req, res, departmentId);
    if (!folderId) return;
    const created = await drive.createNativeFile(
      { name, mimeType, folderId },
      { entityId: req.user.entityId, userId: req.user.sub }
    );
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'division_storage.create_file', subjectType: 'drive_file',
      metadata: { departmentId, kind, name, driveFileId: created.id },
    });
    return ok(res, created, undefined, 201);
  } catch (e) { next(e); }
}

async function removeFile(req, res, next) {
  try {
    const departmentId = Number(req.query.departmentId);
    const { fileId } = req.params;
    if (!departmentId) return fail(res, 'VALIDATION_ERROR', 'departmentId wajib diisi', 400);
    const folderId = await resolveDivisionFolder(req, res, departmentId);
    if (!folderId) return;

    // The fileId comes from the client — confirm it actually lives in this
    // division's folder before touching it, so a department-scoped permission
    // can never be used to trash an arbitrary Drive file elsewhere.
    const meta = await drive.getFileMeta(fileId, { entityId: req.user.entityId, userId: req.user.sub });
    if (!(meta.parents || []).includes(folderId)) {
      return fail(res, 'FORBIDDEN', 'File tidak ada di folder divisi ini', 403);
    }

    await drive.deleteFile(fileId, { entityId: req.user.entityId, userId: req.user.sub });
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'division_storage.remove_file', subjectType: 'drive_file',
      metadata: { departmentId, driveFileId: fileId, name: meta.name },
    });
    return ok(res, { id: fileId, removed: true });
  } catch (e) { next(e); }
}

module.exports = { listDivisions, listFiles, createFile, removeFile };
