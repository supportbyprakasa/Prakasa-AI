const crypto = require('crypto');
const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');
const notif = require('../services/notification.service');
const workflowSvc = require('../services/workflow.service');
const uploadSvc = require('../services/formFileUpload.service');
const { assertEntityAccess } = require('../middleware/entityScope');

function generateSubmissionNumber(entityId) {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  return `FRM-${entityId}-${ym}-${suffix}`;
}

/* ============================================================
   LIST / DETAIL
   ============================================================ */

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = ['fs.deleted_at IS NULL', 'fs.entity_id = ?'];
    const args = [req.entityScope.entityId];

    if (req.query.formId) { where.push('fs.form_id = ?'); args.push(req.query.formId); }
    if (req.query.status) { where.push('fs.status = ?'); args.push(req.query.status); }
    if (req.query.submittedBy) { where.push('fs.submitted_by = ?'); args.push(req.query.submittedBy); }
    if (req.query.contextType && req.query.contextId) {
      where.push('fs.context_type = ? AND fs.context_id = ?');
      args.push(req.query.contextType, req.query.contextId);
    }
    if (req.query.q) {
      where.push('(fs.title LIKE ? OR fs.submission_number LIKE ?)');
      args.push(`%${req.query.q}%`, `%${req.query.q}%`);
    }

    const [rows] = await pool.query(
      `SELECT fs.id, fs.form_id AS formId, f.name AS formName, f.slug AS formSlug,
              fs.entity_id AS entityId, fs.department_id AS departmentId,
              fs.submission_number AS submissionNumber, fs.title, fs.status,
              fs.submitted_by AS submittedBy, u.name AS submittedByName,
              fs.submitted_at AS submittedAt,
              fs.approval_request_id AS approvalRequestId,
              fs.workflow_instance_id AS workflowInstanceId,
              fs.context_type AS contextType, fs.context_id AS contextId,
              fs.created_at AS createdAt
         FROM form_submissions fs
         JOIN forms f ON f.id = fs.form_id
         LEFT JOIN users u ON u.id = fs.submitted_by
        WHERE ${where.join(' AND ')}
        ORDER BY fs.id DESC
        LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM form_submissions fs WHERE ${where.join(' AND ')}`,
      args
    );

    return ok(res, rows, { page, limit, total });
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT fs.*, f.name AS formName, f.slug AS formSlug,
              u.name AS submittedByName
         FROM form_submissions fs
         JOIN forms f ON f.id = fs.form_id
         LEFT JOIN users u ON u.id = fs.submitted_by
        WHERE fs.id = ? AND fs.deleted_at IS NULL`,
      [id]
    );
    const sub = rows[0];
    if (!sub) return fail(res, 'NOT_FOUND', 'Submission tidak ditemukan', 404);
    assertEntityAccess(req, sub);

    const [values] = await pool.query(
      `SELECT v.id, v.field_id AS fieldId, v.field_key AS fieldKey,
              ff.label, ff.field_type AS fieldType, ff.order_index AS orderIndex,
              v.value_text AS valueText, v.value_number AS valueNumber,
              v.value_date AS valueDate, v.value_json AS valueJson,
              v.value_user_id AS valueUserId, u.name AS valueUserName,
              v.value_document_id AS valueDocumentId,
              d.title AS valueDocumentTitle, d.drive_file_id AS valueDocumentDriveId
         FROM form_submission_values v
         JOIN form_fields ff ON ff.id = v.field_id
         LEFT JOIN users u ON u.id = v.value_user_id
         LEFT JOIN documents d ON d.id = v.value_document_id
        WHERE v.submission_id = ?
        ORDER BY ff.order_index ASC`,
      [id]
    );

    const [attachments] = await pool.query(
      `SELECT id, field_id AS fieldId, field_key AS fieldKey,
              document_id AS documentId, drive_file_id AS driveFileId,
              web_view_link AS webViewLink, name, mime_type AS mimeType,
              size, checksum, created_at AS createdAt
         FROM form_submission_attachments
        WHERE submission_id = ? AND deleted_at IS NULL
        ORDER BY id ASC`,
      [id]
    );

    let workflowInstance = null;
    if (sub.workflow_instance_id) {
      workflowInstance = await workflowSvc.getInstance(sub.workflow_instance_id);
    }

    return ok(res, { ...sub, values, attachments, workflowInstance });
  } catch (e) { next(e); }
}

/* ============================================================
   SUBMIT
   ============================================================ */

async function submit(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { formId, values = {}, contextType, contextId, submit: doSubmit = true } = req.body;

    const [forms] = await conn.query(
      `SELECT * FROM forms
        WHERE id = ? AND entity_id = ? AND is_active = 1 AND deleted_at IS NULL`,
      [formId, req.entityScope.entityId]
    );
    const form = forms[0];
    if (!form) return fail(res, 'NOT_FOUND', 'Form tidak ditemukan / tidak aktif', 404);

    // Permission check for non-public forms
    if (!form.is_public && form.submit_permission_code) {
      const perms = req.user.permissions || [];
      if (!perms.includes(form.submit_permission_code)) {
        return fail(res, 'FORBIDDEN', `Butuh permission: ${form.submit_permission_code}`, 403);
      }
    }

    const [fields] = await conn.query(
      `SELECT * FROM form_fields WHERE form_id = ? AND deleted_at IS NULL ORDER BY order_index ASC`,
      [formId]
    );

    // Validate required + type rules (backend authoritative)
    const missing = [];
    const typeErrors = [];
    for (const f of fields) {
      const v = values[f.field_key];
      const isEmpty = v === undefined || v === null || v === '' ||
        (Array.isArray(v) && v.length === 0);

      if (f.is_required && isEmpty) {
        missing.push(f.label);
        continue;
      }
      if (isEmpty) continue;

      switch (f.field_type) {
        case 'email':
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) {
            typeErrors.push(`${f.label}: format email tidak valid`);
          }
          break;
        case 'number':
        case 'currency':
          if (isNaN(Number(v))) {
            typeErrors.push(`${f.label}: harus angka`);
          }
          break;
        case 'date':
        case 'datetime':
          if (isNaN(new Date(v).getTime())) {
            typeErrors.push(`${f.label}: tanggal tidak valid`);
          }
          break;
        case 'select':
        case 'radio': {
          const opts = parseJson(f.options_json) || [];
          if (opts.length && !opts.some((o) => o.value === String(v))) {
            typeErrors.push(`${f.label}: nilai tidak ada di opsi`);
          }
          break;
        }
        case 'multi_select':
        case 'checkbox': {
          if (Array.isArray(v)) {
            const opts = parseJson(f.options_json) || [];
            if (opts.length) {
              for (const x of v) {
                if (!opts.some((o) => o.value === String(x))) {
                  typeErrors.push(`${f.label}: nilai "${x}" tidak ada di opsi`);
                }
              }
            }
          }
          break;
        }
      }
    }

    if (doSubmit && missing.length) {
      return fail(res, 'VALIDATION_ERROR',
        `Field wajib belum diisi: ${missing.join(', ')}`, 400);
    }
    if (typeErrors.length) {
      return fail(res, 'VALIDATION_ERROR', typeErrors.join('; '), 400);
    }

    await conn.beginTransaction();

    const submissionNumber = generateSubmissionNumber(form.entity_id);

    const titleField = fields.find((f) =>
      /judul|title|nama|name|subject/i.test(f.field_key)
    );
    const title = titleField
      ? String(values[titleField.field_key] || form.name).slice(0, 250)
      : form.name;

    const [s] = await conn.query(
      `INSERT INTO form_submissions
       (form_id, entity_id, department_id, submission_number, status, title,
        notes, submitted_by, submitted_at, context_type, context_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        formId, form.entity_id, form.department_id || null,
        submissionNumber, doSubmit ? 'submitted' : 'draft', title,
        values._notes || null,
        req.user.sub, doSubmit ? new Date() : null,
        contextType || null, contextId || null,
      ]
    );

    for (const f of fields) {
      const v = values[f.field_key];
      if (v === undefined) continue;
      const payload = buildValuePayload(f, v);
      await conn.query(
        `INSERT INTO form_submission_values
         (submission_id, field_id, field_key,
          value_text, value_number, value_date, value_json,
          value_user_id, value_document_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          s.insertId, f.id, f.field_key,
          payload.text, payload.number, payload.date, payload.json,
          payload.userId, payload.documentId,
        ]
      );
    }

    // If form has workflow_definition_id → create workflow instance on submit
    let workflowInstanceId = null;
    if (doSubmit && form.workflow_definition_id) {
      workflowInstanceId = await workflowSvc.createInstance({
        workflowDefinitionId: form.workflow_definition_id,
        entityId: form.entity_id,
        departmentId: form.department_id,
        subjectType: 'form_submission',
        subjectId: s.insertId,
        createdBy: req.user.sub,
      }, conn);

      await conn.query(
        `UPDATE form_submissions SET workflow_instance_id = ? WHERE id = ?`,
        [workflowInstanceId, s.insertId]
      );
    }

    await conn.commit();

    await activityLog({
      entityId: form.entity_id, userId: req.user.sub,
      action: doSubmit ? 'form_submission.submit' : 'form_submission.draft',
      subjectType: 'form_submission', subjectId: s.insertId,
      metadata: { formSlug: form.slug, submissionNumber, workflowInstanceId },
    });

    return ok(res, {
      id: s.insertId,
      submissionNumber,
      status: doSubmit ? 'submitted' : 'draft',
      workflowInstanceId,
    }, undefined, 201);
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    next(e);
  } finally {
    conn.release();
  }
}

function buildValuePayload(field, value) {
  const out = { text: null, number: null, date: null, json: null, userId: null, documentId: null };
  switch (field.field_type) {
    case 'number':
    case 'currency':
      out.number = Number(value);
      break;
    case 'date':
    case 'datetime':
      out.date = value ? new Date(value) : null;
      break;
    case 'multi_select':
    case 'checkbox':
      out.json = JSON.stringify(Array.isArray(value) ? value : [value]);
      break;
    case 'select':
    case 'radio':
      out.text = String(value);
      break;
    case 'user_selector':
      out.userId = Number(value) || null;
      break;
    case 'document_link':
      out.documentId = Number(value) || null;
      break;
    case 'file':
      // File upload is handled separately via uploadFieldFile.
      break;
    default:
      out.text = value === null || value === undefined ? null : String(value);
  }
  return out;
}

function parseJson(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

/* ============================================================
   FILE UPLOAD FOR FORM FIELD
   ============================================================ */

async function uploadField(req, res, next) {
  try {
    const { id } = req.params;                     // submission id
    const { fieldId, fieldKey } = req.body;

    const [subs] = await pool.query(
      `SELECT * FROM form_submissions WHERE id = ? AND deleted_at IS NULL`, [id]
    );
    const sub = subs[0];
    if (!sub) return fail(res, 'NOT_FOUND', 'Submission tidak ditemukan', 404);
    assertEntityAccess(req, sub);
    if (sub.status !== 'draft') {
      return fail(res, 'CONFLICT', 'Hanya draft yang boleh upload lampiran', 409);
    }

    const [fields] = await pool.query(
      `SELECT * FROM form_fields
        WHERE form_id = ? AND deleted_at IS NULL
          AND (id = ? OR field_key = ?) LIMIT 1`,
      [sub.form_id, fieldId || 0, fieldKey || '']
    );
    const field = fields[0];
    if (!field) return fail(res, 'NOT_FOUND', 'Field tidak ditemukan', 404);
    if (field.field_type !== 'file') {
      return fail(res, 'VALIDATION_ERROR', 'Field ini bukan tipe file', 400);
    }

    const result = await uploadSvc.uploadFieldFile({
      submission: sub,
      field,
      file: req.file,
      user: req.user,
    });

    await activityLog({
      entityId: sub.entity_id, userId: req.user.sub,
      action: 'form_submission.upload',
      subjectType: 'form_submission', subjectId: sub.id,
      metadata: { fieldKey: field.field_key, driveFileId: result.driveFileId },
    });

    return ok(res, result, undefined, 201);
  } catch (e) {
    if (/wajib|terlalu besar|tidak diizinkan/i.test(e.message)) {
      return fail(res, 'VALIDATION_ERROR', e.message, 400);
    }
    next(e);
  }
}

/* ============================================================
   STATUS UPDATE (manual for non-workflow forms)
   ============================================================ */

async function updateStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const allowed = ['draft','submitted','under_review','approved','rejected',
                     'revision_requested','completed','cancelled'];
    if (!allowed.includes(status)) {
      return fail(res, 'VALIDATION_ERROR', 'Status tidak valid', 400);
    }

    const [subs] = await pool.query(
      `SELECT * FROM form_submissions WHERE id = ? AND deleted_at IS NULL`, [id]
    );
    const sub = subs[0];
    if (!sub) return fail(res, 'NOT_FOUND', 'Submission tidak ditemukan', 404);
    assertEntityAccess(req, sub);

    if (sub.workflow_instance_id) {
      return fail(res, 'CONFLICT',
        'Submission ini pakai workflow engine. Gunakan endpoint /workflow-instances/:id/transition.', 409);
    }

    await pool.query(
      `UPDATE form_submissions SET status = ?, notes = COALESCE(?, notes)
        WHERE id = ?`,
      [status, notes || null, id]
    );

    await activityLog({
      entityId: sub.entity_id, userId: req.user.sub,
      action: 'form_submission.status', subjectType: 'form_submission',
      subjectId: Number(id), metadata: { status, notes },
    });

    if (sub.submitted_by !== req.user.sub) {
      await notif.create({
        userId: sub.submitted_by, entityId: sub.entity_id,
        title: `Submission ${status}`,
        body: sub.submission_number,
        event: `form_submission.${status}`,
        subjectType: 'form_submission', subjectId: Number(id),
        actionUrl: `/forms/submissions/${id}`,
      });
    }

    return ok(res, { id: Number(id), status });
  } catch (e) { next(e); }
}

/* ============================================================
   DELETE
   ============================================================ */

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [subs] = await pool.query(
      `SELECT * FROM form_submissions WHERE id = ? AND deleted_at IS NULL`, [id]
    );
    const sub = subs[0];
    if (!sub) return fail(res, 'NOT_FOUND', 'Submission tidak ditemukan', 404);
    assertEntityAccess(req, sub);

    const canManage = (req.user.permissions || []).includes('form_submission.manage');
    const ownsDraft = sub.status === 'draft' && Number(sub.submitted_by) === Number(req.user.sub);
    if (!canManage && !ownsDraft) {
      return fail(res, 'FORBIDDEN', 'Hanya draft milik sendiri atau admin yang bisa hapus', 403);
    }

    await pool.query(
      `UPDATE form_submissions SET deleted_at = NOW() WHERE id = ?`, [id]
    );
    await activityLog({
      entityId: sub.entity_id, userId: req.user.sub,
      action: 'form_submission.delete',
      subjectType: 'form_submission', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = {
  list, detail, submit, uploadField, updateStatus, remove,
};
