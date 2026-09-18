const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');

/* ============================================================
   FORMS — CRUD
   Security: all list/detail/update/delete go through requireEntityScope.
   ============================================================ */

async function list(req, res, next) {
  try {
    const scope = req.entityScope;             // set by middleware
    const where = ['f.deleted_at IS NULL'];
    const args = [scope.entityId];
    where.push('f.entity_id = ?');

    if (req.query.category) { where.push('f.category = ?'); args.push(req.query.category); }
    if (req.query.activeOnly === '1') where.push('f.is_active = 1');
    if (req.query.departmentId) { where.push('f.department_id = ?'); args.push(req.query.departmentId); }
    if (req.query.q) {
      where.push('(f.name LIKE ? OR f.slug LIKE ?)');
      args.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }

    const [rows] = await pool.query(
      `SELECT f.id, f.entity_id AS entityId, f.department_id AS departmentId,
              f.name, f.slug, f.description, f.category, f.icon, f.color,
              f.is_active AS isActive, f.is_public AS isPublic,
              f.submit_permission_code AS submitPermissionCode,
              f.view_permission_code AS viewPermissionCode,
              f.workflow_definition_id AS workflowDefinitionId,
              f.approval_matrix_id AS approvalMatrixId,
              f.document_type_id AS documentTypeId,
              (SELECT COUNT(*) FROM form_fields ff WHERE ff.form_id = f.id) AS fieldCount,
              (SELECT COUNT(*) FROM form_submissions fs
                WHERE fs.form_id = f.id AND fs.deleted_at IS NULL) AS submissionCount,
              f.created_at AS createdAt
         FROM forms f
        WHERE ${where.join(' AND ')}
        ORDER BY f.category ASC, f.name ASC`,
      args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;

    // Either numeric ID or slug
    const isNumeric = /^\d+$/.test(String(id));
    const [rows] = await pool.query(
      `SELECT * FROM forms
        WHERE ${isNumeric ? 'id = ?' : 'slug = ?'}
          AND entity_id = ?
          AND deleted_at IS NULL
        LIMIT 1`,
      [id, req.entityScope.entityId]
    );
    const form = rows[0];
    if (!form) return fail(res, 'NOT_FOUND', 'Form tidak ditemukan', 404);

    const [fields] = await pool.query(
      `SELECT id, field_key AS fieldKey, label, field_type AS fieldType,
              placeholder, help_text AS helpText, is_required AS isRequired,
              default_value AS defaultValue, options_json AS optionsJson,
              validation_json AS validationJson,
              section_name AS sectionName, order_index AS orderIndex,
              reference_type AS referenceType,
              depends_on_field_key AS dependsOnFieldKey,
              depends_on_value AS dependsOnValue
         FROM form_fields
        WHERE form_id = ?
        ORDER BY order_index ASC, id ASC`,
      [form.id]
    );

    const normalizedFields = fields.map((f) => ({
      ...f,
      options: f.optionsJson ? (typeof f.optionsJson === 'string' ? JSON.parse(f.optionsJson) : f.optionsJson) : [],
      validation: f.validationJson ? (typeof f.validationJson === 'string' ? JSON.parse(f.validationJson) : f.validationJson) : null,
      optionsJson: undefined,
      validationJson: undefined,
    }));

    return ok(res, { ...form, fields: normalizedFields });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const {
      departmentId, name, slug, description, category, icon, color,
      isActive = true, isPublic = false,
      submitPermissionCode, viewPermissionCode,
      workflowDefinitionId, approvalMatrixId, documentTypeId,
      folderMappingRuleId, fields = [],
    } = req.body;
    const entityId = req.entityScope.entityId;

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return fail(res, 'VALIDATION_ERROR', 'Slug hanya boleh huruf kecil, angka, dan dash', 400);
    }

    await conn.beginTransaction();

    const [r] = await conn.query(
      `INSERT INTO forms
       (entity_id, department_id, name, slug, description, category, icon, color,
        is_active, is_public, submit_permission_code, view_permission_code,
        workflow_definition_id, approval_matrix_id, document_type_id,
        folder_mapping_rule_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entityId, departmentId || null, name, slug, description || null,
        category || null, icon || null, color || null,
        isActive ? 1 : 0, isPublic ? 1 : 0,
        submitPermissionCode || null, viewPermissionCode || null,
        workflowDefinitionId || null, approvalMatrixId || null,
        documentTypeId || null, folderMappingRuleId || null,
        req.user.sub,
      ]
    );

    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      await conn.query(
        `INSERT INTO form_fields
         (form_id, field_key, label, field_type, placeholder, help_text,
          is_required, default_value, options_json, validation_json,
          section_name, order_index, reference_type,
          depends_on_field_key, depends_on_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          r.insertId, f.fieldKey, f.label, f.fieldType,
          f.placeholder || null, f.helpText || null,
          f.isRequired ? 1 : 0, f.defaultValue || null,
          f.options ? JSON.stringify(f.options) : null,
          f.validation ? JSON.stringify(f.validation) : null,
          f.sectionName || null, Number.isInteger(f.orderIndex) ? f.orderIndex : i,
          f.referenceType || null,
          f.dependsOnFieldKey || null, f.dependsOnValue || null,
        ]
      );
    }

    await conn.commit();

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'form.create', subjectType: 'form', subjectId: r.insertId,
      metadata: { name, slug, fieldCount: fields.length },
    });

    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (e.code === 'ER_DUP_ENTRY') {
      return fail(res, 'CONFLICT', 'Slug sudah dipakai di entity ini', 409);
    }
    next(e);
  } finally {
    conn.release();
  }
}

async function update(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const {
      name, description, category, icon, color, isActive, isPublic,
      submitPermissionCode, viewPermissionCode,
      workflowDefinitionId, approvalMatrixId, documentTypeId,
      folderMappingRuleId, fields,
    } = req.body;

    await conn.beginTransaction();

    const [existing] = await conn.query(
      `SELECT id FROM forms
        WHERE id = ? AND entity_id = ? AND deleted_at IS NULL`,
      [id, req.entityScope.entityId]
    );
    if (!existing[0]) {
      await conn.rollback();
      return fail(res, 'NOT_FOUND', 'Form tidak ditemukan', 404);
    }

    await conn.query(
      `UPDATE forms SET
         name = COALESCE(?, name),
         description = COALESCE(?, description),
         category = COALESCE(?, category),
         icon = COALESCE(?, icon),
         color = COALESCE(?, color),
         is_active = COALESCE(?, is_active),
         is_public = COALESCE(?, is_public),
         submit_permission_code = COALESCE(?, submit_permission_code),
         view_permission_code = COALESCE(?, view_permission_code),
         workflow_definition_id = COALESCE(?, workflow_definition_id),
         approval_matrix_id = COALESCE(?, approval_matrix_id),
         document_type_id = COALESCE(?, document_type_id),
         folder_mapping_rule_id = COALESCE(?, folder_mapping_rule_id)
       WHERE id = ?`,
      [
        name ?? null, description ?? null, category ?? null, icon ?? null, color ?? null,
        isActive === undefined ? null : (isActive ? 1 : 0),
        isPublic === undefined ? null : (isPublic ? 1 : 0),
        submitPermissionCode ?? null, viewPermissionCode ?? null,
        workflowDefinitionId ?? null, approvalMatrixId ?? null,
        documentTypeId ?? null, folderMappingRuleId ?? null,
        id,
      ]
    );

    if (Array.isArray(fields)) {
      await conn.query(`DELETE FROM form_fields WHERE form_id = ?`, [id]);
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        await conn.query(
          `INSERT INTO form_fields
           (form_id, field_key, label, field_type, placeholder, help_text,
            is_required, default_value, options_json, validation_json,
            section_name, order_index, reference_type,
            depends_on_field_key, depends_on_value)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, f.fieldKey, f.label, f.fieldType,
            f.placeholder || null, f.helpText || null,
            f.isRequired ? 1 : 0, f.defaultValue || null,
            f.options ? JSON.stringify(f.options) : null,
            f.validation ? JSON.stringify(f.validation) : null,
            f.sectionName || null, Number.isInteger(f.orderIndex) ? f.orderIndex : i,
            f.referenceType || null,
            f.dependsOnFieldKey || null, f.dependsOnValue || null,
          ]
        );
      }
    }

    await conn.commit();
    await activityLog({
      entityId: req.entityScope.entityId, userId: req.user.sub,
      action: 'form.update', subjectType: 'form', subjectId: Number(id),
      metadata: { name, fieldsReplaced: Array.isArray(fields) },
    });
    return ok(res, { id: Number(id) });
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    next(e);
  } finally {
    conn.release();
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE forms SET deleted_at = NOW()
        WHERE id = ? AND entity_id = ? AND deleted_at IS NULL`,
      [id, req.entityScope.entityId]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Form tidak ditemukan', 404);

    await activityLog({
      entityId: req.entityScope.entityId, userId: req.user.sub,
      action: 'form.delete', subjectType: 'form', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, detail, create, update, remove };
