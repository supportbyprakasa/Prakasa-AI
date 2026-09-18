const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const notif = require('../services/notification.service');
const drive = require('../services/googleDrive.service');
const checkSvc = require('../services/documentCheck.service');

/**
 * Generate request_number: PR-YYYYMM-XXXX (payment) / RB-YYYYMM-XXXX (reimburse).
 */
async function generateRequestNumber(conn, type) {
  const prefix = type === 'reimbursement' ? 'RB' : 'PR';
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM finance_workflows
      WHERE workflow_type=? AND request_number LIKE ?`,
    [type, `${prefix}-${ym}-%`]
  );
  const seq = String((rows[0].c || 0) + 1).padStart(4, '0');
  return `${prefix}-${ym}-${seq}`;
}

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = ['f.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('f.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.departmentId) { where.push('f.department_id = ?'); args.push(req.query.departmentId); }
    if (req.query.workflowType) { where.push('f.workflow_type = ?'); args.push(req.query.workflowType); }
    if (req.query.status) { where.push('f.status = ?'); args.push(req.query.status); }
    if (req.query.requestedBy) { where.push('f.requested_by = ?'); args.push(req.query.requestedBy); }
    if (req.query.financePicUserId) { where.push('f.finance_pic_user_id = ?'); args.push(req.query.financePicUserId); }
    if (req.query.q) {
      where.push('(f.title LIKE ? OR f.request_number LIKE ? OR f.payee_name LIKE ?)');
      args.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
    }

    const [rows] = await pool.query(
      `SELECT f.id, f.entity_id AS entityId, f.department_id AS departmentId,
              f.workflow_type AS workflowType, f.request_number AS requestNumber,
              f.title, f.category, f.payee_name AS payeeName,
              f.amount, f.total_amount AS totalAmount, f.currency,
              f.request_date AS requestDate, f.due_date AS dueDate,
              f.status, f.document_check_status AS documentCheckStatus,
              f.approval_request_id AS approvalRequestId,
              f.jurnal_reference_id AS jurnalReferenceId,
              f.requested_by AS requestedBy, u.name AS requesterName,
              f.finance_pic_user_id AS financePicUserId, p.name AS financePicName,
              f.created_at AS createdAt
         FROM finance_workflows f
         LEFT JOIN users u ON u.id = f.requested_by
         LEFT JOIN users p ON p.id = f.finance_pic_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY f.id DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM finance_workflows f WHERE ${where.join(' AND ')}`, args
    );
    return ok(res, rows, { page, limit, total });
  } catch (e) { next(e); }
}

async function detail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT f.*, u.name AS requesterName, p.name AS financePicName
         FROM finance_workflows f
         LEFT JOIN users u ON u.id = f.requested_by
         LEFT JOIN users p ON p.id = f.finance_pic_user_id
        WHERE f.id=? AND f.deleted_at IS NULL`, [id]
    );
    if (!rows[0]) return fail(res, 'NOT_FOUND', 'Finance workflow tidak ditemukan', 404);

    const [attachments] = await pool.query(
      `SELECT id, document_id AS documentId, drive_file_id AS driveFileId,
              web_view_link AS webViewLink, attachment_type AS attachmentType,
              name, mime_type AS mimeType, size, created_at AS createdAt
         FROM finance_workflow_attachments WHERE finance_workflow_id=? ORDER BY id`, [id]
    );

    return ok(res, { ...rows[0], attachments });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const {
      entityId, departmentId, workflowType, title, description, category,
      payeeName, payeeType = 'vendor', payeeBank, payeeAccountNumber, payeeAccountName,
      amount, taxAmount = 0, totalAmount, currency = 'IDR',
      requestDate, requestedPaymentDate, dueDate,
      financePicUserId, notes,
    } = req.body;

    await conn.beginTransaction();
    const requestNumber = await generateRequestNumber(conn, workflowType);

    const [r] = await conn.query(
      `INSERT INTO finance_workflows
       (entity_id, department_id, workflow_type, request_number, title, description,
        category, payee_name, payee_type, payee_bank, payee_account_number,
        payee_account_name, amount, tax_amount, total_amount, currency,
        request_date, requested_payment_date, due_date,
        status, requested_by, finance_pic_user_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'draft', ?, ?, ?)`,
      [entityId, departmentId || null, workflowType, requestNumber, title,
       description || null, category || null, payeeName || null, payeeType,
       payeeBank || null, payeeAccountNumber || null, payeeAccountName || null,
       amount, taxAmount, totalAmount, currency,
       requestDate, requestedPaymentDate || null, dueDate || null,
       req.user.sub, financePicUserId || null, notes || null]
    );
    await conn.commit();

    await log({
      entityId, userId: req.user.sub,
      action: 'finance.create', subjectType: 'finance_workflow', subjectId: r.insertId,
      metadata: { workflowType, requestNumber, amount },
    });

    return ok(res, { id: r.insertId, requestNumber }, undefined, 201);
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const {
      title, description, category, payeeName, payeeBank, payeeAccountNumber,
      payeeAccountName, amount, taxAmount, totalAmount, currency,
      requestedPaymentDate, dueDate, financePicUserId, notes,
    } = req.body;

    // Jangan izinkan update kalau sudah masuk approval
    const [cur] = await pool.query(
      `SELECT status FROM finance_workflows WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!cur[0]) return fail(res, 'NOT_FOUND', 'Finance workflow tidak ditemukan', 404);
    if (!['draft', 'revision_requested', 'pending_document_check'].includes(cur[0].status)) {
      return fail(res, 'CONFLICT', 'Tidak bisa diubah pada status ini', 409);
    }

    const [r] = await pool.query(
      `UPDATE finance_workflows SET
         title=COALESCE(?,title), description=COALESCE(?,description),
         category=COALESCE(?,category), payee_name=COALESCE(?,payee_name),
         payee_bank=COALESCE(?,payee_bank),
         payee_account_number=COALESCE(?,payee_account_number),
         payee_account_name=COALESCE(?,payee_account_name),
         amount=COALESCE(?,amount), tax_amount=COALESCE(?,tax_amount),
         total_amount=COALESCE(?,total_amount), currency=COALESCE(?,currency),
         requested_payment_date=COALESCE(?,requested_payment_date),
         due_date=COALESCE(?,due_date),
         finance_pic_user_id=COALESCE(?,finance_pic_user_id),
         notes=COALESCE(?,notes)
       WHERE id=?`,
      [title || null, description || null, category || null, payeeName || null,
       payeeBank || null, payeeAccountNumber || null, payeeAccountName || null,
       amount ?? null, taxAmount ?? null, totalAmount ?? null, currency || null,
       requestedPaymentDate || null, dueDate || null,
       financePicUserId ?? null, notes || null, id]
    );

    await log({
      entityId: null, userId: req.user.sub,
      action: 'finance.update', subjectType: 'finance_workflow', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

/**
 * Upload attachment — multipart, optional field 'file'.
 * attachmentType di body.
 */
async function uploadAttachment(req, res, next) {
  try {
    const { id } = req.params;
    const { attachmentType = 'other', documentId, name } = req.body;

    const [fRows] = await pool.query(
      `SELECT * FROM finance_workflows WHERE id=? AND deleted_at IS NULL`, [id]
    );
    const wf = fRows[0];
    if (!wf) return fail(res, 'NOT_FOUND', 'Finance workflow tidak ditemukan', 404);

    let driveFileId = null;
    let webViewLink = null;
    let fileName = name || null;
    let mimeType = null;
    let size = null;

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
      `INSERT INTO finance_workflow_attachments
       (finance_workflow_id, document_id, drive_file_id, web_view_link,
        attachment_type, name, mime_type, size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, documentId || null, driveFileId, webViewLink,
       attachmentType, fileName, mimeType, size, req.user.sub]
    );

    await log({
      entityId: wf.entity_id, userId: req.user.sub,
      action: 'finance.attachment.upload', subjectType: 'finance_workflow',
      subjectId: Number(id), metadata: { attachmentType, driveFileId },
    });

    return ok(res, { id: a.insertId, webViewLink }, undefined, 201);
  } catch (e) { next(e); }
}

/**
 * Jalankan AI document check → update status ke 'pending_approval' kalau lolos.
 * Ini yang memenuhi DoD: "Payment request tervalidasi kelengkapan dokumen oleh AI
 * sebelum masuk approval queue."
 */
async function runDocumentCheck(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;

    const [rows] = await conn.query(
      `SELECT * FROM finance_workflows WHERE id=? AND deleted_at IS NULL`, [id]
    );
    const wf = rows[0];
    if (!wf) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'Finance workflow tidak ditemukan', 404); }

    const [attachments] = await conn.query(
      `SELECT attachment_type, name FROM finance_workflow_attachments
        WHERE finance_workflow_id=?`, [id]
    );

    const result = await checkSvc.checkCompleteness({
      module: wf.workflow_type,        // 'payment_request' | 'reimbursement'
      attachments,
      workflowMeta: wf,
      entityId: wf.entity_id,
      departmentId: wf.department_id,
      subjectType: 'finance_workflow',
      subjectId: wf.id,
      userId: req.user.sub,
    });

    await conn.query(
      `UPDATE finance_workflows
          SET document_check_status=?, document_check_summary=?,
              document_check_at=NOW(), document_check_ai_summary_id=?
        WHERE id=?`,
      [result.status, result.notes, result.aiSummaryId || null, id]
    );

    await log({
      entityId: wf.entity_id, userId: req.user.sub,
      action: 'finance.document_check', subjectType: 'finance_workflow',
      subjectId: Number(id), metadata: { status: result.status, missing: result.missing },
    });

    return ok(res, {
      status: result.status,
      missing: result.missing,
      missingOptional: result.missingOptional,
      notes: result.notes,
      aiSummaryId: result.aiSummaryId,
    });
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

/**
 * Kirim ke approval queue (Fase 3) — hanya boleh jika document check passed/warning.
 */
async function submitForApproval(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;

    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM finance_workflows WHERE id=? AND deleted_at IS NULL FOR UPDATE`, [id]
    );
    const wf = rows[0];
    if (!wf) { await conn.rollback(); return fail(res, 'NOT_FOUND', 'Finance workflow tidak ditemukan', 404); }
    if (!['draft', 'revision_requested', 'pending_document_check'].includes(wf.status)) {
      await conn.rollback();
      return fail(res, 'CONFLICT', 'Workflow sudah dalam proses', 409);
    }
    if (wf.document_check_status === 'failed') {
      await conn.rollback();
      return fail(res, 'CONFLICT', 'Dokumen belum lengkap. Selesaikan dulu sebelum submit approval.', 409);
    }
    if (wf.document_check_status === 'not_run') {
      await conn.rollback();
      return fail(res, 'CONFLICT', 'Jalankan document check dulu', 409);
    }

    // Buat approval request (Fase 3)
    const [ap] = await conn.query(
      `INSERT INTO approval_requests
       (entity_id, department_id, subject_type, subject_id, title, description,
        approval_type, current_level, status, requested_by)
       VALUES (?, ?, 'finance_workflow', ?, ?, ?, 'level_1', 1, 'pending', ?)`,
      [wf.entity_id, wf.department_id, wf.id,
       `${wf.request_number} — ${wf.title}`,
       `Nominal: ${wf.total_amount} ${wf.currency}`,
       req.user.sub]
    );
    await conn.query(
      `INSERT INTO approval_steps (approval_request_id, level) VALUES (?, 1)`,
      [ap.insertId]
    );

    await conn.query(
      `UPDATE finance_workflows
          SET status='pending_approval', approval_request_id=?
        WHERE id=?`, [ap.insertId, id]
    );
    await conn.commit();

    await log({
      entityId: wf.entity_id, userId: req.user.sub,
      action: 'finance.submit_approval', subjectType: 'finance_workflow',
      subjectId: Number(id), metadata: { approvalRequestId: ap.insertId },
    });

    return ok(res, { id: Number(id), approvalRequestId: ap.insertId });
  } catch (e) { await conn.rollback(); next(e); }
  finally { conn.release(); }
}

/**
 * Sync status dari approval (dipanggil manual oleh Finance setelah approve).
 * Body: { status: 'approved' | 'rejected' | 'revision_requested', note? }
 */
async function applyApprovalResult(req, res, next) {
  try {
    const { id } = req.params;
    const { status, note } = req.body;

    const allowed = ['approved', 'rejected', 'revision_requested'];
    if (!allowed.includes(status)) return fail(res, 'VALIDATION_ERROR', 'Status tidak valid', 400);

    const [r] = await pool.query(
      `UPDATE finance_workflows SET status=?, notes=CONCAT(COALESCE(notes,''), '\n[approval] ', ?)
        WHERE id=? AND deleted_at IS NULL`, [status, note || '', id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Finance workflow tidak ditemukan', 404);

    const [wf] = await pool.query(
      `SELECT entity_id AS entityId, requested_by AS requestedBy, request_number AS requestNumber,
              title FROM finance_workflows WHERE id=?`, [id]
    );

    await notif.create({
      userId: wf[0].requestedBy, entityId: wf[0].entityId,
      title: `Finance workflow ${status}`,
      body: `${wf[0].requestNumber} — ${wf[0].title}`,
      event: `finance.${status}`,
      subjectType: 'finance_workflow', subjectId: Number(id),
      actionUrl: `/finance/payment-requests/${id}`,
    });

    await log({
      entityId: wf[0].entityId, userId: req.user.sub,
      action: `finance.apply_${status}`, subjectType: 'finance_workflow',
      subjectId: Number(id), metadata: { note },
    });

    return ok(res, { id: Number(id), status });
  } catch (e) { next(e); }
}

/**
 * Tandai processing / paid + isi referensi Jurnal.id.
 * Body: { status: 'processing'|'paid'|'cancelled', jurnalReferenceId?, jurnalReferenceUrl?, notes? }
 */
async function updateProcessing(req, res, next) {
  try {
    const { id } = req.params;
    const { status, jurnalReferenceId, jurnalReferenceUrl, notes } = req.body;

    const allowed = ['processing', 'paid', 'cancelled'];
    if (!allowed.includes(status)) return fail(res, 'VALIDATION_ERROR', 'Status tidak valid', 400);

    const updates = ['status=?'];
    const args = [status];
    if (jurnalReferenceId !== undefined) { updates.push('jurnal_reference_id=?'); args.push(jurnalReferenceId || null); }
    if (jurnalReferenceUrl !== undefined) { updates.push('jurnal_reference_url=?'); args.push(jurnalReferenceUrl || null); }
    if (status === 'paid') { updates.push('paid_at=NOW()', 'paid_by=?'); args.push(req.user.sub); }
    if (notes !== undefined) { updates.push('notes=?'); args.push(notes || null); }
    args.push(id);

    const [r] = await pool.query(
      `UPDATE finance_workflows SET ${updates.join(', ')}
        WHERE id=? AND deleted_at IS NULL`, args
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Finance workflow tidak ditemukan', 404);

    await log({
      entityId: null, userId: req.user.sub,
      action: `finance.${status}`, subjectType: 'finance_workflow',
      subjectId: Number(id), metadata: { jurnalReferenceId },
    });

    return ok(res, { id: Number(id), status });
  } catch (e) { next(e); }
}

/**
 * Link referensi ke Jurnal.id (tanpa mengubah status).
 */
async function linkJurnal(req, res, next) {
  try {
    const { id } = req.params;
    const { jurnalReferenceId, jurnalReferenceUrl } = req.body;

    const [r] = await pool.query(
      `UPDATE finance_workflows
          SET jurnal_reference_id=?, jurnal_reference_url=?, jurnal_synced_at=NOW()
        WHERE id=? AND deleted_at IS NULL`,
      [jurnalReferenceId || null, jurnalReferenceUrl || null, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Finance workflow tidak ditemukan', 404);

    await log({
      entityId: null, userId: req.user.sub,
      action: 'finance.link_jurnal', subjectType: 'finance_workflow',
      subjectId: Number(id), metadata: { jurnalReferenceId },
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [wf] = await pool.query(
      `SELECT status FROM finance_workflows WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!wf[0]) return fail(res, 'NOT_FOUND', 'Finance workflow tidak ditemukan', 404);
    if (wf[0].status !== 'draft') {
      return fail(res, 'CONFLICT', 'Hanya draft yang bisa dihapus', 409);
    }
    await pool.query(
      `UPDATE finance_workflows SET deleted_at=NOW() WHERE id=?`, [id]
    );
    await log({
      entityId: null, userId: req.user.sub,
      action: 'finance.delete', subjectType: 'finance_workflow', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = {
  list, detail, create, update, uploadAttachment,
  runDocumentCheck, submitForApproval, applyApprovalResult,
  updateProcessing, linkJurnal, remove,
};
