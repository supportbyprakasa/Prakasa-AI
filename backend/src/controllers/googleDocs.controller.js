const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const { handleGoogleError } = require('../services/googleUserClient');
const files = require('../services/googleWorkspaceFiles.service');

// Google Docs / Sheets / Slides home. The subject is ALWAYS req.user.email —
// the client can pick a kind, a tab, a search text and a page, never a user.
const SERVICE = { service: 'Google Drive' };
const ctxOf = (req) => ({ entityId: req.user.entityId, userId: req.user.sub });
const badRequest = (res, message) => fail(res, 'VALIDATION_ERROR', message, 400);

function readFileId(req, res) {
  const { fileId } = req.params;
  if (!files.isValidFileId(fileId)) {
    badRequest(res, 'ID file tidak valid');
    return null;
  }
  return fileId;
}

async function listFiles(req, res, next) {
  try {
    const { kind, scope = 'recent', q = '', pageToken, pageSize } = req.query;
    if (!files.isKind(kind)) return badRequest(res, 'Jenis file tidak dikenal');
    if (!files.isScope(scope)) return badRequest(res, 'Tab tidak dikenal');
    if (typeof q !== 'string') return badRequest(res, 'Pencarian tidak valid');
    if (pageToken !== undefined && pageToken !== '' && !files.isValidPageToken(pageToken)) {
      return badRequest(res, 'Halaman tidak valid');
    }
    const result = await files.listFiles(req.user.email, {
      kind,
      scope,
      search: files.normalizeSearch(q),
      pageToken: pageToken || null,
      pageSize: files.clampPageSize(pageSize),
    }, ctxOf(req));
    return ok(res, { kind, scope, ...result });
  } catch (error) { return handleGoogleError(error, res, next, SERVICE); }
}

async function getFile(req, res, next) {
  const fileId = readFileId(req, res);
  if (!fileId) return undefined;
  try {
    const file = await files.getFile(req.user.email, fileId, ctxOf(req));
    if (!file.kind) return fail(res, 'UNSUPPORTED_FILE', 'File ini bukan dokumen, spreadsheet, atau presentasi.', 404);
    return ok(res, file);
  } catch (error) { return handleGoogleError(error, res, next, SERVICE); }
}

async function createFile(req, res, next) {
  const { kind, name } = req.body || {};
  if (!files.isKind(kind)) return badRequest(res, 'Jenis file tidak dikenal');
  if (name !== undefined && name !== null && typeof name !== 'string') return badRequest(res, 'Nama file tidak valid');
  const finalName = files.normalizeName(name) || files.DEFAULT_NAME[kind];
  try {
    const created = await files.createFile(req.user.email, { kind, name: finalName }, ctxOf(req));
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'google_docs.create_file', subjectType: 'drive_file',
      metadata: { kind, driveFileId: created.id },
    });
    return ok(res, created, undefined, 201);
  } catch (error) { return handleGoogleError(error, res, next, SERVICE); }
}

// Rename / trash only act on files of the Docs/Sheets/Slides family that
// Drive itself says this user may rename / trash.
async function loadEditable(req, res, fileId, capability) {
  const file = await files.getFile(req.user.email, fileId, ctxOf(req));
  if (!file.kind) {
    fail(res, 'UNSUPPORTED_FILE', 'File ini bukan dokumen, spreadsheet, atau presentasi.', 404);
    return null;
  }
  if (!file[capability]) {
    fail(res, 'FORBIDDEN', capability === 'canTrash'
      ? 'Anda tidak bisa memindahkan file ini ke sampah. Hanya pemilik file yang bisa.'
      : 'Anda tidak punya izin mengganti nama file ini.', 403);
    return null;
  }
  return file;
}

async function renameFile(req, res, next) {
  const fileId = readFileId(req, res);
  if (!fileId) return undefined;
  const raw = req.body?.name;
  const name = files.normalizeName(raw);
  if (typeof raw !== 'string' || !name) return badRequest(res, 'Nama file wajib diisi');
  try {
    const file = await loadEditable(req, res, fileId, 'canRename');
    if (!file) return undefined;
    const updated = await files.renameFile(req.user.email, fileId, name, ctxOf(req));
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'google_docs.rename_file', subjectType: 'drive_file',
      metadata: { kind: file.kind, driveFileId: fileId },
    });
    return ok(res, updated);
  } catch (error) { return handleGoogleError(error, res, next, SERVICE); }
}

async function trashFile(req, res, next) {
  const fileId = readFileId(req, res);
  if (!fileId) return undefined;
  try {
    const file = await loadEditable(req, res, fileId, 'canTrash');
    if (!file) return undefined;
    await files.trashFile(req.user.email, fileId, ctxOf(req));
    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'google_docs.trash_file', subjectType: 'drive_file',
      metadata: { kind: file.kind, driveFileId: fileId },
    });
    return ok(res, { id: fileId, trashed: true });
  } catch (error) { return handleGoogleError(error, res, next, SERVICE); }
}

async function thumbnail(req, res, next) {
  const fileId = readFileId(req, res);
  if (!fileId) return undefined;
  try {
    const image = await files.fetchThumbnail(req.user.email, fileId, ctxOf(req));
    if (!image) return fail(res, 'NOT_FOUND', 'Pratinjau tidak tersedia', 404);
    res.set({
      'Content-Type': image.contentType,
      'Cache-Control': 'private, max-age=900',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.status(200).send(image.buffer);
  } catch (error) { return handleGoogleError(error, res, next, SERVICE); }
}

module.exports = { listFiles, getFile, createFile, renameFile, trashFile, thumbnail };
