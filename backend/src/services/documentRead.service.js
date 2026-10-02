const pool = require('../db/pool');
const { documentVisibilitySql } = require('./divisionAccess');
const docTemplates = require('./docTemplates.service');

// Read-only views of document records for one user (Prakasa AI,
// tools/documents.js): metadata and the Drive link only, never file content
// and never a Google call. Bound to the entity and to documentVisibilitySql
// (the rule of the documents list/detail and global search); templates and
// generated documents go through docTemplates.service with its own division rule.

const escapeLike = (value) => String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
const cap = (limit) => Math.min(100, Math.max(1, Number(limit) || 25));

/** Divisions of the user's entity: id, name, code (to resolve a division by name). */
async function divisions(user) {
  const [rows] = await pool.query(
    'SELECT id, name, code FROM departments WHERE entity_id = ? AND deleted_at IS NULL ORDER BY name',
    [user.entityId]
  );
  return rows.map((row) => ({ id: Number(row.id), name: row.name, code: row.code }));
}

/**
 * Document records the user may see. Filters: q (title or type), documentType,
 * status, departmentId, withFile (only records that have a Drive file).
 * Returns { rows, total }.
 */
async function searchDocuments(user, { q = '', documentType = '', status = '', departmentId = null, withFile = false, limit = 25 } = {}) {
  const visible = documentVisibilitySql(user, 'd');
  const where = ['d.deleted_at IS NULL', 'd.entity_id = ?', visible.sql];
  const args = [Number(user.entityId) || 0, ...visible.args];
  if (q) { where.push('(d.title LIKE ? OR d.document_type LIKE ?)'); args.push(`%${escapeLike(q)}%`, `%${escapeLike(q)}%`); }
  if (documentType) { where.push('d.document_type = ?'); args.push(documentType); }
  if (status) { where.push('d.status = ?'); args.push(status); }
  if (departmentId != null) { where.push('d.department_id = ?'); args.push(Number(departmentId)); }
  if (withFile) where.push('d.drive_file_id IS NOT NULL');

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM documents d WHERE ${where.join(' AND ')}`, args);
  const [rows] = await pool.query(
    `SELECT d.id, d.title, d.document_type AS documentType, dt.name AS documentTypeName, d.status,
            d.department_id AS departmentId, dep.name AS departmentName,
            u.name AS createdByName, d.created_at AS createdAt, d.updated_at AS updatedAt,
            f.web_view_link AS webViewLink, f.mime_type AS mimeType
       FROM documents d
       LEFT JOIN departments dep ON dep.id = d.department_id
       LEFT JOIN users u ON u.id = d.created_by
       LEFT JOIN document_types dt ON dt.entity_id = d.entity_id AND dt.code = d.document_type AND dt.deleted_at IS NULL
       LEFT JOIN drive_files_metadata f ON f.drive_file_id = d.drive_file_id
      WHERE ${where.join(' AND ')}
      ORDER BY d.updated_at DESC, d.id DESC
      LIMIT ?`,
    [...args, cap(limit)]
  );
  return { total: Number(total), rows };
}

/** Documents made from templates (docTemplates.listGenerated: own division unless cross-division). */
function generatedDocuments(user, options = {}) {
  return docTemplates.listGenerated(pool, user, options);
}

/** Templates the user may use (docTemplates.listTemplates: own division + company-wide). */
function templates(user) {
  return docTemplates.listTemplates(pool, user);
}

module.exports = { divisions, searchDocuments, generatedDocuments, templates };
