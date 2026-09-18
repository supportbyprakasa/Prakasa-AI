const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const drive = require('../services/googleDrive.service');
const { resolveFolder } = require('./folderMappingRules.controller');

async function list(req, res, next) {
  try {
    const where = ['t.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('t.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.documentType) { where.push('t.document_type = ?'); args.push(req.query.documentType); }
    const [rows] = await pool.query(
      `SELECT t.id, t.entity_id AS entityId, t.department_id AS departmentId,
              t.name, t.document_type AS documentType, t.description,
              t.drive_template_file_id AS driveTemplateFileId, t.is_active AS isActive,
              t.created_at AS createdAt
         FROM document_templates t
        WHERE ${where.join(' AND ')}
        ORDER BY t.id DESC`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM document_templates WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Template tidak ditemukan', 404);
    const [placeholders] = await pool.query(
      `SELECT id, \`key\`, label, field_type AS fieldType, default_value AS defaultValue, required
         FROM template_placeholders WHERE template_id=?`, [id]
    );
    return ok(res, { ...rows[0], placeholders });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const {
      entityId, departmentId, name, documentType, description,
      driveTemplateFileId, placeholders = [],
    } = req.body;
    await conn.beginTransaction();
    const [t] = await conn.query(
      `INSERT INTO document_templates
       (entity_id, department_id, name, document_type, description,
        drive_template_file_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entityId, departmentId || null, name, documentType, description || null,
       driveTemplateFileId, req.user.sub]
    );
    for (const ph of placeholders) {
      await conn.query(
        `INSERT INTO template_placeholders
         (template_id, \`key\`, label, field_type, default_value, required)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [t.insertId, ph.key, ph.label, ph.fieldType || 'text',
         ph.defaultValue || null, ph.required ? 1 : 0]
      );
    }
    await conn.commit();
    await log({
      entityId, userId: req.user.sub,
      action: 'template.create', subjectType: 'document_template',
      subjectId: t.insertId, metadata: { name, documentType },
    });
    return ok(res, { id: t.insertId }, undefined, 201);
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { name, description, isActive } = req.body;
    const [r] = await pool.query(
      `UPDATE document_templates SET name=?, description=?, is_active=?
        WHERE id=? AND deleted_at IS NULL`,
      [name, description || null, isActive ? 1 : 0, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Template tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'template.update', subjectType: 'document_template', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE document_templates SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Template tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'template.delete', subjectType: 'document_template', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

/**
 * Generate dokumen baru dari template.
 * - Copy file template di Drive (nama: "{title} - {timestamp}")
 * - Simpan sebagai documents + document_versions v1
 * - Placeholder: karena isi file Docs harus diubah lewat Docs API (bukan string replace),
 *   fase ini hanya menyimpan nilai placeholder ke metadata; pengisian aktual ke file
 *   dilakukan di Fase 3 saat workflow approval sudah ada.
 */
async function useTemplate(req, res, next) {
  try {
    const { id } = req.params;
    const { title, entityId, departmentId, values = {} } = req.body;

    const [tRows] = await pool.query(
      `SELECT * FROM document_templates WHERE id=? AND deleted_at IS NULL`, [id]
    );
    const tpl = tRows[0];
    if (!tpl) return fail(res, 'NOT_FOUND', 'Template tidak ditemukan', 404);

    const folderId = await resolveFolder({
      entityId: Number(entityId || tpl.entity_id),
      departmentId: departmentId ? Number(departmentId) : tpl.department_id,
      documentType: tpl.document_type,
    });

    const copy = await drive.copyFile({
      fileId: tpl.drive_template_file_id,
      name: `${title || tpl.name} - ${new Date().toISOString().slice(0, 10)}`,
      parentId: folderId || undefined,
    });

    await pool.query(
      `INSERT INTO drive_files_metadata
       (entity_id, department_id, drive_file_id, drive_folder_id, name, mime_type, web_view_link)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name)`,
      [tpl.entity_id, tpl.department_id, copy.id, folderId || null,
       copy.name, copy.mimeType, copy.webViewLink]
    );

    const [doc] = await pool.query(
      `INSERT INTO documents
       (entity_id, department_id, title, document_type, status,
        drive_file_id, drive_folder_id, template_id, created_by)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      [tpl.entity_id, tpl.department_id, title || tpl.name, tpl.document_type,
       copy.id, folderId || null, tpl.id, req.user.sub]
    );

    const [ver] = await pool.query(
      `INSERT INTO document_versions (document_id, version_no, drive_file_id, notes, created_by)
       VALUES (?, 1, ?, ?, ?)`,
      [doc.insertId, copy.id, 'Generated from template', req.user.sub]
    );
    await pool.query(`UPDATE documents SET current_version_id=? WHERE id=?`, [ver.insertId, doc.insertId]);

    await log({
      entityId: tpl.entity_id, userId: req.user.sub,
      action: 'template.use', subjectType: 'document', subjectId: doc.insertId,
      metadata: { templateId: tpl.id, values },
    });

    return ok(res, {
      documentId: doc.insertId,
      driveFileId: copy.id,
      webViewLink: copy.webViewLink,
    }, undefined, 201);
  } catch (e) { next(e); }
}

module.exports = { list, detail, create, update, remove, useTemplate };
