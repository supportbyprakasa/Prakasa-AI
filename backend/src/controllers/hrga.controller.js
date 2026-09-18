const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const notif = require('../services/notification.service');
const drive = require('../services/googleDrive.service');

async function generateWorkflowNumber(conn, type) {
  const prefix = type === 'offboarding' ? 'OFF' : 'ONB';
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM hrga_workflows
      WHERE workflow_type=? AND workflow_number LIKE ?`,
    [type, `${prefix}-${ym}-%`]
  );
  const seq = String((rows[0].c || 0) + 1).padStart(4, '0');
  return `${prefix}-${ym}-${seq}`;
}

/**
 * Checklist default per tipe workflow (kalau tidak ada template khusus di DB).
 * Kategori ini penting supaya bisa di-link ke modul lain (Fase 3 task, Fase 5 device/license).
 */
const DEFAULT_ONBOARDING = [
  { category: 'google_workspace_access', title: 'Buat akun Google Workspace',
    description: 'Buat email + akun Google Workspace di domain entity.', dueOffsetDays: 0 },
  { category: 'shared_drive_access', title: 'Tambahkan ke Shared Drive department',
    description: 'Grant akses ke folder departemen.', dueOffsetDays: 0 },
  { category: 'device_handover', title: 'Serahkan device kerja',
    description: 'Assign laptop/perangkat via IT Device Management.', dueOffsetDays: 0 },
  { category: 'software_license', title: 'Assign license software yang dibutuhkan',
    description: 'Assign dari daftar software subscription aktif.', dueOffsetDays: 1 },
  { category: 'email_account', title: 'Kirim email sambutan & informasi onboarding',
    description: null, dueOffsetDays: 0 },
];

const DEFAULT_OFFBOARDING = [
  { category: 'account_deactivation', title: 'Nonaktifkan akun Google Workspace',
    description: 'Disable akun + alihkan email ke atasan.', dueOffsetDays: 0 },
  { category: 'document_handover', title: 'Serah terima dokumen pekerjaan',
    description: 'Dokumen dan file diserahkan ke atasan / PIC pengganti.', dueOffsetDays: 0 },
  { category: 'device_return', title: 'Pengembalian device kerja',
    description: 'Return device via IT Device Management.', dueOffsetDays: 0 },
  { category: 'software_license', title: 'Cabut license software user',
    description: 'Revoke license yang terpasang untuk user ini.', dueOffsetDays: 0 },
  { category: 'exit_interview', title: 'Exit interview dengan HR',
    description: null, dueOffsetDays: 3 },
];

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = ['h.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('h.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.departmentId) { where.push('h.department_id = ?'); args.push(req.query.departmentId); }
    if (req.query.workflowType) { where.push('h.workflow_type = ?'); args.push(req.query.workflowType); }
    if (req.query.status) { where.push('h.status = ?'); args.push(req.query.status); }
    if (req.query.q) {
      where.push('(h.employee_full_name LIKE ? OR h.workflow_number LIKE ? OR h.employee_email LIKE ?)');
      args.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
    }

    const [rows] = await pool.query(
      `SELECT h.id, h.entity_id AS entityId, h.department_id AS departmentId,
              h.workflow_type AS workflowType, h.workflow_number AS workflowNumber,
              h.employee_user_id AS employeeUserId, h.employee_full_name AS employeeFullName,
              h.employee_email AS employeeEmail, h.employee_position AS employeePosition,
              h.effective_date AS effectiveDate, h.status,
              h.approval_request_id AS approvalRequestId,
              h.kantorku_employee_id AS kantorkuEmployeeId,
              h.requested_by AS requestedBy, u.name AS requesterName,
              h.hrga_pic_user_id AS hrgaPicUserId,
              (SELECT COUNT(*) FROM hrga_workflow_tasks t
                WHERE t.hrga_workflow_id=h.id) AS totalTasks,
              (SELECT COUNT(*) FROM hrga_workflow_tasks t
                WHERE t.hrga_workflow_id=h.id AND t.status='completed') AS completedTasks,
              h.created_at AS createdAt
         FROM hrga_workflows h
         LEFT JOIN users u ON u.id = h.requested_by
        WHERE ${where.join(' AND ')}
        ORDER BY h.id DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM hrga_workflows h WHERE ${where.join(' AND ')}`, args
    );
    return ok(res, rows, { page, limit, total });
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT h.*, u.name AS requesterName, p.name AS hrgaPicName,
              m.name AS managerName
         FROM hrga_workflows h
         LEFT JOIN users u ON u.id = h.requested_by
         LEFT JOIN users p ON p.id = h.hrga_pic_user_id
         LEFT JOIN users m ON m.id = h.employee_manager_user_id
        WHERE h.id=? AND h.deleted_at IS NULL`, [id]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'HRGA workflow tidak ditemukan', 404);

    const [tasks] = await pool.query(
      `SELECT t.id, t.category, t.title, t.description,
              t.responsible_user_id AS responsibleUserId, ru.name AS responsibleName,
              t.linked_task_id AS linkedTaskId,
              t.linked_device_assignment_id AS linkedDeviceAssignmentId,
              t.linked_subscription_license_id AS linkedSubscriptionLicenseId,
              t.status, t.due_date AS dueDate,
              t.completed_at AS completedAt, t.completed_by AS completedBy,
              t.notes
         FROM hrga_workflow_tasks t
         LEFT JOIN users ru ON ru.id = t.responsible_user_id
        WHERE t.hrga_workflow_id=? ORDER BY t.id`, [id]
    );
    const [attachments] = await pool.query(
      `SELECT id, document_id AS documentId, drive_file_id AS driveFileId,
              web_view_link AS webViewLink, attachment_type AS attachmentType,
              name, mime_type AS mimeType, size, created_at AS createdAt
         FROM hrga_workflow_attachments WHERE hrga_workflow_id=? ORDER BY id`, [id]
    );

    return ok(res, { ...rows[0], tasks, attachments });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const {
      entityId, departmentId, workflowType, employeeUserId,
      employeeFullName, employeeEmail, employeePhone, employeePosition, employeeDivision,
      employeeManagerUserId, joinDate, lastWorkingDate, effectiveDate,
      reason, hrgaPicUserId, notes,
      checklistTemplateId,        // opsional: pakai template dari DB
      autoCreateLinkedTasks = true, // kalau true, buat row di `tasks` Fase 3 juga
    } = req.body;

    await conn.beginTransaction();
    const workflowNumber = await generateWorkflowNumber(conn, workflowType);

    const [r] = await conn.query(
      `INSERT INTO hrga_workflows
       (entity_id, department_id, workflow_type, workflow_number,
        employee_user_id, employee_full_name, employee_email, employee_phone,
        employee_position, employee_division, employee_manager_user_id,
        join_date, last_working_date, effective_date, reason,
        status, requested_by, hrga_pic_user_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'draft', ?, ?, ?)`,
      [entityId, departmentId || null, workflowType, workflowNumber,
       employeeUserId || null, employeeFullName, employeeEmail || null,
       employeePhone || null, employeePosition || null, employeeDivision || null,
       employeeManagerUserId || null, joinDate || null, lastWorkingDate || null,
       effectiveDate, reason || null, req.user.sub, hrgaPicUserId || null, notes || null]
    );

    // Bangun checklist dari template DB (kalau diminta) atau default
    let items = workflowType === 'onboarding' ? DEFAULT_ONBOARDING : DEFAULT_OFFBOARDING;
    if (checklistTemplateId) {
      const [tpl] = await conn.query(
        `SELECT items FROM hrga_checklist_templates WHERE id=? AND is_active=1`,
        [checklistTemplateId]
      );
      if (tpl[0]) items = typeof tpl[0].items === 'string' ? JSON.parse(tpl[0].items) : tpl[0].items;
    }

    for (const it of items) {
      const dueDate = it.dueOffsetDays != null
        ? new Date(Date.now() + it.dueOffsetDays * 86400000).toISOString().slice(0, 10)
        : null;

      // Auto-create task di Fase 3 (kalau diaktifkan) — ini yang memenuhi DoD
      let linkedTaskId = null;
      if (autoCreateLinkedTasks) {
        const [t] = await conn.query(
          `INSERT INTO tasks
           (entity_id, department_id, title, description, priority, reporter_id, due_date,
            source_type, source_id)
           VALUES (?, ?, ?, ?, 'normal', ?, ?, 'hrga_workflow', ?)`,
          [entityId, departmentId || null,
           `[${workflowNumber}] ${it.title}`, it.description || null,
           req.user.sub, dueDate, r.insertId]
        );
        linkedTaskId = t.insertId;
      }

      await conn.query(
        `INSERT INTO hrga_workflow_tasks
         (hrga_workflow_id, category, title, description,
          responsible_user_id, linked_task_id, status, due_date)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [r.insertId, it.category, it.title, it.description || null,
         it.responsibleUserId || null, linkedTaskId, dueDate]
      );
    }

    await conn.commit();

    await log({
      entityId, userId: req.user.sub,
      action: 'hrga.create', subjectType: 'hrga_workflow', subjectId: r.insertId,
      metadata: { workflowType, workflowNumber, employeeFullName, itemsCreated: items.length },
    });

    return ok(res, { id: r.insertId, workflowNumber, tasksCreated: items.length }, undefined, 201);
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const {
      employeeFullName, employeeEmail, employeePhone, employeePosition, employeeDivision,
      employeeManagerUserId, joinDate, lastWorkingDate, effectiveDate, reason,
      hrgaPicUserId, notes,
    } = req.body;

    const [cur] = await pool.query(
      `SELECT status FROM hrga_workflows WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!cur[0]) return fail(res, 'NOT_FOUND', 'HRGA workflow tidak ditemukan', 404);
    if (!['draft', 'revision_requested'].includes(cur[0].status)) {
      return fail(res, 'CONFLICT', 'Tidak bisa diubah pada status ini', 409);
    }

    await pool.query(
      `UPDATE hrga_workflows SET
         employee_full_name=COALESCE(?,employee_full_name),
         employee_email=COALESCE(?,employee_email),
         employee_phone=COALESCE(?,employee_phone),
         employee_position=COALESCE(?,employee_position),
         employee_division=COALESCE(?,employee_division),
         employee_manager_user_id=COALESCE(?,employee_manager_user_id),
         join_date=COALESCE(?,join_date),
         last_working_date=COALESCE(?,last_working_date),
         effective_date=COALESCE(?,effective_date),
         reason=COALESCE(?,reason),
         hrga_pic_user_id=COALESCE(?,hrga_pic_user_id),
         notes=COALESCE(?,notes)
       WHERE id=?`,
      [employeeFullName || null, employeeEmail || null, employeePhone || null,
       employeePosition || null, employeeDivision || null,
       employeeManagerUserId ?? null, joinDate || null, lastWorkingDate || null,
       effectiveDate || null, reason || null,
       hrgaPicUserId ?? null, notes || null, id]
    );

    await log({
      entityId: null, userId: req.user.sub,
      action: 'hrga.update', subjectType: 'hrga_workflow', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function uploadAttachment(req, res, next) {
  try {
    const { id } = req.params;
    const { attachmentType = 'other', documentId, name } = req.body;

    const [rows] = await pool.query(
      `SELECT * FROM hrga_workflows WHERE id=? AND deleted_at IS NULL`, [id]
    );
    const wf = rows[0];
    if (!wf) return fail(res, 'NOT_FOUND', 'HRGA workflow tidak ditemukan', 404);

    let driveFileId = null, webViewLink = null, fileName = name || null,
        mimeType = null, size = null;

    if (req.file) {
      const up = await drive.uploadFile({
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });
      driveFileId = up.id; webViewLink = up.webViewLink;
      fileName = fileName || up.name;
      mimeType = up.mimeType || req.file.mimetype;
      size = Number(up.size || req.file.size);
    } else if (documentId) {
      const [d] = await pool.query(
        `SELECT d.*, f.web_view_link AS webViewLink FROM documents d
           LEFT JOIN drive_files_metadata f ON f.drive_file_id = d.drive_file_id
          WHERE d.id=?`, [documentId]
      );
      if (!d[0]) return fail(res, 'NOT_FOUND', 'Document tidak ditemukan', 404);
      driveFileId = d[0].drive_file_id;
      webViewLink = d[0].webViewLink;
      fileName = fileName || d[0].title;
    } else {
      return fail(res, 'VALIDATION_ERROR', 'Wajib ada file atau documentId', 400);
    }

    const [a] = await pool.query(
      `INSERT INTO hrga_workflow_attachments
       (hrga_workflow_id, document_id, drive_file_id, web_view_link,
        attachment_type, name, mime_type, size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, documentId || null, driveFileId, webViewLink,
       attachmentType, fileName, mimeType, size, req.user.sub]
    );

    await log({
      entityId: wf.entity_id, userId: req.user.sub,
      action: 'hrga.attachment.upload', subjectType: 'hrga_workflow',
      subjectId: Number(id), metadata: { attachmentType, driveFileId },
    });

    return ok(res, { id: a.insertId, webViewLink }, undefined, 201);
  } catch (e) { next(e); }
}

/**
 * Submit untuk approval (Fase 3). Onboarding/offboarding tidak butuh document check
 * (karena dokumen onboarding biasanya belum ada sebelum mulai).
 */
async function submitForApproval(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;

    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM hrga_workflows WHERE id=? AND deleted_at IS NULL FOR UPDATE`, [id]
    );
    const wf = rows[0];
    if (!wf) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'HRGA workflow tidak ditemukan', 404); }
    if (!['draft', 'revision_requested'].includes(wf.status)) {
      await conn.rollback();
      return fail(res, 'CONFLICT', 'Workflow sudah dalam proses', 409);
    }

    const [ap] = await conn.query(
      `INSERT INTO approval_requests
       (entity_id, department_id, subject_type, subject_id, title, description,
        approval_type, current_level, status, requested_by)
       VALUES (?, ?, 'hrga_workflow', ?, ?, ?, 'level_1', 1, 'pending', ?)`,
      [wf.entity_id, wf.department_id, wf.id,
       `${wf.workflow_number} — ${wf.employee_full_name}`,
       `${wf.workflow_type} efektif ${wf.effective_date}`,
       req.user.sub]
    );
    await conn.query(
      `INSERT INTO approval_steps (approval_request_id, level) VALUES (?, 1)`,
      [ap.insertId]
    );
    await conn.query(
      `UPDATE hrga_workflows SET status='pending_approval', approval_request_id=?
        WHERE id=?`, [ap.insertId, id]
    );
    await conn.commit();

    await log({
      entityId: wf.entity_id, userId: req.user.sub,
      action: 'hrga.submit_approval', subjectType: 'hrga_workflow',
      subjectId: Number(id), metadata: { approvalRequestId: ap.insertId },
    });

    return ok(res, { id: Number(id), approvalRequestId: ap.insertId });
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function applyApprovalResult(req, res, next) {
  try {
    const { id } = req.params;
    const { status, note } = req.body;
    const allowed = ['approved', 'rejected', 'revision_requested', 'in_progress'];
    if (!allowed.includes(status)) return fail(res, 'VALIDATION_ERROR', 'Status tidak valid', 400);

    const [r] = await pool.query(
      `UPDATE hrga_workflows SET status=?, notes=CONCAT(COALESCE(notes,''), '\n[approval] ', ?)
        WHERE id=? AND deleted_at IS NULL`, [status, note || '', id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'HRGA workflow tidak ditemukan', 404);

    const [wf] = await pool.query(
      `SELECT entity_id AS entityId, requested_by AS requestedBy, workflow_number AS workflowNumber,
              employee_full_name AS employeeFullName FROM hrga_workflows WHERE id=?`, [id]
    );

    await notif.create({
      userId: wf[0].requestedBy, entityId: wf[0].entityId,
      title: `HRGA workflow ${status}`,
      body: `${wf[0].workflowNumber} — ${wf[0].employeeFullName}`,
      event: `hrga.${status}`,
      subjectType: 'hrga_workflow', subjectId: Number(id),
      actionUrl: `/hrga/workflows/${id}`,
    });

    await log({
      entityId: wf[0].entityId, userId: req.user.sub,
      action: `hrga.apply_${status}`, subjectType: 'hrga_workflow',
      subjectId: Number(id), metadata: { note },
    });

    return ok(res, { id: Number(id), status });
  } catch (e) { next(e); }
}

async function updateTask(req, res, next) {
  try {
    const { id, taskId } = req.params;
    const { status, responsibleUserId, notes } = req.body;

    const updates = [];
    const args = [];
    if (status) {
      updates.push('status=?');
      args.push(status);
      if (status === 'completed') {
        updates.push('completed_at=NOW()', 'completed_by=?');
        args.push(req.user.sub);
      }
    }
    if (responsibleUserId !== undefined) { updates.push('responsible_user_id=?'); args.push(responsibleUserId || null); }
    if (notes !== undefined) { updates.push('notes=?'); args.push(notes || null); }
    if (!updates.length) return fail(res, 'VALIDATION_ERROR', 'Tidak ada field yang diubah', 400);

    args.push(taskId, id);
    const [r] = await pool.query(
      `UPDATE hrga_workflow_tasks SET ${updates.join(', ')}
        WHERE id=? AND hrga_workflow_id=?`, args
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Task tidak ditemukan', 404);

    // Auto-selesai: kalau semua task completed, workflow jadi completed
    const [[{ total, done }]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(status='completed') AS done
         FROM hrga_workflow_tasks WHERE hrga_workflow_id=?`, [id]
    );
    if (total > 0 && total === done) {
      await pool.query(
        `UPDATE hrga_workflows
            SET status='completed', completed_at=NOW(), completed_by=?
          WHERE id=? AND status IN ('approved','in_progress')`,
        [req.user.sub, id]
      );
    } else {
      await pool.query(
        `UPDATE hrga_workflows SET status='in_progress'
          WHERE id=? AND status='approved'`, [id]
      );
    }

    await log({
      entityId: null, userId: req.user.sub,
      action: 'hrga.task.update', subjectType: 'hrga_workflow_task',
      subjectId: Number(taskId), metadata: { status, responsibleUserId },
    });

    return ok(res, { id: Number(taskId), status });
  } catch (e) { next(e); }
}

/**
 * Link HRGA task ke entitas lain (device_assignment, subscription_license).
 * Body: { linkedDeviceAssignmentId?, linkedSubscriptionLicenseId?, linkedTaskId? }
 */
async function linkTask(req, res, next) {
  try {
    const { id, taskId } = req.params;
    const { linkedDeviceAssignmentId, linkedSubscriptionLicenseId, linkedTaskId } = req.body;

    const updates = [];
    const args = [];
    if (linkedDeviceAssignmentId !== undefined) {
      updates.push('linked_device_assignment_id=?'); args.push(linkedDeviceAssignmentId || null);
    }
    if (linkedSubscriptionLicenseId !== undefined) {
      updates.push('linked_subscription_license_id=?'); args.push(linkedSubscriptionLicenseId || null);
    }
    if (linkedTaskId !== undefined) { updates.push('linked_task_id=?'); args.push(linkedTaskId || null); }
    if (!updates.length) return fail(res, 'VALIDATION_ERROR', 'Tidak ada link yang diubah', 400);

    args.push(taskId, id);
    const [r] = await pool.query(
      `UPDATE hrga_workflow_tasks SET ${updates.join(', ')}
        WHERE id=? AND hrga_workflow_id=?`, args
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Task tidak ditemukan', 404);

    await log({
      entityId: null, userId: req.user.sub,
      action: 'hrga.task.link', subjectType: 'hrga_workflow_task',
      subjectId: Number(taskId), metadata: {
        linkedDeviceAssignmentId, linkedSubscriptionLicenseId, linkedTaskId,
      },
    });
    return ok(res, { id: Number(taskId) });
  } catch (e) { next(e); }
}

/**
 * Link referensi ke KantorKu HRIS.
 */
async function linkKantorku(req, res, next) {
  try {
    const { id } = req.params;
    const { kantorkuEmployeeId, kantorkuReferenceUrl } = req.body;

    const [r] = await pool.query(
      `UPDATE hrga_workflows
          SET kantorku_employee_id=?, kantorku_reference_url=?, kantorku_synced_at=NOW()
        WHERE id=? AND deleted_at IS NULL`,
      [kantorkuEmployeeId || null, kantorkuReferenceUrl || null, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'HRGA workflow tidak ditemukan', 404);

    await log({
      entityId: null, userId: req.user.sub,
      action: 'hrga.link_kantorku', subjectType: 'hrga_workflow',
      subjectId: Number(id), metadata: { kantorkuEmployeeId },
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [wf] = await pool.query(
      `SELECT status FROM hrga_workflows WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!wf[0]) return fail(res, 'NOT_FOUND', 'HRGA workflow tidak ditemukan', 404);
    if (wf[0].status !== 'draft') {
      return fail(res, 'CONFLICT', 'Hanya draft yang bisa dihapus', 409);
    }
    await pool.query(
      `UPDATE hrga_workflows SET deleted_at=NOW() WHERE id=?`, [id]
    );
    await log({
      entityId: null, userId: req.user.sub,
      action: 'hrga.delete', subjectType: 'hrga_workflow', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

/**
 * CRUD template checklist HRGA.
 */
async function listChecklistTemplates(req, res, next) {
  try {
    const where = ['is_active=1'];
    const args = [];
    if (req.query.entityId) { where.push('entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.workflowType) { where.push('workflow_type = ?'); args.push(req.query.workflowType); }
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, workflow_type AS workflowType,
              name, items, is_active AS isActive, created_at AS createdAt
         FROM hrga_checklist_templates WHERE ${where.join(' AND ')}
        ORDER BY id DESC`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function createChecklistTemplate(req, res, next) {
  try {
    const { entityId, workflowType, name, items } = req.body;
    const [r] = await pool.query(
      `INSERT INTO hrga_checklist_templates (entity_id, workflow_type, name, items)
       VALUES (?, ?, ?, ?)`,
      [entityId, workflowType, name, JSON.stringify(items || [])]
    );
    await log({
      entityId, userId: req.user.sub,
      action: 'hrga_checklist_template.create', subjectType: 'hrga_checklist_template',
      subjectId: r.insertId,
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

module.exports = {
  list, detail, create, update, uploadAttachment,
  submitForApproval, applyApprovalResult,
  updateTask, linkTask, linkKantorku, remove,
  listChecklistTemplates, createChecklistTemplate,
};
