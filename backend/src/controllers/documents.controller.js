const crypto = require('crypto');
const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const drive = require('../services/googleDrive.service');
const { resolveFolder } = require('./folderMappingRules.controller');

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = ['d.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('d.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.departmentId) { where.push('d.department_id = ?'); args.push(req.query.departmentId); }
    if (req.query.documentType) { where.push('d.document_type = ?'); args.push(req.query.documentType); }
    if (req.query.status) { where.push('d.status = ?'); args.push(req.query.status); }
    if (req.query.q) { where.push('d.title LIKE ?'); args.push(`%${req.query.q}%`); }

    const [rows] = await pool.query(
      `SELECT d.id, d.title, d.document_type AS documentType, d.status,
              d.drive_file_id AS driveFileId, d.drive_folder_id AS driveFolderId,
              d.template_id AS templateId, d.created_by AS createdBy,
              d.created_at AS createdAt, d.updated_at AS updatedAt,
              f.web_view_link AS webViewLink
         FROM documents d
         LEFT JOIN drive_files_metadata f ON f.drive_file_id = d.drive_file_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.id DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM documents d WHERE ${where.join(' AND ')}`, args
    );
    return ok(res, rows, { page, limit, total });
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT d.*, f.web_view_link AS webViewLink
         FROM documents d
         LEFT JOIN drive_files_metadata f ON f.drive_file_id = d.drive_file_id
        WHERE d.id=? AND d.deleted_at IS NULL`, [id]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Dokumen tidak ditemukan', 404);
    const [versions] = await pool.query(
      `SELECT id, version_no AS versionNo, drive_file_id AS driveFileId,
              drive_file_mime AS driveFileMime, size, notes, created_at AS createdAt
         FROM document_versions WHERE document_id=? ORDER BY version_no DESC`, [id]
    );
    return ok(res, { ...rows[0], versions });
  } catch (e) { next(e); }
}

/**
 * Upload file baru sebagai dokumen.
 * Wajib: entityId, title, documentType, dan file (multipart).
 * Otomatis:
 *  - cari folder tujuan lewat folder_mapping_rules
 *  - upload ke Google Drive
 *  - simpan metadata + document + version 1
 *  - catat activity log
 */
async function upload(req, res, next) {
  try {
    const { entityId, departmentId, title, documentType, templateId } = req.body;
    if (!req.file) return fail(res, 'VALIDATION_ERROR', 'File wajib diunggah', 400);

    const folderId = await resolveFolder({
      entityId: Number(entityId),
      departmentId: departmentId ? Number(departmentId) : null,
      documentType,
    });

    const uploaded = await drive.uploadFile({
      name: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
      parentId: folderId || undefined,
    });

    const checksum = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

    await pool.query(
      `INSERT INTO drive_files_metadata
       (entity_id, department_id, drive_file_id, drive_folder_id, name, mime_type,
        size, web_view_link, checksum)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), size=VALUES(size), checksum=VALUES(checksum)`,
      [entityId, departmentId || null, uploaded.id, folderId || null,
       uploaded.name, uploaded.mimeType || req.file.mimetype,
       Number(uploaded.size || req.file.size), uploaded.webViewLink || null, checksum]
    );

    const [doc] = await pool.query(
      `INSERT INTO documents
       (entity_id, department_id, title, document_type, status,
        drive_file_id, drive_folder_id, template_id, created_by)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [entityId, departmentId || null, title, documentType,
       uploaded.id, folderId || null, templateId || null, req.user.sub]
    );

    const [ver] = await pool.query(
      `INSERT INTO document_versions
       (document_id, version_no, drive_file_id, drive_file_mime, size, checksum, created_by)
       VALUES (?, 1, ?, ?, ?, ?, ?)`,
      [doc.insertId, uploaded.id, uploaded.mimeType || req.file.mimetype,
       Number(uploaded.size || req.file.size), checksum, req.user.sub]
    );
    await pool.query(`UPDATE documents SET current_version_id=? WHERE id=?`, [ver.insertId, doc.insertId]);

    await log({
      entityId: Number(entityId), userId: req.user.sub,
      action: 'document.upload', subjectType: 'document', subjectId: doc.insertId,
      metadata: { title, documentType, driveFileId: uploaded.id, folderId },
    });

    return ok(res, {
      id: doc.insertId,
      driveFileId: uploaded.id,
      webViewLink: uploaded.webViewLink,
    }, undefined, 201);
  } catch (e) { next(e); }
}

async function link(req, res, next) {
  try {
    const { entityId, departmentId, title, documentType, driveFileId, templateId } = req.body;
    const meta = await drive.getFileMeta(driveFileId);
    await pool.query(
      `INSERT INTO drive_files_metadata
       (entity_id, department_id, drive_file_id, name, mime_type, web_view_link, owner_email)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), web_view_link=VALUES(web_view_link)`,
      [entityId, departmentId || null, meta.id, meta.name, meta.mimeType,
       meta.webViewLink, meta.owners?.[0]?.emailAddress || null]
    );
    const [doc] = await pool.query(
      `INSERT INTO documents
       (entity_id, department_id, title, document_type, status, drive_file_id, template_id, created_by)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [entityId, departmentId || null, title || meta.name, documentType,
       meta.id, templateId || null, req.user.sub]
    );
    await log({
      entityId: Number(entityId), userId: req.user.sub,
      action: 'document.link', subjectType: 'document', subjectId: doc.insertId,
      metadata: { driveFileId: meta.id, title },
    });
    return ok(res, { id: doc.insertId, webViewLink: meta.webViewLink }, undefined, 201);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { title, documentType, status } = req.body;
    const [r] = await pool.query(
      `UPDATE documents SET title=?, document_type=?, status=?
        WHERE id=? AND deleted_at IS NULL`,
      [title, documentType, status, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Dokumen tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'document.update', subjectType: 'document', subjectId: Number(id),
      metadata: { title, documentType, status },
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE documents SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Dokumen tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'document.delete', subjectType: 'document', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function versions(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT id, version_no AS versionNo, drive_file_id AS driveFileId,
              drive_file_mime AS driveFileMime, size, checksum, notes,
              created_by AS createdBy, created_at AS createdAt
         FROM document_versions WHERE document_id=? ORDER BY version_no DESC`, [id]
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

module.exports = { list, detail, upload, link, update, remove, versions };
