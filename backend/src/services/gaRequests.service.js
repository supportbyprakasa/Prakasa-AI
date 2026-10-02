// Layanan GA — Permintaan (ATK, perbaikan fasilitas, lainnya), §3.2:
//   create → open (atk, facility_repair: the time target starts now)
//          → pending_approval (other: the manager/Head approves first; the
//            clock starts at approval)
//   open → in_progress → done (GA, with a resolution note)
//   open | in_progress → rejected (GA, with a reason)
//   pending_approval | open → cancelled (requester, with a reason)
// No closed/reopen state. Every write locks the request row and checks its
// version, and logs inside the same transaction.

const pool = require('../db/pool');
const drive = require('./googleDrive.service');
const rules = require('./gaRules');
const shared = require('./gaShared.service');
const { insertWithNumber } = require('./nextNumber');
const { log: logOutside } = require('./activityLog.service');

const { GaError, notFound, forbidden, versionConflict } = shared;
const { toApiTime } = rules;
const PAGE_SIZE = 20;

const REQUEST_SELECT = `
  SELECT r.*, l.name AS location_name, d.name AS department_name,
         ru.name AS requester_name, au.name AS assignee_name,
         ar.status AS approval_status
    FROM ga_requests r
    JOIN org_locations l ON l.entity_id = r.entity_id AND l.id = r.location_id
    LEFT JOIN departments d ON d.id = r.department_id
    LEFT JOIN users ru ON ru.id = r.requester_user_id
    LEFT JOIN users au ON au.id = r.assigned_to
    LEFT JOIN approval_requests ar ON ar.id = r.approval_request_id`;

const OVERDUE_SQL = "(r.status IN ('open', 'in_progress') AND r.due_at < UTC_TIMESTAMP())";

function requestDto(row, extra = {}) {
  const now = Date.now();
  const overdue = rules.OPEN_REQUEST.includes(row.status) && row.due_at && new Date(row.due_at).getTime() < now;
  return {
    id: Number(row.id),
    requestNumber: row.request_number,
    requestType: row.request_type,
    typeLabel: rules.REQUEST_TYPE_LABELS[row.request_type] || row.request_type,
    title: row.title,
    description: row.description || null,
    locationId: Number(row.location_id),
    locationName: row.location_name || null,
    area: row.area || null,
    urgency: row.urgency,
    departmentId: row.department_id != null ? Number(row.department_id) : null,
    departmentName: row.department_name || null,
    requester: { id: Number(row.requester_user_id), name: row.requester_name || null },
    assignee: row.assigned_to ? { id: Number(row.assigned_to), name: row.assignee_name || null } : null,
    status: row.status,
    approvalRequestId: row.approval_request_id ? Number(row.approval_request_id) : null,
    approvalStatus: row.approval_status || null,
    approverBasis: row.approver_basis || null,
    slaDays: row.sla_days != null ? Number(row.sla_days) : null,
    clockStartedAt: toApiTime(row.clock_started_at),
    dueAt: toApiTime(row.due_at),
    startedAt: toApiTime(row.started_at),
    doneAt: toApiTime(row.done_at),
    resolutionNote: row.resolution_note || null,
    rejectedReason: row.rejected_reason || null,
    cancelReason: row.cancel_reason || null,
    cancelledAt: toApiTime(row.cancelled_at),
    overdue: Boolean(overdue),
    onTime: row.status === 'done' && row.due_at ? new Date(row.done_at).getTime() <= new Date(row.due_at).getTime() : null,
    version: Number(row.version),
    createdAt: toApiTime(row.created_at),
    ...extra,
  };
}

async function lockRequest(conn, entityId, id) {
  const [[row]] = await conn.query('SELECT * FROM ga_requests WHERE id = ? AND entity_id = ? LIMIT 1 FOR UPDATE', [id, entityId]);
  return row || null;
}

async function bumpVersion(conn, id, version, patch) {
  const keys = Object.keys(patch);
  const [result] = await conn.query(
    `UPDATE ga_requests SET ${keys.map((k) => `${k} = ?`).join(', ')}, version = version + 1
      WHERE id = ? AND version = ?`,
    [...keys.map((k) => patch[k]), id, version],
  );
  if (!result.affectedRows) throw versionConflict();
}

function titleFor(body) {
  if (body.requestType === 'atk') {
    const [first, ...rest] = body.items;
    return `ATK: ${first.itemName}${rest.length ? ` (+${rest.length} barang lain)` : ''}`.slice(0, 190);
  }
  if (body.requestType === 'facility_repair') return `Perbaikan: ${body.area}`.slice(0, 190);
  return body.title;
}

// ------------------------------------------------------------------ create

async function create(user, body) {
  if (body.requestType === 'atk' && (!body.items?.length || body.items.length > rules.MAX_ITEMS)) {
    throw new GaError('ITEMS_INVALID', `Isi 1–${rules.MAX_ITEMS} barang`);
  }
  const outcome = await shared.transaction(async (conn) => {
    const account = await shared.accountOf(conn, user);
    await shared.assertLocation(conn, user.entityId, body.locationId);
    const now = new Date();
    const needsApproval = rules.needsApproval(body.requestType);
    const urgency = body.requestType === 'facility_repair' && body.urgent ? 'urgent' : 'normal';
    const slaDays = rules.slaDaysFor(body.requestType, urgency);
    const description = body.requestType === 'atk' ? (body.note || null) : (body.description || null);
    // Shared numbering (services/nextNumber.js, D1): named lock + locking MAX read +
    // one retry on a duplicate; the lock is released after commit by transaction().
    const { number, result: [created] } = await insertWithNumber(
      conn, { table: 'ga_requests', column: 'request_number', prefix: 'GA', entityId: user.entityId },
      (number) => conn.query(
        `INSERT INTO ga_requests
           (entity_id, department_id, request_number, request_type, title, description, location_id, area, urgency,
            requester_user_id, status, sla_days, clock_started_at, due_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.entityId, account.department_id || null, number, body.requestType, titleFor(body), description,
          body.locationId, body.requestType === 'facility_repair' ? body.area : null, urgency,
          user.sub, needsApproval ? 'pending_approval' : 'open',
          needsApproval ? null : slaDays, needsApproval ? null : now, needsApproval ? null : rules.dueAtFrom(now, slaDays),
          user.sub, user.sub,
        ],
      ),
    );
    const id = created.insertId;
    if (body.requestType === 'atk') {
      await conn.query(
        'INSERT INTO ga_request_items (request_id, item_name, qty, unit, sort_order) VALUES ?',
        [body.items.map((item, index) => [id, item.itemName, item.qty, item.unit, index])],
      );
    }
    let approval = null;
    if (needsApproval) {
      approval = await shared.openApproval(conn, {
        entityId: user.entityId,
        account,
        requesterUserId: user.sub,
        subjectType: rules.SUBJECT_REQUEST,
        subjectId: id,
        requestType: rules.APPROVAL_REQUEST_TYPE[body.requestType],
        title: `Permintaan GA ${number} — ${titleFor(body)}`.slice(0, 255),
        description: body.description ? String(body.description).slice(0, 500) : null,
      });
      await conn.query('UPDATE ga_requests SET approval_request_id = ?, approver_basis = ? WHERE id = ?', [approval.approvalRequestId, approval.basis, id]);
    }
    await shared.log(conn, {
      entityId: user.entityId, userId: user.sub, action: 'ga.request.create', subjectType: rules.SUBJECT_REQUEST, subjectId: id,
      metadata: { number, requestType: body.requestType, status: needsApproval ? 'pending_approval' : 'open', approverBasis: approval?.basis || null },
    });
    return { id, number, approval, title: titleFor(body) };
  });

  if (outcome.approval) {
    const users = await shared.activeStepUsers(user.entityId, outcome.approval.approvalRequestId, [user.sub]);
    await shared.notifyUsers(users, {
      entityId: user.entityId, title: 'Permintaan GA menunggu persetujuan Anda', body: `${outcome.number} · ${outcome.title}`,
      event: 'ga.approval_requested', subjectType: rules.SUBJECT_REQUEST, subjectId: outcome.id, actionUrl: `/ga/requests/${outcome.id}`,
    });
  } else {
    const { userIds } = await shared.gaRecipients(user.entityId);
    await shared.notifyUsers(userIds.filter((id) => id !== Number(user.sub)), {
      entityId: user.entityId, title: 'Permintaan GA baru', body: `${outcome.number} · ${outcome.title}`,
      event: 'ga.request_new', subjectType: rules.SUBJECT_REQUEST, subjectId: outcome.id, actionUrl: `/ga/requests/${outcome.id}`,
    });
  }
  return get(user, outcome.id);
}

// ------------------------------------------------------------------ read

async function canRead(user, row) {
  if (!row) return false;
  if (Number(row.requester_user_id) === Number(user.sub)) return true;
  if (shared.canProcess(user)) return true;
  if (row.assigned_to && Number(row.assigned_to) === Number(user.sub)) return true;
  if (shared.managementReads(user, row.department_id)) return true;
  // The approver of a pending "Lainnya" request opens it from the notification.
  return row.status === 'pending_approval' && shared.userCanDecide(pool, {
    approvalRequestId: row.approval_request_id, user, requesterUserId: row.requester_user_id, createdBy: row.created_by,
  });
}

async function get(user, id) {
  const [[row]] = await pool.query(`${REQUEST_SELECT} WHERE r.id = ? AND r.entity_id = ? LIMIT 1`, [id, user.entityId]);
  if (!row || !(await canRead(user, row))) throw notFound('Permintaan GA');
  const [items] = await pool.query(
    'SELECT id, item_name, qty, unit FROM ga_request_items WHERE request_id = ? ORDER BY sort_order, id',
    [row.id],
  );
  const [attachments] = await pool.query(
    `SELECT a.id, a.name, a.mime_type, a.size, a.web_view_link, a.created_at, u.name AS uploaded_by_name
       FROM ga_request_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE a.request_id = ? ORDER BY a.id`,
    [row.id],
  );
  const logs = await shared.history(user.entityId, rules.SUBJECT_REQUEST, row.id);
  const mine = Number(row.requester_user_id) === Number(user.sub);
  const processor = shared.canProcess(user);
  const canDecide = row.status === 'pending_approval' && await shared.userCanDecide(pool, {
    approvalRequestId: row.approval_request_id, user, requesterUserId: row.requester_user_id, createdBy: row.created_by,
  });
  const open = ['pending_approval', 'open', 'in_progress'].includes(row.status);
  return requestDto(row, {
    items: items.map((i) => ({ id: Number(i.id), itemName: i.item_name, qty: Number(i.qty), unit: i.unit })),
    attachments: attachments.map((a) => ({
      id: Number(a.id), name: a.name, mimeType: a.mime_type, size: Number(a.size), webViewLink: a.web_view_link,
      uploadedByName: a.uploaded_by_name || null, createdAt: toApiTime(a.created_at),
    })),
    history: logs.map((l) => ({ id: Number(l.id), action: l.action, userName: l.user_name || null, at: toApiTime(l.created_at), metadata: parseJson(l.metadata) })),
    can: {
      cancel: mine && rules.CANCELLABLE_REQUEST.includes(row.status),
      process: processor && rules.OPEN_REQUEST.includes(row.status),
      start: processor && row.status === 'open',
      finish: processor && row.status === 'in_progress',
      reject: processor && rules.OPEN_REQUEST.includes(row.status),
      assign: processor && rules.OPEN_REQUEST.includes(row.status),
      attach: (mine || processor) && open && attachments.length < rules.MAX_ATTACHMENTS,
      decide: Boolean(canDecide),
    },
  });
}

const parseJson = (value) => {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
};

async function list(user, query = {}) {
  const scope = query.scope === 'all' ? 'all' : 'mine';
  if (scope === 'all' && !shared.canProcess(user)) throw forbidden('Hanya People & Culture yang melihat semua permintaan');
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || PAGE_SIZE));
  const where = ['r.entity_id = ?'];
  const args = [user.entityId];
  if (scope === 'mine') { where.push('r.requester_user_id = ?'); args.push(user.sub); }
  if (rules.REQUEST_TYPES.includes(query.type)) { where.push('r.request_type = ?'); args.push(query.type); }
  if (Number(query.locationId) > 0) { where.push('r.location_id = ?'); args.push(Number(query.locationId)); }
  const q = String(query.q || '').trim();
  if (q) {
    where.push('(r.request_number LIKE ? OR r.title LIKE ? OR ru.name LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const base = where.join(' AND ');
  const statusWhere = [];
  const statusArgs = [];
  if (query.status === 'overdue') statusWhere.push(OVERDUE_SQL);
  else if (rules.REQUEST_STATUSES.includes(query.status)) { statusWhere.push('r.status = ?'); statusArgs.push(query.status); }
  const full = [base, ...statusWhere].join(' AND ');

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM ga_requests r LEFT JOIN users ru ON ru.id = r.requester_user_id WHERE ${full}`,
    [...args, ...statusArgs],
  );
  const [rows] = await pool.query(
    `${REQUEST_SELECT} WHERE ${full}
      ORDER BY FIELD(r.status, 'pending_approval', 'open', 'in_progress') = 0, r.due_at IS NULL, r.due_at ASC, r.id DESC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    [...args, ...statusArgs],
  );
  const [counts] = await pool.query(
    `SELECT r.status, COUNT(*) AS n, SUM(${OVERDUE_SQL}) AS late
       FROM ga_requests r LEFT JOIN users ru ON ru.id = r.requester_user_id
      WHERE ${base} GROUP BY r.status`,
    args,
  );
  const statusCounts = Object.fromEntries(rules.REQUEST_STATUSES.map((s) => [s, 0]));
  let overdue = 0;
  for (const c of counts) { statusCounts[c.status] = Number(c.n); overdue += Number(c.late || 0); }
  return {
    rows: rows.map((row) => requestDto(row)),
    meta: { page, limit, total: Number(total), scope, statusCounts, overdue },
  };
}

// ------------------------------------------------------------------ requester

async function cancel(user, id, { reason, version }) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new GaError('VALIDATION_ERROR', 'Tulis alasan pembatalan');
  await shared.transaction(async (conn) => {
    const row = await lockRequest(conn, user.entityId, id);
    if (!row) throw notFound('Permintaan GA');
    if (Number(row.requester_user_id) !== Number(user.sub)) {
      if (await canRead(user, row)) throw forbidden('Hanya pengaju yang bisa membatalkan permintaan ini');
      throw notFound('Permintaan GA');
    }
    if (!rules.CANCELLABLE_REQUEST.includes(row.status)) {
      throw new GaError('INVALID_STATUS', 'Permintaan yang sudah diproses tidak bisa dibatalkan', 409);
    }
    if (Number(version) !== Number(row.version)) throw versionConflict();
    if (row.status === 'pending_approval') {
      await shared.withdrawApproval(conn, row.approval_request_id, user.sub, `Dibatalkan pengaju: ${cleanReason}`);
    }
    await bumpVersion(conn, row.id, row.version, {
      status: 'cancelled', cancel_reason: cleanReason.slice(0, 255), cancelled_by: user.sub, cancelled_at: new Date(), updated_by: user.sub,
    });
    await shared.log(conn, {
      entityId: user.entityId, userId: user.sub, action: 'ga.request.cancel', subjectType: rules.SUBJECT_REQUEST, subjectId: row.id,
      metadata: { from: row.status, reason: cleanReason.slice(0, 255) },
    });
  });
  return get(user, id);
}

// ------------------------------------------------------------------ GA

async function setStatus(user, id, { status, note, version }) {
  if (!shared.canProcess(user)) throw forbidden();
  const cleanNote = String(note || '').trim();
  if (status === 'done' && !cleanNote) throw new GaError('VALIDATION_ERROR', 'Tulis catatan penyelesaian');
  if (status === 'rejected' && !cleanNote) throw new GaError('VALIDATION_ERROR', 'Tulis alasan penolakan');
  const outcome = await shared.transaction(async (conn) => {
    const row = await lockRequest(conn, user.entityId, id);
    if (!row) throw notFound('Permintaan GA');
    if (!rules.canProcessTransition(row.status, status)) {
      throw new GaError('INVALID_STATUS', status === 'done' && row.status === 'open'
        ? 'Tandai diproses dulu sebelum diselesaikan'
        : 'Status permintaan tidak bisa diubah ke status itu', 409);
    }
    if (Number(version) !== Number(row.version)) throw versionConflict();
    const now = new Date();
    const patch = { status, updated_by: user.sub };
    if (status === 'in_progress') {
      patch.started_at = now;
      if (!row.assigned_to) patch.assigned_to = user.sub;
    }
    if (status === 'done') Object.assign(patch, { done_at: now, done_by: user.sub, resolution_note: cleanNote.slice(0, 500) });
    if (status === 'rejected') Object.assign(patch, { rejected_reason: cleanNote.slice(0, 255), rejected_by: user.sub, rejected_at: now });
    await bumpVersion(conn, row.id, row.version, patch);
    await shared.log(conn, {
      entityId: user.entityId, userId: user.sub, action: `ga.request.${status}`, subjectType: rules.SUBJECT_REQUEST, subjectId: row.id,
      metadata: { from: row.status, note: cleanNote ? cleanNote.slice(0, 255) : null },
    });
    return row;
  });
  const label = { in_progress: 'sedang diproses', done: 'selesai', rejected: 'ditolak' }[status];
  if (Number(outcome.requester_user_id) !== Number(user.sub)) {
    await shared.notifyUsers([outcome.requester_user_id], {
      entityId: user.entityId, title: `Permintaan GA ${label}`, body: `${outcome.request_number} · ${outcome.title}${cleanNote ? ` — ${cleanNote.slice(0, 200)}` : ''}`,
      event: 'ga.request_status', subjectType: rules.SUBJECT_REQUEST, subjectId: outcome.id, actionUrl: `/ga/requests/${outcome.id}`,
    });
  }
  return get(user, id);
}

async function assign(user, id, { userId }) {
  if (!shared.canProcess(user)) throw forbidden();
  await shared.transaction(async (conn) => {
    const row = await lockRequest(conn, user.entityId, id);
    if (!row) throw notFound('Permintaan GA');
    if (!rules.OPEN_REQUEST.includes(row.status)) throw new GaError('INVALID_STATUS', 'Hanya permintaan yang masih berjalan yang bisa ditugaskan', 409);
    const [[assignee]] = await conn.query(
      `SELECT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL AND r.entity_id = u.entity_id
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id AND p.code = 'ga.request.process'
        WHERE u.id = ? AND u.entity_id = ? AND u.status = 'active' AND u.deleted_at IS NULL LIMIT 1`,
      [userId, user.entityId],
    );
    if (!assignee) throw new GaError('ASSIGNEE_INVALID', 'Penanggung jawab harus akun aktif yang memproses permintaan GA');
    await bumpVersion(conn, row.id, row.version, { assigned_to: userId, updated_by: user.sub });
    await shared.log(conn, {
      entityId: user.entityId, userId: user.sub, action: 'ga.request.assign', subjectType: rules.SUBJECT_REQUEST, subjectId: row.id,
      metadata: { from: row.assigned_to ? Number(row.assigned_to) : null, to: Number(userId) },
    });
  });
  if (Number(userId) !== Number(user.sub)) {
    const [[row]] = await pool.query('SELECT request_number, title FROM ga_requests WHERE id = ?', [id]);
    await shared.notifyUsers([userId], {
      entityId: user.entityId, title: 'Permintaan GA untuk Anda', body: `${row.request_number} · ${row.title}`,
      event: 'ga.request_assigned', subjectType: rules.SUBJECT_REQUEST, subjectId: Number(id), actionUrl: `/ga/requests/${id}`,
    });
  }
  return get(user, id);
}

/** Photos / PDF of the request (Shared Drive only — rule 1.0), max 3, ≤ 10 MB. */
function checkAttachment(file) {
  if (!file) throw new GaError('VALIDATION_ERROR', 'Pilih file foto atau PDF');
  if (!rules.ATTACHMENT_TYPES.includes(file.mimetype)) throw new GaError('FILE_TYPE_NOT_ALLOWED', 'Lampiran hanya foto (PNG, JPG, WebP) atau PDF');
  if (Number(file.size) > rules.MAX_ATTACHMENT_BYTES) throw new GaError('FILE_TOO_LARGE', 'Ukuran lampiran paling besar 10 MB');
}

async function addAttachment(user, id, file, { upload = drive.uploadFile } = {}) {
  checkAttachment(file);
  // Checked before the upload so nothing is sent to Drive for a refused request…
  const [[row]] = await pool.query('SELECT * FROM ga_requests WHERE id = ? AND entity_id = ? LIMIT 1', [id, user.entityId]);
  const mine = row && Number(row.requester_user_id) === Number(user.sub);
  if (!row || !(mine || shared.canProcess(user))) {
    if (row && await canRead(user, row)) throw forbidden('Hanya pengaju atau People & Culture yang bisa melampirkan file');
    throw notFound('Permintaan GA');
  }
  if (!['pending_approval', 'open', 'in_progress'].includes(row.status)) {
    throw new GaError('INVALID_STATUS', 'Lampiran hanya untuk permintaan yang masih berjalan', 409);
  }
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM ga_request_attachments WHERE request_id = ?', [row.id]);
  if (Number(n) >= rules.MAX_ATTACHMENTS) throw new GaError('ATTACHMENT_LIMIT', `Paling banyak ${rules.MAX_ATTACHMENTS} lampiran per permintaan`, 409);

  const uploaded = await upload(
    { name: file.originalname, mimeType: file.mimetype, buffer: file.buffer },
    { entityId: user.entityId, userId: user.sub, subjectType: rules.SUBJECT_REQUEST, subjectId: Number(row.id) },
  );
  // …and re-checked under the row lock, so two parallel uploads never make 4.
  await shared.transaction(async (conn) => {
    const locked = await lockRequest(conn, user.entityId, row.id);
    const [[{ count }]] = await conn.query('SELECT COUNT(*) AS count FROM ga_request_attachments WHERE request_id = ?', [row.id]);
    if (!locked || Number(count) >= rules.MAX_ATTACHMENTS) {
      throw new GaError('ATTACHMENT_LIMIT', `Paling banyak ${rules.MAX_ATTACHMENTS} lampiran per permintaan`, 409);
    }
    await conn.query(
      `INSERT INTO ga_request_attachments (request_id, drive_file_id, web_view_link, name, mime_type, size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.id, uploaded.id, uploaded.webViewLink || null, String(uploaded.name || file.originalname).slice(0, 255),
        uploaded.mimeType || file.mimetype, Number(uploaded.size || file.size), user.sub],
    );
    await shared.log(conn, {
      entityId: user.entityId, userId: user.sub, action: 'ga.request.attachment', subjectType: rules.SUBJECT_REQUEST, subjectId: row.id,
      metadata: { name: String(file.originalname).slice(0, 120) },
    });
  });
  return get(user, id);
}

// ------------------------------------------------------------------ approval hooks
// (registered in approvalSubjectLifecycle.service.js for subject ga_request)

async function lockForDecision(approval, conn) {
  const row = await lockRequest(conn, approval.entity_id, approval.subject_id);
  if (!row) throw notFound('Permintaan GA');
  if (row.status !== 'pending_approval' || Number(row.approval_request_id) !== Number(approval.id)) {
    throw new GaError('STALE_APPROVAL', 'Approval ini bukan approval aktif permintaan tersebut', 409);
  }
  return row;
}

async function assertCanDecide({ approval, user, action, note, conn }) {
  const row = await lockForDecision(approval, conn);
  const denial = await shared.decisionDenial(conn, { approval, user, requesterUserId: row.requester_user_id, createdBy: row.created_by });
  if (denial) {
    // Outside the decision's transaction (which rolls back on this error), so the denial stays logged.
    await logOutside({
      entityId: approval.entity_id, userId: user.sub, action: 'ga.request.decision_denied', subjectType: rules.SUBJECT_REQUEST,
      subjectId: row.id, metadata: { approvalRequestId: approval.id, action, code: denial.code },
    });
    throw denial;
  }
  if (action === 'request_revision') {
    throw new GaError('REVISION_NOT_SUPPORTED', 'Tolak dengan catatan; pengaju bisa mengajukan ulang', 409);
  }
  if (action !== 'approve' && action !== 'reject') throw new GaError('VALIDATION_ERROR', 'Permintaan GA hanya bisa disetujui atau ditolak');
  if (action === 'reject' && !String(note || '').trim()) throw new GaError('VALIDATION_ERROR', 'Tulis alasan penolakan');
}

async function canUserDecide({ approval, user, conn }) {
  const [[row]] = await conn.query('SELECT status, approval_request_id, requester_user_id, created_by FROM ga_requests WHERE id = ? AND entity_id = ? LIMIT 1', [approval.subject_id, approval.entity_id]);
  if (!row || row.status !== 'pending_approval' || Number(row.approval_request_id) !== Number(approval.id)) return false;
  return !(await shared.decisionDenial(conn, { approval, user, requesterUserId: row.requester_user_id, createdBy: row.created_by }));
}

async function applyApprovalDecision({ approval, result, actorUserId, note = null, conn }) {
  if (result?.status !== 'approved' && result?.status !== 'rejected') return { changed: false };
  const row = await lockForDecision(approval, conn);
  const now = new Date();
  if (result.status === 'approved') {
    // The clock starts at approval; the target is stored now (D12).
    const slaDays = rules.slaDaysFor(row.request_type, row.urgency);
    await bumpVersion(conn, row.id, row.version, {
      status: 'open', sla_days: slaDays, clock_started_at: now, due_at: rules.dueAtFrom(now, slaDays), updated_by: actorUserId,
    });
  } else {
    await bumpVersion(conn, row.id, row.version, {
      status: 'rejected', rejected_reason: String(note || 'Ditolak penyetuju').trim().slice(0, 255), rejected_by: actorUserId, rejected_at: now, updated_by: actorUserId,
    });
  }
  await shared.log(conn, {
    entityId: row.entity_id, userId: actorUserId, action: result.status === 'approved' ? 'ga.request.approved' : 'ga.request.rejected_by_approver',
    subjectType: rules.SUBJECT_REQUEST, subjectId: row.id, metadata: { approvalRequestId: approval.id, note: note ? String(note).slice(0, 255) : null },
  });
  return {
    changed: true, kind: 'request', status: result.status, id: Number(row.id), entityId: Number(row.entity_id),
    requesterUserId: Number(row.requester_user_id), number: row.request_number, title: row.title,
  };
}

async function afterDecision(outcome) {
  if (!outcome?.changed) return;
  await shared.notifyUsers([outcome.requesterUserId], {
    entityId: outcome.entityId,
    title: outcome.status === 'approved' ? 'Permintaan GA disetujui' : 'Permintaan GA ditolak',
    body: `${outcome.number} · ${outcome.title}`,
    event: 'ga.request_status', subjectType: rules.SUBJECT_REQUEST, subjectId: outcome.id, actionUrl: `/ga/requests/${outcome.id}`,
  });
  if (outcome.status === 'approved') {
    const { userIds } = await shared.gaRecipients(outcome.entityId);
    await shared.notifyUsers(userIds.filter((id) => id !== outcome.requesterUserId), {
      entityId: outcome.entityId, title: 'Permintaan GA baru', body: `${outcome.number} · ${outcome.title}`,
      event: 'ga.request_new', subjectType: rules.SUBJECT_REQUEST, subjectId: outcome.id, actionUrl: `/ga/requests/${outcome.id}`,
    });
  }
}

/** Accounts that process GA requests (the "Tugaskan ke…" picker). */
async function processors(user) {
  if (!shared.canProcess(user)) throw forbidden();
  const [rows] = await pool.query(
    `SELECT DISTINCT u.id, u.name FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL AND r.entity_id = u.entity_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id AND p.code = 'ga.request.process'
      WHERE u.entity_id = ? AND u.status = 'active' AND u.deleted_at IS NULL
      ORDER BY u.name LIMIT 200`,
    [user.entityId],
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}

module.exports = {
  processors,
  create,
  get,
  list,
  cancel,
  setStatus,
  assign,
  addAttachment,
  checkAttachment,
  assertCanDecide,
  canUserDecide,
  applyApprovalDecision,
  afterDecision,
  requestDto,
};
