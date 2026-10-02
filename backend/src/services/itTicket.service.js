const pool = require('../db/pool');
const notif = require('./notification.service');
const { log: activityLog } = require('./activityLog.service');

const CATEGORIES = Object.freeze(['device_damage', 'new_device_request', 'access_software', 'network']);
const PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent']);
const TERMINAL_STATUSES = Object.freeze(['closed', 'cancelled']);

// Who can move a ticket from which status to which: IT (it_ticket.manage) drives the
// working lifecycle; a requester may only withdraw their own ticket before IT starts on it.
const IT_TRANSITIONS = Object.freeze({
  open: Object.freeze(['in_progress', 'cancelled']),
  in_progress: Object.freeze(['waiting_on_user', 'resolved', 'cancelled']),
  waiting_on_user: Object.freeze(['in_progress', 'resolved', 'cancelled']),
  resolved: Object.freeze(['closed', 'in_progress']),
});
const REQUESTER_TRANSITIONS = Object.freeze({
  open: Object.freeze(['cancelled']),
});

function allowedNextStatuses(status, actor) {
  if (TERMINAL_STATUSES.includes(status)) return [];
  return (actor === 'it' ? IT_TRANSITIONS : REQUESTER_TRANSITIONS)[status] || [];
}

function canTransition(status, nextStatus, actor) {
  return allowedNextStatuses(status, actor).includes(nextStatus);
}

function validationError(message, code = 'VALIDATION_ERROR') {
  return Object.assign(new Error(message), { status: 400, code });
}
function forbiddenError(message) {
  return Object.assign(new Error(message), { status: 403, code: 'FORBIDDEN' });
}
function notFoundError() {
  return Object.assign(new Error('Tiket tidak ditemukan'), { status: 404, code: 'NOT_FOUND' });
}

async function itAdminUserIds(entityId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE p.code = 'it_ticket.manage'
        AND u.entity_id = ? AND r.entity_id = ?
        AND u.status = 'active' AND u.deleted_at IS NULL AND r.deleted_at IS NULL`,
    [entityId, entityId]
  );
  return rows.map((row) => row.id);
}

async function notifyMany(userIds, { excludeUserId = null, ...payload }) {
  const targets = userIds.filter((id) => Number(id) !== Number(excludeUserId));
  for (const userId of targets) {
    try {
      await notif.create({ userId, ...payload });
    } catch {
      // Notification failure must not invalidate the committed ticket state.
    }
  }
}

function ticketActionUrl(id) {
  return `/it/tickets/${id}`;
}

async function createTicket({ entityId, departmentId, category, title, description, priority, deviceId, requesterId, sourcePage = null }) {
  if (!CATEGORIES.includes(category)) throw validationError(`Kategori ${category} tidak dikenal`);
  const safePriority = PRIORITIES.includes(priority) ? priority : 'normal';
  const safeTitle = String(title || '').trim();
  const safeDescription = String(description || '').trim();
  if (!safeTitle) throw validationError('Judul tiket wajib diisi');
  if (!safeDescription) throw validationError('Deskripsi tiket wajib diisi');

  if (deviceId) {
    const [[device]] = await pool.query(
      'SELECT id FROM devices WHERE id=? AND current_assignee_id=? AND deleted_at IS NULL',
      [deviceId, requesterId]
    );
    if (!device) throw validationError('Perangkat tidak ditemukan atau bukan milik Anda', 'DEVICE_NOT_OWNED');
  }

  const [result] = await pool.query(
    `INSERT INTO it_tickets
       (entity_id, department_id, category, title, description, priority, device_id, requester_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [entityId, departmentId || null, category, safeTitle, safeDescription, safePriority, deviceId || null, requesterId]
  );
  const id = result.insertId;

  await activityLog({
    entityId, userId: requesterId, action: 'it_ticket.create',
    subjectType: 'it_ticket', subjectId: id, metadata: { category, priority: safePriority },
  });

  const itUsers = await itAdminUserIds(entityId);
  await notifyMany(itUsers, {
    entityId, title: 'Tiket IT baru', body: safeTitle, event: 'it_ticket.created',
    subjectType: 'it_ticket', subjectId: id, actionUrl: ticketActionUrl(id),
  });
  await notif.create({
    userId: requesterId, entityId, title: 'Tiket Anda telah diterima', body: safeTitle,
    event: 'it_ticket.created', subjectType: 'it_ticket', subjectId: id, actionUrl: ticketActionUrl(id),
  }).catch(() => {});

  // A copy to the IT support mailbox (setting it.support); never blocks the ticket.
  const page = typeof sourcePage === 'string' && sourcePage.startsWith('/') ? sourcePage.slice(0, 200) : null;
  const mail = await require('./itSupport.service')
    .notifySupport({ entityId, ticketId: id, requesterId, category, priority: safePriority, title: safeTitle, description: safeDescription, sourcePage: page })
    .catch(() => ({ emailed: false, reason: 'send_failed' }));

  // The issue in the IT project of Project Tracker, announced in its Space.
  const issue = await require('./itTracker.service')
    .linkNewTicket({ ticketId: id, entityId, title: safeTitle, description: safeDescription, priority: safePriority, requesterId, sourcePage: page })
    .catch(() => null);

  return { id, emailed: mail.emailed, supportEmail: mail.to || null, trackerIssueKey: issue?.key || null };
}

async function listTickets({ entityId, requesterId, canManage, status, category, priority, q, page = 1, limit = 20 }) {
  const where = ['t.entity_id = ?'];
  const args = [entityId];
  if (!canManage) { where.push('t.requester_id = ?'); args.push(requesterId); }
  if (status) { where.push('t.status = ?'); args.push(status); }
  if (category) { where.push('t.category = ?'); args.push(category); }
  if (priority) { where.push('t.priority = ?'); args.push(priority); }
  if (q) { where.push('(t.title LIKE ? OR t.description LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }

  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const safePage = Math.max(1, Number(page) || 1);
  const offset = (safePage - 1) * safeLimit;

  const [rows] = await pool.query(
    `SELECT t.id, t.category, t.title, t.priority, t.status,
            t.device_id AS deviceId, d.asset_code AS deviceAssetCode,
            t.requester_id AS requesterId, u.name AS requesterName,
            t.created_at AS createdAt, t.updated_at AS updatedAt
       FROM it_tickets t
       JOIN users u ON u.id = t.requester_id
       LEFT JOIN devices d ON d.id = t.device_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?`,
    [...args, safeLimit, offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM it_tickets t WHERE ${where.join(' AND ')}`, args
  );
  return { rows, page: safePage, limit: safeLimit, total: Number(total) };
}

async function assertTicketAccess(ticket, { userId, canManage }) {
  if (canManage) return;
  if (Number(ticket.requester_id) !== Number(userId)) throw forbiddenError('Tiket ini bukan milik Anda');
}

async function getTicket(id, { userId, canManage }) {
  const [[ticket]] = await pool.query(
    `SELECT t.*, u.name AS requesterName, u.email AS requesterEmail,
            d.asset_code AS deviceAssetCode, d.device_type AS deviceType, d.brand AS deviceBrand, d.model AS deviceModel
       FROM it_tickets t
       JOIN users u ON u.id = t.requester_id
       LEFT JOIN devices d ON d.id = t.device_id
      WHERE t.id=?`,
    [id]
  );
  if (!ticket) throw notFoundError();
  await assertTicketAccess(ticket, { userId, canManage });

  const [comments] = await pool.query(
    `SELECT c.id, c.body, c.created_at AS createdAt,
            c.author_id AS authorId, u.name AS authorName
       FROM it_ticket_comments c
       JOIN users u ON u.id = c.author_id
      WHERE c.ticket_id=?
      ORDER BY c.id ASC`,
    [id]
  );
  const [attachments] = await pool.query(
    `SELECT id, drive_file_id AS driveFileId, web_view_link AS webViewLink,
            name, mime_type AS mimeType, size, uploaded_by AS uploadedBy, created_at AS createdAt
       FROM it_ticket_attachments
      WHERE ticket_id=?
      ORDER BY id ASC`,
    [id]
  );

  // The linked Project Tracker issue (shown on the ticket page).
  const trackerIssue = await require('./itTracker.service').trackerIssueOf(ticket.tracker_issue_id).catch(() => null);
  return { ...ticket, comments, attachments, trackerIssue };
}

async function updateStatus(id, { status: nextStatus, actorId, canManage, fromTracker = false }) {
  const [[ticket]] = await pool.query('SELECT * FROM it_tickets WHERE id=?', [id]);
  if (!ticket) throw notFoundError();
  await assertTicketAccess(ticket, { userId: actorId, canManage });

  const actor = canManage ? 'it' : 'requester';
  if (!canTransition(ticket.status, nextStatus, actor)) {
    throw validationError(`Tidak bisa mengubah status dari ${ticket.status} ke ${nextStatus}`, 'INVALID_TRANSITION');
  }

  const fields = ['status = ?'];
  const args = [nextStatus];
  if (nextStatus === 'resolved') { fields.push('resolved_at = NOW()', 'resolved_by = ?'); args.push(actorId); }
  if (nextStatus === 'closed') { fields.push('closed_at = NOW()', 'closed_by = ?'); args.push(actorId); }
  if (nextStatus === 'cancelled') { fields.push('cancelled_at = NOW()', 'cancelled_by = ?'); args.push(actorId); }
  // Reopening (resolved -> in_progress) clears the earlier resolution marker.
  if (ticket.status === 'resolved' && nextStatus === 'in_progress') { fields.push('resolved_at = NULL', 'resolved_by = NULL'); }
  args.push(id);

  await pool.query(`UPDATE it_tickets SET ${fields.join(', ')} WHERE id=?`, args);
  await activityLog({
    entityId: ticket.entity_id, userId: actorId, action: 'it_ticket.status_change',
    subjectType: 'it_ticket', subjectId: Number(id), metadata: { from: ticket.status, to: nextStatus, ...(fromTracker ? { source: 'project_tracker' } : {}) },
  });
  // Keep the linked Project Tracker issue in step (not when the move came from it).
  if (!fromTracker) {
    await require('./itTracker.service').onTicketStatus(Number(id), nextStatus, actorId).catch(() => false);
  }

  const STATUS_LABELS = {
    open: 'Open', in_progress: 'Sedang Dikerjakan', waiting_on_user: 'Menunggu Respon Anda',
    resolved: 'Selesai', closed: 'Ditutup', cancelled: 'Dibatalkan',
  };
  if (actor === 'it') {
    await notif.create({
      userId: ticket.requester_id, entityId: ticket.entity_id,
      title: `Tiket Anda: ${STATUS_LABELS[nextStatus]}`, body: ticket.title,
      event: 'it_ticket.status_changed', subjectType: 'it_ticket', subjectId: Number(id), actionUrl: ticketActionUrl(id),
    }).catch(() => {});
  } else {
    const itUsers = await itAdminUserIds(ticket.entity_id);
    await notifyMany(itUsers, {
      entityId: ticket.entity_id, title: `Tiket dibatalkan oleh pengaju`, body: ticket.title,
      event: 'it_ticket.status_changed', subjectType: 'it_ticket', subjectId: Number(id), actionUrl: ticketActionUrl(id),
    });
  }

  return { id: Number(id), status: nextStatus };
}

async function addComment(id, { authorId, body, canManage }) {
  const safeBody = String(body || '').trim();
  if (!safeBody) throw validationError('Komentar tidak boleh kosong');

  const [[ticket]] = await pool.query('SELECT * FROM it_tickets WHERE id=?', [id]);
  if (!ticket) throw notFoundError();
  await assertTicketAccess(ticket, { userId: authorId, canManage });

  const [result] = await pool.query(
    'INSERT INTO it_ticket_comments (ticket_id, author_id, body) VALUES (?, ?, ?)',
    [id, authorId, safeBody]
  );

  if (canManage) {
    await notif.create({
      userId: ticket.requester_id, entityId: ticket.entity_id, title: 'Tanggapan baru di tiket Anda', body: safeBody,
      event: 'it_ticket.commented', subjectType: 'it_ticket', subjectId: Number(id), actionUrl: ticketActionUrl(id),
    }).catch(() => {});
  } else {
    const itUsers = await itAdminUserIds(ticket.entity_id);
    await notifyMany(itUsers, {
      entityId: ticket.entity_id, title: 'Balasan baru dari pengaju', body: safeBody,
      event: 'it_ticket.commented', subjectType: 'it_ticket', subjectId: Number(id), actionUrl: ticketActionUrl(id),
    });
  }

  return { id: result.insertId };
}

module.exports = {
  CATEGORIES,
  PRIORITIES,
  TERMINAL_STATUSES,
  allowedNextStatuses,
  canTransition,
  itAdminUserIds,
  createTicket,
  listTickets,
  getTicket,
  updateStatus,
  addComment,
  assertTicketAccess,
};
