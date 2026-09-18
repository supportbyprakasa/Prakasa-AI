const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const where = ['r.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('r.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.documentType) { where.push('r.document_type = ?'); args.push(req.query.documentType); }
    const [rows] = await pool.query(
      `SELECT r.id, r.entity_id AS entityId, r.department_id AS departmentId,
              r.document_type AS documentType, r.drive_folder_id AS driveFolderId,
              r.priority, r.is_active AS isActive, r.created_at AS createdAt
         FROM folder_mapping_rules r
        WHERE ${where.join(' AND ')}
        ORDER BY r.priority ASC, r.id DESC`,
      args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const { entityId, departmentId, documentType, driveFolderId, priority = 100 } = req.body;
    const [r] = await pool.query(
      `INSERT INTO folder_mapping_rules
       (entity_id, department_id, document_type, drive_folder_id, priority)
       VALUES (?, ?, ?, ?, ?)`,
      [entityId, departmentId || null, documentType, driveFolderId, priority]
    );
    await log({
      entityId, userId: req.user.sub,
      action: 'folder_rule.create', subjectType: 'folder_mapping_rule',
      subjectId: r.insertId, metadata: { documentType, driveFolderId, priority },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { documentType, driveFolderId, priority, isActive } = req.body;
    const [r] = await pool.query(
      `UPDATE folder_mapping_rules
          SET document_type=?, drive_folder_id=?, priority=?, is_active=?
        WHERE id=? AND deleted_at IS NULL`,
      [documentType, driveFolderId, priority, isActive ? 1 : 0, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Rule tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'folder_rule.update', subjectType: 'folder_mapping_rule', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE folder_mapping_rules SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Rule tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'folder_rule.delete', subjectType: 'folder_mapping_rule', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

// Cari folder tujuan berdasarkan (entity, department, documentType)
async function resolveFolder({ entityId, departmentId, documentType }) {
  const [rows] = await pool.query(
    `SELECT drive_folder_id AS driveFolderId FROM folder_mapping_rules
      WHERE entity_id=? AND (department_id=? OR department_id IS NULL)
        AND document_type=? AND is_active=1 AND deleted_at IS NULL
      ORDER BY (department_id IS NOT NULL) DESC, priority ASC
      LIMIT 1`,
    [entityId, departmentId || null, documentType]
  );
  return rows[0]?.driveFolderId || null;
}

module.exports = { list, create, update, remove, resolveFolder };
