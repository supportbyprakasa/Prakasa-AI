const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');
const drive = require('../services/googleDrive.service');
const itTicket = require('../services/itTicket.service');
const itSupport = require('../services/itSupport.service');

function canManage(req) {
  return (req.user.permissions || []).includes('it_ticket.manage');
}

function handleServiceError(error, res, next) {
  if (error.status) return fail(res, error.code || 'VALIDATION_ERROR', error.message, error.status);
  return next(error);
}

async function create(req, res, next) {
  try {
    const result = await itTicket.createTicket({
      entityId: req.user.entityId,
      departmentId: req.user.departmentId,
      requesterId: req.user.sub,
      category: req.body.category,
      title: req.body.title,
      description: req.body.description,
      priority: req.body.priority,
      deviceId: req.body.deviceId || null,
      sourcePage: req.body.sourcePage || null,
    });
    return ok(res, result, undefined, 201);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function supportSettings(req, res, next) {
  try {
    return ok(res, await itSupport.getSettings(req.user.entityId));
  } catch (error) {
    return next(error);
  }
}

async function saveSupportSettings(req, res, next) {
  try {
    return ok(res, await itSupport.saveSettings(req.user.entityId, req.body, req.user.sub, req.user));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function list(req, res, next) {
  try {
    const result = await itTicket.listTickets({
      entityId: req.user.entityId,
      requesterId: req.user.sub,
      canManage: canManage(req),
      status: req.query.status || null,
      category: req.query.category || null,
      priority: req.query.priority || null,
      q: req.query.q || null,
      page: req.query.page,
      limit: req.query.limit,
    });
    return ok(res, result.rows, { page: result.page, limit: result.limit, total: result.total });
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function detail(req, res, next) {
  try {
    const ticket = await itTicket.getTicket(req.params.id, { userId: req.user.sub, canManage: canManage(req) });
    return ok(res, ticket);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

// A ticket's own devices list: only devices assigned to the caller, for the create-ticket picker.
async function myDevices(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, asset_code AS assetCode, device_type AS deviceType, brand, model
         FROM devices
        WHERE current_assignee_id=? AND deleted_at IS NULL
        ORDER BY asset_code ASC`,
      [req.user.sub]
    );
    return ok(res, rows);
  } catch (error) {
    return next(error);
  }
}

async function updateStatus(req, res, next) {
  try {
    const result = await itTicket.updateStatus(req.params.id, {
      status: req.body.status, actorId: req.user.sub, canManage: canManage(req),
    });
    return ok(res, result);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function addComment(req, res, next) {
  try {
    const result = await itTicket.addComment(req.params.id, {
      authorId: req.user.sub, body: req.body.body, canManage: canManage(req),
    });
    return ok(res, result, undefined, 201);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function uploadAttachment(req, res, next) {
  try {
    const { id } = req.params;
    const ticket = await itTicket.getTicket(id, { userId: req.user.sub, canManage: canManage(req) });

    if (!req.file) return fail(res, 'VALIDATION_ERROR', 'Wajib melampirkan file', 400);

    const uploaded = await drive.uploadFile(
      { name: req.file.originalname, mimeType: req.file.mimetype, buffer: req.file.buffer },
      { entityId: ticket.entity_id, userId: req.user.sub, subjectType: 'it_ticket', subjectId: Number(id) }
    );

    const [result] = await pool.query(
      `INSERT INTO it_ticket_attachments
         (ticket_id, drive_file_id, web_view_link, name, mime_type, size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, uploaded.id, uploaded.webViewLink, uploaded.name || req.file.originalname,
        uploaded.mimeType || req.file.mimetype, Number(uploaded.size || req.file.size), req.user.sub]
    );

    await activityLog({
      entityId: ticket.entity_id, userId: req.user.sub, action: 'it_ticket.attachment.upload',
      subjectType: 'it_ticket', subjectId: Number(id), metadata: { driveFileId: uploaded.id },
    });

    return ok(res, { id: result.insertId, webViewLink: uploaded.webViewLink }, undefined, 201);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

module.exports = {
  supportSettings,
  saveSupportSettings, create, list, detail, myDevices, updateStatus, addComment, uploadAttachment };
