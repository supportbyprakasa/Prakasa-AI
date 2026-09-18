const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

function canUseForm(req, form) {
  const permissions = req.user?.permissions || [];
  if (permissions.includes('form.manage')) return true;
  if (form.is_public) return true;
  if (!form.submit_permission_code) return true;
  return permissions.includes(form.submit_permission_code);
}

async function validateReference(conn, table, id, entityId, extra = '1=1') {
  if (id === undefined || id === null) return;
  const [rows] = await conn.query(
    `SELECT id FROM ${table}
      WHERE id=? AND entity_id=? AND ${extra}
      LIMIT 1`,
    [id, entityId]
  );
  if (!rows[0]) {
    const error = new Error(`Reference ${table} tidak valid untuk entity ini`);
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
}

async function validatePermissionCode(conn, code) {
  if (code === undefined || code === null || code === '') return;
  const [rows] = await conn.query(
    'SELECT id FROM permissions WHERE code=? LIMIT 1',
    [code]
  );
  if (!rows[0]) {
    const error = new Error(`Permission code tidak dikenal: ${code}`);
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
}

async function validateReferences(conn, entityId, payload) {
  await validateReference(conn, 'departments', payload.departmentId, entityId, 'deleted_at IS NULL');
  await validateReference(conn, 'workflow_definitions', payload.workflowDefinitionId, entityId, 'deleted_at IS NULL');
  await validateReference(conn, 'approval_matrix', payload.approvalMatrixId, entityId);
  await validateReference(conn, 'document_types', payload.documentTypeId, entityId, 'deleted_at IS NULL');
  await validateReference(conn, 'folder_mapping_rules', payload.folderMappingRuleId, entityId, 'deleted_at IS NULL');
  await validatePermissionCode(conn, payload.submitPermissionCode);
  await validatePermissionCode(conn, payload.viewPermissionCode);
}

function assertUniqueFieldKeys(fields) {
  if (!Array.isArray(fields)) return;
  const keys = fields.map((field) => field.fieldKey);
  if (new Set(keys).size !== keys.length) {
    const error = new Error('fieldKey tidak boleh duplikat dalam satu form');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
}

async function loadFields(conn, formId) {
  const [fields] = await conn.query(
    `SELECT id, field_key AS fieldKey, label, field_type AS fieldType,
            placeholder, help_text AS helpText, is_required AS isRequired,
            default_value AS defaultValue, options_json AS optionsJson,
            validation_json AS validationJson, section_name AS sectionName,
            order_index AS orderIndex, reference_type AS referenceType,
            depends_on_field_key AS dependsOnFieldKey,
            depends_on_value AS dependsOnValue
       FROM form_fields
      WHERE form_id=? AND deleted_at IS NULL
      ORDER BY order_index ASC, id ASC`,
    [formId]
  );

  return fields.map((field) => ({
    ...field,
    isRequired: Boolean(field.isRequired),
    options: parseJson(field.optionsJson) || [],
    validation: parseJson(field.validationJson),
    optionsJson: undefined,
    validationJson: undefined,
  }));
}

function normalizeForm(row) {
  return {
    id: row.id,
    entityId: row.entity_id,
    departmentId: row.department_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    category: row.category,
    icon: row.icon,
    color: row.color,
    isActive: Boolean(row.is_active),
    isPublic: Boolean(row.is_public),
    submitPermissionCode: row.submit_permission_code,
    viewPermissionCode: row.view_permission_code,
    workflowDefinitionId: row.workflow_definition_id,
    approvalMatrixId: row.approval_matrix_id,
    documentTypeId: row.document_type_id,
    folderMappingRuleId: row.folder_mapping_rule_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function list(req, res, next) {
  try {
    const where = ['f.deleted_at IS NULL', 'f.entity_id=?'];
    const args = [req.entityScope.entityId];
    if (req.query.category) { where.push('f.category=?'); args.push(req.query.category); }
    if (req.query.activeOnly === '1') where.push('f.is_active=1');
    if (req.query.departmentId) { where.push('f.department_id=?'); args.push(req.query.departmentId); }
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
              f.folder_mapping_rule_id AS folderMappingRuleId,
              (SELECT COUNT(*) FROM form_fields ff
                WHERE ff.form_id=f.id AND ff.deleted_at IS NULL) AS fieldCount,
              (SELECT COUNT(*) FROM form_submissions fs
                WHERE fs.form_id=f.id AND fs.deleted_at IS NULL) AS submissionCount,
              f.created_at AS createdAt
         FROM forms f
        WHERE ${where.join(' AND ')}
        ORDER BY f.category ASC, f.name ASC`,
      args
    );
    return ok(res, rows);
  } catch (error) { next(error); }
}

async function catalog(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, entity_id, department_id, name, slug, description, category,
              icon, color, is_active, is_public, submit_permission_code,
              view_permission_code, workflow_definition_id,
              approval_matrix_id, document_type_id, folder_mapping_rule_id,
              created_by, created_at, updated_at
         FROM forms
        WHERE entity_id=? AND is_active=1 AND deleted_at IS NULL
        ORDER BY category ASC, name ASC`,
      [req.entityScope.entityId]
    );
    return ok(res, rows.filter((row) => canUseForm(req, row)).map(normalizeForm));
  } catch (error) { next(error); }
}

async function detail(req, res, next) {
  try {
    const isNumeric = /^\d+$/.test(String(req.params.id));
    const [rows] = await pool.query(
      `SELECT * FROM forms
        WHERE ${isNumeric ? 'id=?' : 'slug=?'}
          AND entity_id=? AND deleted_at IS NULL
        LIMIT 1`,
      [req.params.id, req.entityScope.entityId]
    );
    const form = rows[0];
    if (!form) return fail(res, 'NOT_FOUND', 'Form tidak ditemukan', 404);
    return ok(res, {
      ...normalizeForm(form),
      fields: await loadFields(pool, form.id),
    });
  } catch (error) { next(error); }
}

async function catalogDetail(req, res, next) {
  try {
    const isNumeric = /^\d+$/.test(String(req.params.id));
    const [rows] = await pool.query(
      `SELECT * FROM forms
        WHERE ${isNumeric ? 'id=?' : 'slug=?'}
          AND entity_id=? AND is_active=1 AND deleted_at IS NULL
        LIMIT 1`,
      [req.params.id, req.entityScope.entityId]
    );
    const form = rows[0];
    if (!form) return fail(res, 'NOT_FOUND', 'Form tidak ditemukan', 404);
    if (!canUseForm(req, form)) {
      return fail(res, 'FORBIDDEN', 'Tidak punya izin mengakses form ini', 403);
    }
    return ok(res, {
      ...normalizeForm(form),
      fields: await loadFields(pool, form.id),
    });
  } catch (error) { next(error); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;
    assertUniqueFieldKeys(req.body.fields);
    await validateReferences(conn, entityId, req.body);

    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO forms
       (entity_id, department_id, name, slug, description, category, icon, color,
        is_active, is_public, submit_permission_code, view_permission_code,
        workflow_definition_id, approval_matrix_id, document_type_id,
        folder_mapping_rule_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entityId, req.body.departmentId ?? null, req.body.name, req.body.slug,
        req.body.description ?? null, req.body.category ?? null,
        req.body.icon ?? null, req.body.color ?? null,
        req.body.isActive === false ? 0 : 1,
        req.body.isPublic ? 1 : 0,
        req.body.submitPermissionCode ?? null,
        req.body.viewPermissionCode ?? null,
        req.body.workflowDefinitionId ?? null,
        req.body.approvalMatrixId ?? null,
        req.body.documentTypeId ?? null,
        req.body.folderMappingRuleId ?? null,
        req.user.sub,
      ]
    );

    for (let index = 0; index < (req.body.fields || []).length; index++) {
      const field = req.body.fields[index];
      await conn.query(
        `INSERT INTO form_fields
         (form_id, field_key, label, field_type, placeholder, help_text,
          is_required, default_value, options_json, validation_json,
          section_name, order_index, reference_type,
          depends_on_field_key, depends_on_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.insertId, field.fieldKey, field.label, field.fieldType,
          field.placeholder ?? null, field.helpText ?? null,
          field.isRequired ? 1 : 0, field.defaultValue ?? null,
          field.options ? JSON.stringify(field.options) : null,
          field.validation ? JSON.stringify(field.validation) : null,
          field.sectionName ?? null,
          Number.isInteger(field.orderIndex) ? field.orderIndex : index,
          field.referenceType ?? null,
          field.dependsOnFieldKey ?? null,
          field.dependsOnValue ?? null,
        ]
      );
    }

    await conn.commit();
    await activityLog({
      entityId, userId: req.user.sub,
      action: 'form.create', subjectType: 'form', subjectId: result.insertId,
      metadata: { name: req.body.name, slug: req.body.slug, fieldCount: (req.body.fields || []).length },
    });

    return ok(res, { id: result.insertId }, undefined, 201);
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (error.code === 'ER_DUP_ENTRY') return fail(res, 'CONFLICT', 'Slug/field key sudah dipakai', 409);
    if (error.status) return fail(res, error.code, error.message, error.status);
    next(error);
  } finally { conn.release(); }
}

async function update(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const entityId = req.entityScope.entityId;
    const [rows] = await conn.query(
      `SELECT * FROM forms
        WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [req.params.id, entityId]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Form tidak ditemukan', 404);

    assertUniqueFieldKeys(req.body.fields);
    await validateReferences(conn, entityId, req.body);
    await conn.beginTransaction();

    const map = {
      name: 'name',
      description: 'description',
      category: 'category',
      icon: 'icon',
      color: 'color',
      isActive: 'is_active',
      isPublic: 'is_public',
      submitPermissionCode: 'submit_permission_code',
      viewPermissionCode: 'view_permission_code',
      workflowDefinitionId: 'workflow_definition_id',
      approvalMatrixId: 'approval_matrix_id',
      documentTypeId: 'document_type_id',
      folderMappingRuleId: 'folder_mapping_rule_id',
    };
    const fields = [];
    const values = [];
    for (const [key, column] of Object.entries(map)) {
      if (!Object.prototype.hasOwnProperty.call(req.body, key)) continue;
      fields.push(`${column}=?`);
      let value = req.body[key];
      if (key === 'isActive' || key === 'isPublic') value = value ? 1 : 0;
      values.push(value ?? null);
    }
    if (fields.length) {
      values.push(req.params.id, entityId);
      await conn.query(
        `UPDATE forms SET ${fields.join(', ')}
          WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
        values
      );
    }

    if (Array.isArray(req.body.fields)) {
      const [existing] = await conn.query(
        'SELECT id, field_key AS fieldKey FROM form_fields WHERE form_id=?',
        [req.params.id]
      );
      const byKey = new Map(existing.map((field) => [field.fieldKey, field]));
      await conn.query('UPDATE form_fields SET deleted_at=NOW() WHERE form_id=?', [req.params.id]);

      for (let index = 0; index < req.body.fields.length; index++) {
        const field = req.body.fields[index];
        const current = byKey.get(field.fieldKey);
        const data = [
          field.label, field.fieldType, field.placeholder ?? null,
          field.helpText ?? null, field.isRequired ? 1 : 0,
          field.defaultValue ?? null,
          field.options ? JSON.stringify(field.options) : null,
          field.validation ? JSON.stringify(field.validation) : null,
          field.sectionName ?? null,
          Number.isInteger(field.orderIndex) ? field.orderIndex : index,
          field.referenceType ?? null,
          field.dependsOnFieldKey ?? null,
          field.dependsOnValue ?? null,
        ];

        if (current) {
          await conn.query(
            `UPDATE form_fields SET
               label=?, field_type=?, placeholder=?, help_text=?,
               is_required=?, default_value=?, options_json=?, validation_json=?,
               section_name=?, order_index=?, reference_type=?,
               depends_on_field_key=?, depends_on_value=?, deleted_at=NULL
             WHERE id=? AND form_id=?`,
            [...data, current.id, req.params.id]
          );
        } else {
          await conn.query(
            `INSERT INTO form_fields
             (form_id, field_key, label, field_type, placeholder, help_text,
              is_required, default_value, options_json, validation_json,
              section_name, order_index, reference_type,
              depends_on_field_key, depends_on_value)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.params.id, field.fieldKey, ...data]
          );
        }
      }
    }

    await conn.commit();
    await activityLog({
      entityId, userId: req.user.sub,
      action: 'form.update', subjectType: 'form',
      subjectId: Number(req.params.id),
      metadata: { fieldsUpdated: Array.isArray(req.body.fields) },
    });
    return ok(res, { id: Number(req.params.id) });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (error.code === 'ER_DUP_ENTRY') return fail(res, 'CONFLICT', 'Field key sudah dipakai', 409);
    if (error.status) return fail(res, error.code, error.message, error.status);
    next(error);
  } finally { conn.release(); }
}

async function remove(req, res, next) {
  try {
    const [result] = await pool.query(
      `UPDATE forms
          SET is_active=0, deleted_at=NOW()
        WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
      [req.params.id, req.entityScope.entityId]
    );
    if (!result.affectedRows) return fail(res, 'NOT_FOUND', 'Form tidak ditemukan', 404);

    await activityLog({
      entityId: req.entityScope.entityId, userId: req.user.sub,
      action: 'form.delete', subjectType: 'form',
      subjectId: Number(req.params.id),
    });
    return ok(res, { id: Number(req.params.id) });
  } catch (error) { next(error); }
}

module.exports = {
  list, catalog, detail, catalogDetail, create, update, remove,
};
