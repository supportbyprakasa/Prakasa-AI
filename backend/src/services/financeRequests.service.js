// Finance — pengajuan pembayaran & reimbursement (finance_workflows).
//
//   draft ─┬─ submit ─→ pending_approval ─┬─ approve ──→ approved ─→ processing ─→ paid
//          │                              ├─ reject ───→ rejected
//          │                              └─ revision ─→ revision_requested ─ submit ─→ …
//          └─ cancel (requester: draft / revision / pending; Finance also approved / processing)
//
// Who (decided by the Head Finance, see docs/program-desain-admin-console.md):
//   - any division member holding finance.request raises a request; the
//     request belongs to the requester's division (users.department_id);
//   - the approval goes through the approval engine (matrix when one exists for
//     finance_payment_request / finance_reimbursement, else the requester's
//     manager → division Head → Management Office Head), and the decision is
//     applied to the request in the decision's transaction (lifecycle hooks
//     below, registered with approvalSubjectLifecycle);
//   - Finance (finance.process) processes and marks paid; the books are in
//     Accurate Online, the app only keeps the "Nomor bukti di Accurate" as text
//     (column jurnal_reference_id, kept from the Jurnal.id era) and never writes
//     to Accurate;
//   - reads: the requester sees their own, Finance and the Management Office see
//     all, a division Head sees their division's.
//
// Personal data: an employee's bank account is never stored. A reimbursement is
// paid to the employee's payroll account (KantorKu), so its payee bank fields
// are refused; a vendor's bank details on a payment request are business data.

const pool = require('../db/pool');
const drive = require('./googleDrive.service');
const notif = require('./notification.service');
const { notifySteps } = require('./approvalNotify.service');
const engine = require('./approvalEngine.service');
const resolver = require('./approverResolver.service');
const approvalAudit = require('./approvalAudit.service');
const checkSvc = require('./documentCheck.service');
const lifecycle = require('./approvalSubjectLifecycle.service');
const { insertWithNumber } = require('./nextNumber');
const { log: logOutside, logWith } = require('./activityLog.service');
const { todayWib } = require('../utils/wibTime');
const { canSeeDocument } = require('./divisionAccess');

const SUBJECT = 'finance_workflow';
const REQUEST_TYPES = Object.freeze({ payment_request: 'finance_payment_request', reimbursement: 'finance_reimbursement' });
const PREFIX = Object.freeze({ payment_request: 'PR', reimbursement: 'RB' });
const PAGE_SIZE = 20;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_MIME = Object.freeze(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

const STATUSES = Object.freeze([
  'draft', 'pending_document_check', 'pending_approval', 'approved', 'rejected',
  'revision_requested', 'processing', 'paid', 'cancelled',
]);
// The requester may still change the request (pending_document_check is a legacy state).
const EDITABLE = Object.freeze(['draft', 'revision_requested', 'pending_document_check']);
const REQUESTER_CANCELLABLE = Object.freeze([...EDITABLE, 'pending_approval']);
const FINANCE_CANCELLABLE = Object.freeze([...REQUESTER_CANCELLABLE, 'approved', 'processing']);
// Finance's processing steps: target status → statuses it may come from.
const PROCESS_FROM = Object.freeze({ processing: Object.freeze(['approved']), paid: Object.freeze(['approved', 'processing']) });

const EMPLOYEE_ACCOUNT_MESSAGE = 'Rekening karyawan tidak disimpan di aplikasi. Reimbursement dibayar ke rekening payroll karyawan (data di KantorKu).';
// Paying an employee is a reimbursement (no bank account stored), never a payment request.
const EMPLOYEE_PAYEE_MESSAGE = 'Pembayaran ke karyawan diajukan sebagai reimbursement (dibayar ke rekening payroll, data di KantorKu).';
const PAYEE_BANK_FIELDS = Object.freeze(['payeeBank', 'payeeAccountNumber', 'payeeAccountName']);

const ATTACHMENT_LABELS = Object.freeze({
  invoice: 'Invoice', receipt: 'Kuitansi/nota', quotation: 'Penawaran harga', po: 'PO',
  bank_proof: 'Bukti transfer', tax_doc: 'Dokumen pajak', other: 'Lainnya',
});

class FinanceError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}
const notFound = () => new FinanceError('NOT_FOUND', 'Pengajuan tidak ditemukan atau bukan untuk Anda', 404);
const forbidden = (message = 'Anda tidak punya izin untuk tindakan ini') => new FinanceError('FORBIDDEN', message, 403);
const fieldError = (field, message) => new FinanceError('VALIDATION_ERROR', message, 400, { fieldErrors: { [field]: [message] } });

// ------------------------------------------------------------------ pure rules

const has = (user, code) => (user?.permissions || []).includes(code);
const isFinance = (user) => has(user, 'finance.manage') || has(user, 'finance.process');
const isMine = (user, row) => Number(row?.requested_by) === Number(user?.sub);

/** Finance and the Management Office read every request of the entity. */
const readsAll = (user) => isFinance(user) || has(user, 'finance.approve') || has(user, 'management_dashboard.view');

/**
 * The SQL that limits a list to what `user` may read (alias f): all, their
 * division's plus their own (a division Head), or only their own.
 */
function readScope(user) {
  if (readsAll(user)) return { sql: '', args: [] };
  if (has(user, 'management_dashboard.division') && user.departmentId != null) {
    return { sql: ' AND (f.requested_by = ? OR f.department_id = ?)', args: [user.sub, user.departmentId] };
  }
  return { sql: ' AND f.requested_by = ?', args: [user.sub] };
}

/** Whether `user` may read this row (same rule as readScope). */
function canRead(user, row) {
  if (!row) return false;
  if (readsAll(user) || isMine(user, row)) return true;
  return has(user, 'management_dashboard.division') && user.departmentId != null
    && row.department_id != null && Number(row.department_id) === Number(user.departmentId);
}

const filled = (value) => value !== undefined && value !== null && String(value).trim() !== '';

/**
 * A reimbursement pays an employee: none of the payee bank fields may be sent.
 * → the first offending field, or null.
 */
function employeeBankField(workflowType, body) {
  if (workflowType !== 'reimbursement') return null;
  return PAYEE_BANK_FIELDS.find((field) => filled(body?.[field])) || null;
}

const canProcessTo = (from, to) => Boolean(PROCESS_FROM[to]?.includes(from));
const canCancel = (user, row) => (isMine(user, row) && REQUESTER_CANCELLABLE.includes(row.status))
  || (has(user, 'finance.process') && FINANCE_CANCELLABLE.includes(row.status));

/** What `user` may do with this request; `decide` is computed by the caller. */
function permissionsFor(user, row, { decide = false, approvalStatus = null } = {}) {
  const mine = isMine(user, row);
  const editable = EDITABLE.includes(row.status);
  const finance = isFinance(user);
  return {
    edit: editable && (mine || has(user, 'finance.manage')),
    attach: (editable && (mine || has(user, 'finance.manage'))) || (finance && ['approved', 'processing', 'paid'].includes(row.status)),
    check: editable && (mine || has(user, 'finance.document_check')),
    submit: editable && (mine || has(user, 'finance.manage')),
    remove: row.status === 'draft' && (mine || has(user, 'finance.manage')),
    decide: Boolean(decide),
    process: has(user, 'finance.process') && canProcessTo(row.status, 'processing'),
    markPaid: has(user, 'finance.process') && canProcessTo(row.status, 'paid'),
    cancel: canCancel(user, row),
    // Fallback for a decision made before the approval hook existed.
    applyDecision: has(user, 'finance.approve') && row.status === 'pending_approval'
      && ['approved', 'rejected', 'revision_requested'].includes(approvalStatus),
  };
}

/** Required attachment types not uploaded yet (rule part of the document check). */
function missingRequired(workflowType, attachments) {
  const rule = checkSvc.REQUIRED_DOCS[workflowType];
  if (!rule) return [];
  const uploaded = new Set((attachments || []).map((a) => a.attachment_type));
  return rule.required.filter((type) => !uploaded.has(type));
}

const dateOnly = (value) => {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};
const instant = (value) => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const num = (value) => (value == null ? null : Number(value));
const parseJson = (value) => {
  if (value == null || typeof value === 'object') return value || null;
  try { return JSON.parse(value); } catch { return null; }
};

/** The API shape of one request (a reimbursement never carries bank fields). */
function requestDto(row) {
  const employee = row.workflow_type === 'reimbursement';
  return {
    id: Number(row.id),
    entityId: Number(row.entity_id),
    departmentId: row.department_id != null ? Number(row.department_id) : null,
    departmentName: row.department_name || null,
    workflowType: row.workflow_type,
    requestNumber: row.request_number,
    title: row.title,
    description: row.description || null,
    category: row.category || null,
    payeeName: row.payee_name || null,
    payeeType: row.payee_type || null,
    payeeBank: employee ? null : row.payee_bank || null,
    payeeAccountNumber: employee ? null : row.payee_account_number || null,
    payeeAccountName: employee ? null : row.payee_account_name || null,
    amount: num(row.amount),
    taxAmount: num(row.tax_amount) || 0,
    totalAmount: num(row.total_amount),
    currency: row.currency || 'IDR',
    requestDate: dateOnly(row.request_date),
    requestedPaymentDate: dateOnly(row.requested_payment_date),
    dueDate: dateOnly(row.due_date),
    status: row.status,
    documentCheckStatus: row.document_check_status || 'not_run',
    documentCheckSummary: row.document_check_summary || null,
    documentCheckAt: instant(row.document_check_at),
    approvalRequestId: row.approval_request_id != null ? Number(row.approval_request_id) : null,
    approvalStatus: row.approval_status || null,
    accurateReference: row.jurnal_reference_id || null,
    requestedBy: Number(row.requested_by),
    requesterName: row.requester_name || null,
    financePicUserId: row.finance_pic_user_id != null ? Number(row.finance_pic_user_id) : null,
    financePicName: row.finance_pic_name || null,
    paidAt: instant(row.paid_at),
    paidByName: row.paid_by_name || null,
    notes: row.notes || null,
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
  };
}

const SELECT = `
  SELECT f.*, d.name AS department_name, u.name AS requester_name, pic.name AS finance_pic_name,
         pb.name AS paid_by_name, ar.status AS approval_status
    FROM finance_workflows f
    LEFT JOIN departments d ON d.id = f.department_id
    LEFT JOIN users u ON u.id = f.requested_by
    LEFT JOIN users pic ON pic.id = f.finance_pic_user_id
    LEFT JOIN users pb ON pb.id = f.paid_by
    LEFT JOIN approval_requests ar ON ar.id = f.approval_request_id`;

// ------------------------------------------------------------------ helpers

// One transaction on its own connection. The numbering lock (nextNumber.js, a
// session GET_LOCK) is released after commit/rollback, never before.
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (error) {
    try { await conn.rollback(); } catch { /* connection gone */ }
    throw error;
  } finally {
    try { await conn.query('SELECT RELEASE_ALL_LOCKS()'); } catch { /* connection may be gone */ }
    conn.release();
  }
}

async function lockRow(conn, entityId, id) {
  const [[row]] = await conn.query(
    'SELECT * FROM finance_workflows WHERE id = ? AND entity_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
    [id, entityId],
  );
  return row || null;
}

async function readRow(user, id, conn = pool) {
  const [[row]] = await conn.query(`${SELECT} WHERE f.id = ? AND f.entity_id = ? AND f.deleted_at IS NULL LIMIT 1`, [id, user.entityId]);
  return row || null;
}

/** A row the caller may read (or may decide), else 404 — never a hint that it exists. */
async function readableRow(user, id) {
  const row = await readRow(user, id);
  if (!row) throw notFound();
  if (canRead(user, row)) return row;
  if (row.status === 'pending_approval' && await canUserDecideRow(pool, user, row)) return row;
  throw notFound();
}

async function notifyUsers(userIds, payload) {
  for (const userId of [...new Set((userIds || []).map(Number))].filter(Boolean)) {
    try { await notif.create({ ...payload, userId }); } catch { /* best effort */ }
  }
}

/** Accounts of the entity holding a permission (Finance processors). */
async function holders(entityId, code) {
  const [rows] = await pool.query(
    `SELECT DISTINCT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL AND r.entity_id = u.entity_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id AND p.code = ?
      WHERE u.entity_id = ? AND u.status = 'active' AND u.deleted_at IS NULL`,
    [code, entityId],
  );
  return rows.map((r) => Number(r.id));
}

// ------------------------------------------------------------------ reads

async function list(user, query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || PAGE_SIZE));
  const where = ['f.entity_id = ?', 'f.deleted_at IS NULL'];
  const args = [user.entityId];
  const scope = readScope(user);
  if (scope.sql) { where.push(scope.sql.replace(/^ AND /, '')); args.push(...scope.args); }
  if (query.mine === '1' || query.mine === 'true') { where.push('f.requested_by = ?'); args.push(user.sub); }
  if (['payment_request', 'reimbursement'].includes(query.workflowType)) { where.push('f.workflow_type = ?'); args.push(query.workflowType); }
  if (STATUSES.includes(query.status)) { where.push('f.status = ?'); args.push(query.status); }
  if (query.departmentId && Number(query.departmentId) > 0) { where.push('f.department_id = ?'); args.push(Number(query.departmentId)); }
  const q = String(query.q || '').trim().slice(0, 100);
  if (q) {
    where.push('(f.title LIKE ? OR f.request_number LIKE ? OR f.payee_name LIKE ? OR f.category LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const clause = where.join(' AND ');
  const [rows] = await pool.query(`${SELECT} WHERE ${clause} ORDER BY f.id DESC LIMIT ? OFFSET ?`, [...args, limit, (page - 1) * limit]);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM finance_workflows f WHERE ${clause}`, args);
  return { rows: rows.map(requestDto), meta: { page, limit, total: Number(total) } };
}

async function get(user, id) {
  const row = await readableRow(user, id);
  const [attachments] = await pool.query(
    `SELECT a.id, a.attachment_type, a.name, a.mime_type, a.size, a.web_view_link, a.created_at, u.name AS uploaded_by_name
       FROM finance_workflow_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE a.finance_workflow_id = ? ORDER BY a.id`,
    [row.id],
  );
  // Every approval round of this request (a revision opens a new one), oldest first.
  const [steps] = await pool.query(
    `SELECT s.id, s.approval_request_id, s.order_index, s.status, s.note, s.decided_at, s.activated_at,
            du.name AS decided_by_name, au.name AS approver_user_name, ro.name AS approver_role_name,
            ar.created_at AS round_created_at
       FROM approval_requests ar
       JOIN approval_steps s ON s.approval_request_id = ar.id
       LEFT JOIN users du ON du.id = s.decided_by
       LEFT JOIN users au ON au.id = s.approver_user_id
       LEFT JOIN roles ro ON ro.id = s.approver_role_id
      WHERE ar.entity_id = ? AND ar.subject_type = ? AND ar.subject_id = ?
      ORDER BY ar.id, s.order_index, s.id`,
    [row.entity_id, SUBJECT, row.id],
  );
  const [history] = await pool.query(
    `SELECT l.id, l.action, l.metadata, l.created_at, u.name AS user_name
       FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.entity_id = ? AND l.subject_type = ? AND l.subject_id = ?
      ORDER BY l.created_at DESC, l.id DESC LIMIT 50`,
    [row.entity_id, SUBJECT, row.id],
  );
  const decide = row.status === 'pending_approval' && await canUserDecideRow(pool, user, row);
  return {
    ...requestDto(row),
    attachments: attachments.map((a) => ({
      id: Number(a.id), attachmentType: a.attachment_type, name: a.name, mimeType: a.mime_type || null,
      size: a.size != null ? Number(a.size) : null, webViewLink: a.web_view_link || null,
      uploadedByName: a.uploaded_by_name || null, createdAt: instant(a.created_at),
    })),
    approvalSteps: steps.map((s) => ({
      id: Number(s.id), approvalRequestId: Number(s.approval_request_id), order: Number(s.order_index || 1),
      status: s.status, note: s.note || null, decidedAt: instant(s.decided_at), decidedByName: s.decided_by_name || null,
      approverName: s.approver_user_name || s.approver_role_name || null, activatedAt: instant(s.activated_at),
    })),
    history: history.map((h) => ({ id: Number(h.id), action: h.action, metadata: parseJson(h.metadata), userName: h.user_name || null, at: instant(h.created_at) })),
    requiredAttachments: checkSvc.REQUIRED_DOCS[row.workflow_type]?.required || [],
    can: permissionsFor(user, row, { decide, approvalStatus: row.approval_status }),
  };
}

/**
 * Requests waiting for a decision `user` can make now (the active approval
 * step is theirs: engine rule + separation of duties, as on the detail page),
 * oldest first. Read only; a user who decides nothing gets an empty list.
 */
async function awaitingMyDecision(user, { limit = PAGE_SIZE } = {}) {
  if (!has(user, 'approval.decide')) return { rows: [], total: 0 };
  const [rows] = await pool.query(
    `${SELECT} WHERE f.entity_id = ? AND f.deleted_at IS NULL AND f.status = 'pending_approval'
        AND f.approval_request_id IS NOT NULL AND f.requested_by <> ?
      ORDER BY f.id LIMIT 200`,
    [user.entityId, user.sub],
  );
  const mine = [];
  for (const row of rows) {
    if (await canUserDecideRow(pool, user, row)) mine.push(row);
  }
  const max = Math.min(100, Math.max(1, parseInt(limit, 10) || PAGE_SIZE));
  return { rows: mine.slice(0, max).map(requestDto), total: mine.length };
}

// ------------------------------------------------------------------ writes

async function create(user, body) {
  if (!user.departmentId) {
    throw new FinanceError('NO_DIVISION', 'Akun Anda belum terdaftar di divisi mana pun. Minta admin mengisi divisi Anda dulu.', 409);
  }
  const workflowType = body.workflowType;
  const bankField = employeeBankField(workflowType, body);
  if (bankField) throw fieldError(bankField, EMPLOYEE_ACCOUNT_MESSAGE);
  if (workflowType === 'payment_request' && body.payeeType === 'employee') throw fieldError('payeeType', EMPLOYEE_PAYEE_MESSAGE);

  const [[me]] = await pool.query('SELECT name FROM users WHERE id = ? LIMIT 1', [user.sub]);
  const employee = workflowType === 'reimbursement';
  const amount = Number(body.amount);
  const tax = Number(body.taxAmount || 0);
  const total = body.totalAmount != null ? Number(body.totalAmount) : Math.round((amount + tax) * 100) / 100;
  if (total < amount) throw fieldError('totalAmount', 'Total tidak boleh lebih kecil dari subtotal');
  const payeeName = filled(body.payeeName) ? body.payeeName.trim() : (employee ? me?.name || null : null);
  if (!employee && !payeeName) throw fieldError('payeeName', 'Isi nama penerima pembayaran');

  return transaction(async (conn) => {
    const { number, result: [created] } = await insertWithNumber(
      conn, { table: 'finance_workflows', column: 'request_number', prefix: PREFIX[workflowType], entityId: user.entityId },
      (requestNumber) => conn.query(
        `INSERT INTO finance_workflows
           (entity_id, department_id, workflow_type, request_number, title, description, category,
            payee_name, payee_type, payee_bank, payee_account_number, payee_account_name,
            amount, tax_amount, total_amount, currency, request_date, requested_payment_date, due_date,
            status, requested_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IDR', ?, ?, ?, 'draft', ?, ?)`,
        [
          user.entityId, user.departmentId, workflowType, requestNumber, body.title.trim(), body.description || null, body.category || null,
          payeeName, employee ? 'employee' : (body.payeeType || 'vendor'),
          employee ? null : body.payeeBank || null, employee ? null : body.payeeAccountNumber || null, employee ? null : body.payeeAccountName || null,
          amount, tax, total, body.requestDate || todayWib(), body.requestedPaymentDate || null, body.dueDate || null,
          user.sub, body.notes || null,
        ],
      ),
    );
    await logWith(conn, {
      entityId: user.entityId, userId: user.sub, action: 'finance.create', subjectType: SUBJECT, subjectId: created.insertId,
      metadata: { workflowType, requestNumber: number, totalAmount: total },
    });
    return { id: Number(created.insertId), requestNumber: number };
  });
}

const UPDATE_COLUMNS = Object.freeze({
  title: 'title', description: 'description', category: 'category', payeeName: 'payee_name', payeeType: 'payee_type',
  payeeBank: 'payee_bank', payeeAccountNumber: 'payee_account_number', payeeAccountName: 'payee_account_name',
  amount: 'amount', taxAmount: 'tax_amount', totalAmount: 'total_amount', requestDate: 'request_date',
  requestedPaymentDate: 'requested_payment_date', dueDate: 'due_date', notes: 'notes',
});

async function update(user, id, body) {
  return transaction(async (conn) => {
    const row = await lockRow(conn, user.entityId, id);
    if (!row || !canRead(user, row)) throw notFound();
    if (!permissionsFor(user, row).edit) {
      if (!EDITABLE.includes(row.status)) throw new FinanceError('INVALID_STATUS', 'Pengajuan yang sudah diajukan tidak bisa diubah', 409);
      throw forbidden('Hanya pengaju atau Finance yang bisa mengubah pengajuan ini');
    }
    const bankField = employeeBankField(row.workflow_type, body);
    if (bankField) throw fieldError(bankField, EMPLOYEE_ACCOUNT_MESSAGE);
    if (row.workflow_type === 'reimbursement' && body.payeeType && body.payeeType !== 'employee') {
      throw fieldError('payeeType', 'Reimbursement selalu dibayar ke karyawan');
    }
    if (row.workflow_type === 'payment_request' && body.payeeType === 'employee') throw fieldError('payeeType', EMPLOYEE_PAYEE_MESSAGE);
    const sets = [];
    const args = [];
    for (const [key, column] of Object.entries(UPDATE_COLUMNS)) {
      if (body[key] === undefined) continue;
      if (['title', 'amount', 'totalAmount', 'requestDate'].includes(key) && body[key] === null) continue;
      sets.push(`${column} = ?`);
      args.push(typeof body[key] === 'string' ? body[key].trim() || null : body[key]);
    }
    const amount = body.amount != null ? Number(body.amount) : Number(row.amount);
    const total = body.totalAmount != null ? Number(body.totalAmount) : Number(row.total_amount);
    if (total < amount) throw fieldError('totalAmount', 'Total tidak boleh lebih kecil dari subtotal');
    if (row.workflow_type === 'payment_request' && body.payeeName !== undefined && !filled(body.payeeName)) {
      throw fieldError('payeeName', 'Isi nama penerima pembayaran');
    }
    if (!sets.length) return { id: Number(row.id) };
    await conn.query(`UPDATE finance_workflows SET ${sets.join(', ')} WHERE id = ?`, [...args, row.id]);
    await logWith(conn, {
      entityId: row.entity_id, userId: user.sub, action: 'finance.update', subjectType: SUBJECT, subjectId: Number(row.id),
      metadata: { fields: Object.keys(body).filter((k) => UPDATE_COLUMNS[k] && body[k] !== undefined) },
    });
    return { id: Number(row.id) };
  });
}

function checkFile(file) {
  if (!file) return;
  if (!ATTACHMENT_MIME.includes(file.mimetype)) throw new FinanceError('FILE_TYPE_NOT_ALLOWED', 'Lampiran hanya PDF atau foto (PNG, JPG, WebP)');
  if (Number(file.size) > MAX_ATTACHMENT_BYTES) throw new FinanceError('FILE_TOO_LARGE', 'Ukuran lampiran paling besar 10 MB');
}

async function addAttachment(user, id, { file, attachmentType = 'other', documentId = null, name = null }, { upload = drive.uploadFile } = {}) {
  if (!file && !documentId) throw new FinanceError('VALIDATION_ERROR', 'Pilih file yang akan dilampirkan');
  checkFile(file);
  const row = await readRow(user, id);
  if (!row || !canRead(user, row)) throw notFound();
  if (!permissionsFor(user, row).attach) {
    throw new FinanceError('INVALID_STATUS', EDITABLE.includes(row.status) || ['approved', 'processing', 'paid'].includes(row.status)
      ? 'Hanya pengaju atau Finance yang bisa melampirkan file'
      : 'Lampiran tidak bisa ditambahkan pada status ini', EDITABLE.includes(row.status) ? 403 : 409);
  }
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM finance_workflow_attachments WHERE finance_workflow_id = ?', [row.id]);
  if (Number(n) >= MAX_ATTACHMENTS) throw new FinanceError('ATTACHMENT_LIMIT', `Paling banyak ${MAX_ATTACHMENTS} lampiran per pengajuan`, 409);

  let stored;
  if (file) {
    const up = await upload(
      { name: file.originalname, mimeType: file.mimetype, buffer: file.buffer },
      { entityId: user.entityId, userId: user.sub, subjectType: SUBJECT, subjectId: Number(row.id) },
    );
    stored = {
      driveFileId: up.id, webViewLink: up.webViewLink || null, name: String(name || up.name || file.originalname).slice(0, 255),
      mimeType: up.mimeType || file.mimetype, size: Number(up.size || file.size),
    };
  } else {
    const [[doc]] = await pool.query(
      `SELECT d.id, d.title, d.drive_file_id, d.department_id, d.created_by, m.web_view_link FROM documents d
         LEFT JOIN drive_files_metadata m ON m.drive_file_id = d.drive_file_id
        WHERE d.id = ? AND d.entity_id = ? AND d.deleted_at IS NULL LIMIT 1`,
      [documentId, user.entityId],
    );
    // Same rule as the Document Center: a document of another division can't
    // be attached (it would leak its title and Drive link to the approvers).
    if (!doc || !canSeeDocument(user, doc)) throw new FinanceError('NOT_FOUND', 'Dokumen tidak ditemukan', 404);
    stored = { driveFileId: doc.drive_file_id, webViewLink: doc.web_view_link || null, name: String(name || doc.title).slice(0, 255), mimeType: null, size: null };
  }
  const [created] = await pool.query(
    `INSERT INTO finance_workflow_attachments
       (finance_workflow_id, document_id, drive_file_id, web_view_link, attachment_type, name, mime_type, size, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, documentId || null, stored.driveFileId, stored.webViewLink, attachmentType, stored.name, stored.mimeType, stored.size, user.sub],
  );
  await logOutside({
    entityId: row.entity_id, userId: user.sub, action: 'finance.attachment', subjectType: SUBJECT, subjectId: Number(row.id),
    metadata: { attachmentType, name: stored.name.slice(0, 120) },
  });
  return { id: Number(created.insertId), webViewLink: stored.webViewLink };
}

/** The rule-based + AI completeness check (AI only advises; it never approves). */
async function runDocumentCheck(user, id) {
  const row = await readRow(user, id);
  if (!row || !canRead(user, row)) throw notFound();
  if (!permissionsFor(user, row).check) {
    if (!EDITABLE.includes(row.status)) throw new FinanceError('INVALID_STATUS', 'Pemeriksaan dokumen hanya sebelum pengajuan dikirim', 409);
    throw forbidden('Hanya pengaju atau Finance yang bisa memeriksa dokumen pengajuan ini');
  }
  const [attachments] = await pool.query('SELECT attachment_type, name FROM finance_workflow_attachments WHERE finance_workflow_id = ?', [row.id]);
  const result = await checkSvc.checkCompleteness({
    module: row.workflow_type, attachments, workflowMeta: row, entityId: row.entity_id, departmentId: row.department_id,
    subjectType: SUBJECT, subjectId: row.id, userId: user.sub,
  });
  await pool.query(
    `UPDATE finance_workflows SET document_check_status = ?, document_check_summary = ?, document_check_at = NOW(),
            document_check_ai_summary_id = ? WHERE id = ?`,
    [result.status, result.notes, result.aiSummaryId || null, row.id],
  );
  await logOutside({
    entityId: row.entity_id, userId: user.sub, action: 'finance.document_check', subjectType: SUBJECT, subjectId: Number(row.id),
    metadata: { status: result.status, missing: result.missing },
  });
  return { status: result.status, missing: result.missing, missingOptional: result.missingOptional, notes: result.notes };
}

/**
 * Sends the request to approval. Required documents must be attached; a failed
 * AI check blocks only until a new attachment is added after it.
 */
async function submit(user, id) {
  const outcome = await transaction(async (conn) => {
    const row = await lockRow(conn, user.entityId, id);
    if (!row || !canRead(user, row)) throw notFound();
    if (!EDITABLE.includes(row.status)) throw new FinanceError('INVALID_STATUS', 'Pengajuan ini sudah diajukan', 409);
    if (!permissionsFor(user, row).submit) throw forbidden('Hanya pengaju yang bisa mengajukan pengajuan ini');

    const [attachments] = await conn.query(
      'SELECT attachment_type, created_at FROM finance_workflow_attachments WHERE finance_workflow_id = ?', [row.id],
    );
    const missing = missingRequired(row.workflow_type, attachments);
    if (missing.length) {
      throw new FinanceError('DOCUMENTS_MISSING', `Lampirkan dulu: ${missing.map((t) => ATTACHMENT_LABELS[t] || t).join(', ')}`, 409);
    }
    const checkedAt = row.document_check_at ? new Date(row.document_check_at).getTime() : 0;
    const newerAttachment = attachments.some((a) => new Date(a.created_at).getTime() > checkedAt);
    if (row.document_check_status === 'failed' && !newerAttachment) {
      throw new FinanceError('DOCUMENT_CHECK_FAILED', 'Pemeriksaan dokumen menemukan kekurangan. Lengkapi lampiran, lalu periksa ulang.', 409);
    }
    const checkStatus = ['passed', 'warning'].includes(row.document_check_status) && !newerAttachment
      ? row.document_check_status
      : (missingRequired(row.workflow_type, attachments).length ? 'failed' : 'passed');

    const [[account]] = await conn.query(
      `SELECT p.manager_id FROM users u
         LEFT JOIN people_directory p ON p.entity_id = u.entity_id AND p.user_id = u.id
        WHERE u.id = ? LIMIT 1`,
      [row.requested_by],
    );
    const money = `Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(row.total_amount) || 0)}`;
    const approval = await engine.createApprovalRequest({
      entityId: row.entity_id,
      departmentId: row.department_id,
      subjectType: SUBJECT,
      subjectId: row.id,
      requestType: REQUEST_TYPES[row.workflow_type],
      amount: Number(row.total_amount),
      currency: row.currency || 'IDR',
      title: `${row.request_number} · ${row.title}`,
      description: `${row.workflow_type === 'reimbursement' ? 'Reimbursement' : 'Pengajuan pembayaran'} ${money}${row.payee_name ? ` ke ${row.payee_name}` : ''}`,
      requestedBy: row.requested_by,
    }, conn);
    let basis = 'matrix';
    if (approval.flowType === engine.FLOW.LEGACY) {
      // No matrix for Finance yet: the manager → division Head → Management Office
      // Head decides (never the requester), instead of "anyone with approval.decide".
      const approver = await resolver.resolveApprover(conn, {
        entityId: row.entity_id, managerPersonId: account?.manager_id || null, departmentId: row.department_id,
        excludeUserIds: [row.requested_by, user.sub],
      });
      await resolver.assignFirstStep(conn, approval.id, approver);
      basis = approver.basis;
    }
    await approvalAudit.log({
      entityId: row.entity_id, actorUserId: user.sub, entityType: 'request', entityIdRef: approval.id, action: 'create',
      after: { subjectType: SUBJECT, subjectId: Number(row.id), flowType: approval.flowType, approverBasis: basis },
    }, conn);
    await conn.query(
      `UPDATE finance_workflows SET status = 'pending_approval', approval_request_id = ?, document_check_status = ?
        WHERE id = ?`,
      [approval.id, checkStatus, row.id],
    );
    await logWith(conn, {
      entityId: row.entity_id, userId: user.sub, action: 'finance.submit', subjectType: SUBJECT, subjectId: Number(row.id),
      metadata: { approvalRequestId: approval.id, approverBasis: basis },
    });
    return { row, approvalRequestId: approval.id, basis, title: `${row.request_number} · ${row.title}` };
  });
  // The approvers hear it the way every approval step is announced (approval.step_activated).
  const steps = await engine.getActiveSteps(outcome.approvalRequestId);
  await notifySteps(steps.map((st) => st.id), {
    id: outcome.approvalRequestId, entity_id: outcome.row.entity_id, title: outcome.title,
    subject_type: SUBJECT, subject_id: Number(outcome.row.id),
  }, { excludeUserIds: [outcome.row.requested_by] }).catch(() => {});
  return { id: Number(outcome.row.id), status: 'pending_approval', approvalRequestId: outcome.approvalRequestId, approverBasis: outcome.basis };
}

/** Finance moves an approved request on: processing, then paid. */
async function processPayment(user, id, { status, accurateReference, note }) {
  if (!has(user, 'finance.process')) throw forbidden('Hanya Finance yang memproses pembayaran');
  if (!PROCESS_FROM[status]) throw new FinanceError('VALIDATION_ERROR', 'Status tidak valid');
  const row = await transaction(async (conn) => {
    const locked = await lockRow(conn, user.entityId, id);
    if (!locked) throw notFound();
    if (!canProcessTo(locked.status, status)) {
      throw new FinanceError('INVALID_STATUS', status === 'paid'
        ? 'Hanya pengajuan yang sudah disetujui yang bisa ditandai dibayar'
        : 'Hanya pengajuan yang sudah disetujui yang bisa diproses', 409);
    }
    const sets = ['status = ?'];
    const args = [status];
    if (status === 'processing' && !locked.finance_pic_user_id) { sets.push('finance_pic_user_id = ?'); args.push(user.sub); }
    if (status === 'paid') {
      sets.push('paid_at = NOW()', 'paid_by = ?');
      args.push(user.sub);
      if (filled(accurateReference)) { sets.push('jurnal_reference_id = ?'); args.push(String(accurateReference).trim()); }
    }
    await conn.query(`UPDATE finance_workflows SET ${sets.join(', ')} WHERE id = ?`, [...args, locked.id]);
    await logWith(conn, {
      entityId: locked.entity_id, userId: user.sub, action: `finance.${status}`, subjectType: SUBJECT, subjectId: Number(locked.id),
      metadata: { accurateReference: filled(accurateReference) ? String(accurateReference).trim() : null, note: note || null },
    });
    return locked;
  });
  await notifyUsers([row.requested_by].filter((uid) => Number(uid) !== Number(user.sub)), {
    entityId: row.entity_id,
    title: status === 'paid' ? 'Pengajuan pembayaran sudah dibayar' : 'Pengajuan pembayaran sedang diproses Finance',
    body: `${row.request_number} · ${row.title}`, event: status === 'paid' ? 'finance.payment_paid' : 'finance.payment_processing',
    subjectType: SUBJECT, subjectId: Number(row.id), actionUrl: `/finance/payment-requests/${row.id}`,
  });
  return { id: Number(row.id), status };
}

/** Cancels with a reason; a pending approval is withdrawn in the same transaction. */
async function cancel(user, id, { reason }) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw fieldError('reason', 'Tulis alasan pembatalan');
  const row = await transaction(async (conn) => {
    const locked = await lockRow(conn, user.entityId, id);
    if (!locked || !canRead(user, locked)) throw notFound();
    if (!canCancel(user, locked)) {
      if (['paid', 'cancelled', 'rejected'].includes(locked.status)) throw new FinanceError('INVALID_STATUS', 'Pengajuan ini sudah selesai dan tidak bisa dibatalkan', 409);
      throw forbidden(isMine(user, locked) ? 'Pengajuan yang sudah disetujui hanya bisa dibatalkan Finance' : 'Hanya pengaju atau Finance yang bisa membatalkan pengajuan ini');
    }
    if (locked.status === 'pending_approval' && locked.approval_request_id) {
      const [[approval]] = await conn.query('SELECT status FROM approval_requests WHERE id = ? LIMIT 1', [locked.approval_request_id]);
      if (approval?.status === 'pending') {
        await engine.withdrawRequest({ approvalRequestId: locked.approval_request_id, actorUserId: user.sub, note: `Dibatalkan: ${cleanReason}`, conn });
      }
    }
    await conn.query("UPDATE finance_workflows SET status = 'cancelled' WHERE id = ?", [locked.id]);
    await logWith(conn, {
      entityId: locked.entity_id, userId: user.sub, action: 'finance.cancelled', subjectType: SUBJECT, subjectId: Number(locked.id),
      metadata: { reason: cleanReason.slice(0, 255), from: locked.status },
    });
    return locked;
  });
  await notifyUsers([row.requested_by].filter((uid) => Number(uid) !== Number(user.sub)), {
    entityId: row.entity_id, title: 'Pengajuan pembayaran dibatalkan', body: `${row.request_number} · ${cleanReason.slice(0, 120)}`,
    event: 'finance.payment_cancelled', subjectType: SUBJECT, subjectId: Number(row.id), actionUrl: `/finance/payment-requests/${row.id}`,
  });
  return { id: Number(row.id), status: 'cancelled' };
}

/** Deletes a draft (soft delete; nothing else is ever removed). */
async function remove(user, id) {
  return transaction(async (conn) => {
    const row = await lockRow(conn, user.entityId, id);
    if (!row || !canRead(user, row)) throw notFound();
    if (row.status !== 'draft') throw new FinanceError('INVALID_STATUS', 'Hanya draf yang bisa dihapus; batalkan pengajuan yang sudah berjalan', 409);
    if (!permissionsFor(user, row).remove) throw forbidden('Hanya pengaju atau Finance yang bisa menghapus draf ini');
    await conn.query('UPDATE finance_workflows SET deleted_at = NOW() WHERE id = ?', [row.id]);
    await logWith(conn, { entityId: row.entity_id, userId: user.sub, action: 'finance.delete', subjectType: SUBJECT, subjectId: Number(row.id) });
    return { id: Number(row.id) };
  });
}

// ------------------------------------------------------------------ approval hooks
// Registered below with approvalSubjectLifecycle: a decision on
// POST /approvals/:id/decide is applied to the request in the same transaction.

async function decisionDenial(conn, { approval, user, row }) {
  if (Number(user.sub) === Number(row.requested_by)) {
    return new FinanceError('SELF_APPROVAL_FORBIDDEN', 'Pengaju tidak bisa menyetujui pengajuannya sendiri', 403);
  }
  if (await resolver.isExcludedAccount(conn, approval.entity_id, user.sub)) {
    return new FinanceError('APPROVER_EXCLUDED', 'Akun ini dikecualikan di direktori, jadi tidak bisa memutuskan approval', 403);
  }
  return null;
}

async function lockForDecision(approval, conn) {
  const row = await lockRow(conn, approval.entity_id, approval.subject_id);
  if (!row) throw notFound();
  if (row.status !== 'pending_approval' || Number(row.approval_request_id) !== Number(approval.id)) {
    throw new FinanceError('STALE_APPROVAL', 'Approval ini bukan approval aktif pengajuan tersebut', 409);
  }
  return row;
}

async function assertCanDecide({ approval, user, action, note, conn }) {
  const row = await lockForDecision(approval, conn);
  const denial = await decisionDenial(conn, { approval, user, row });
  if (denial) {
    // Outside the decision's transaction (which rolls back on this error), so the denial stays logged.
    await logOutside({
      entityId: approval.entity_id, userId: user.sub, action: 'finance.decision_denied', subjectType: SUBJECT,
      subjectId: Number(row.id), metadata: { approvalRequestId: approval.id, action, code: denial.code },
    });
    throw denial;
  }
  if (!['approve', 'reject', 'request_revision'].includes(action)) throw new FinanceError('VALIDATION_ERROR', 'Keputusan tidak dikenal');
  if (action !== 'approve' && !String(note || '').trim()) {
    throw new FinanceError('VALIDATION_ERROR', action === 'reject' ? 'Tulis alasan penolakan' : 'Tulis apa yang perlu diperbaiki');
  }
}

/** Whether `user` can decide the active step of this row's approval (engine rule + SoD). */
async function canUserDecideRow(conn, user, row) {
  if (!row.approval_request_id || !has(user, 'approval.decide') || isMine(user, row)) return false;
  const [[approval]] = await conn.query(
    "SELECT * FROM approval_requests WHERE id = ? AND entity_id = ? AND status = 'pending' LIMIT 1",
    [row.approval_request_id, user.entityId],
  );
  if (!approval) return false;
  if (await resolver.isExcludedAccount(conn, approval.entity_id, user.sub)) return false;
  const [roles] = await conn.query(
    `SELECT ur.role_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND r.entity_id = ? AND r.deleted_at IS NULL`,
    [user.sub, user.entityId],
  );
  const steps = await engine.getActiveSteps(approval.id, conn);
  for (const step of steps) {
    if (await engine.canDecide({
      step, userId: user.sub, userRoleIds: roles.map((r) => Number(r.role_id)), userPermissions: user.permissions || [],
      entityId: approval.entity_id, requestType: approval.request_type, documentTypeId: approval.document_type_id, conn,
    })) return true;
  }
  return false;
}

async function canUserDecide({ approval, user, conn }) {
  const [[row]] = await conn.query(
    'SELECT id, status, approval_request_id, requested_by FROM finance_workflows WHERE id = ? AND entity_id = ? AND deleted_at IS NULL LIMIT 1',
    [approval.subject_id, approval.entity_id],
  );
  if (!row || row.status !== 'pending_approval' || Number(row.approval_request_id) !== Number(approval.id)) return false;
  return !(await decisionDenial(conn, { approval, user, row }));
}

const DECIDED = Object.freeze(['approved', 'rejected', 'revision_requested']);

async function applyApprovalDecision({ approval, result, actorUserId, note = null, conn }) {
  if (!DECIDED.includes(result?.status)) return { changed: false };
  const row = await lockForDecision(approval, conn);
  await conn.query('UPDATE finance_workflows SET status = ? WHERE id = ?', [result.status, row.id]);
  await logWith(conn, {
    entityId: row.entity_id, userId: actorUserId, action: `finance.${result.status}`, subjectType: SUBJECT, subjectId: Number(row.id),
    metadata: { approvalRequestId: approval.id, note: note ? String(note).slice(0, 255) : null },
  });
  return {
    changed: true, status: result.status, id: Number(row.id), entityId: Number(row.entity_id),
    requesterUserId: Number(row.requested_by), number: row.request_number, title: row.title,
  };
}

// The approvals controller already tells the requester about every decision
// (approval.approved / approval.revision_requested); a rejection of a payment
// is also announced as finance.payment_rejected (email, notificationPolicy.js).
// An approved request goes to Finance's queue.
async function afterDecision(outcome) {
  if (!outcome?.changed) return;
  const payload = {
    entityId: outcome.entityId, body: `${outcome.number} · ${outcome.title}`, subjectType: SUBJECT, subjectId: outcome.id,
    actionUrl: `/finance/payment-requests/${outcome.id}`,
  };
  if (outcome.status === 'rejected') {
    await notifyUsers([outcome.requesterUserId], { ...payload, title: 'Pengajuan pembayaran ditolak', event: 'finance.payment_rejected' });
  }
  if (outcome.status === 'approved') {
    const processors = await holders(outcome.entityId, 'finance.process');
    await notifyUsers(processors.filter((uid) => uid !== outcome.requesterUserId), {
      ...payload, title: 'Pengajuan pembayaran siap dibayar', event: 'finance.ready_to_pay',
    });
  }
}

/**
 * Fallback for a request decided before the approval hook was registered: copies
 * the decided approval's status onto the request. Never takes a status on trust.
 */
async function applyDecidedApproval(user, id) {
  if (!has(user, 'finance.approve')) throw forbidden();
  const outcome = await transaction(async (conn) => {
    const row = await lockRow(conn, user.entityId, id);
    if (!row) throw notFound();
    if (row.status !== 'pending_approval' || !row.approval_request_id) {
      throw new FinanceError('INVALID_STATUS', 'Pengajuan ini tidak sedang menunggu persetujuan', 409);
    }
    const [[approval]] = await conn.query('SELECT * FROM approval_requests WHERE id = ? LIMIT 1', [row.approval_request_id]);
    if (!approval || !DECIDED.includes(approval.status)) {
      throw new FinanceError('NOT_DECIDED', 'Approval pengajuan ini belum diputuskan', 409);
    }
    return applyApprovalDecision({ approval, result: { status: approval.status }, actorUserId: user.sub, note: approval.decision_note, conn });
  });
  await afterDecision(outcome);
  return { id: Number(id), status: outcome.status };
}

lifecycle.register([SUBJECT, ...Object.values(REQUEST_TYPES)], {
  assertCanDecide,
  canUserDecide,
  applyApprovalDecision,
  afterDecision,
});

module.exports = {
  FinanceError,
  SUBJECT,
  REQUEST_TYPES,
  STATUSES,
  EDITABLE,
  PROCESS_FROM,
  EMPLOYEE_ACCOUNT_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  ATTACHMENT_MIME,
  readScope,
  canRead,
  readsAll,
  employeeBankField,
  canProcessTo,
  canCancel,
  permissionsFor,
  missingRequired,
  requestDto,
  list,
  get,
  awaitingMyDecision,
  create,
  update,
  addAttachment,
  runDocumentCheck,
  submit,
  processPayment,
  cancel,
  remove,
  applyDecidedApproval,
  assertCanDecide,
  canUserDecide,
  applyApprovalDecision,
  afterDecision,
};
