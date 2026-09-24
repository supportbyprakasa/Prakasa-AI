const pool = require('../db/pool');
const aiAccess = require('./aiSessionAccess.service');
const approvalEngine = require('./approvalEngine.service');
const notificationCenter = require('./notificationCenter.service');
const approvalLifecycle = require('./approvalSubjectLifecycle.service');

// Items waiting for the current user's decision, gathered from existing modules. Each
// source reuses the permission rules that module already enforces on its own endpoints.

const MAX_ITEMS = 30;
const MAX_APPROVAL_CANDIDATES = 100;
const NOTIFICATION_LIMIT = 10;

const ACTION_LABELS = {
  create_task: 'Buat task',
  create_approval: 'Ajukan approval',
  create_document: 'Buat dokumen',
  create_calendar_event: 'Buat jadwal',
  update_task: 'Ubah task',
  send_notification: 'Kirim notifikasi',
};

function parseJson(value) {
  if (!value) return {};
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function proposalTitle(actionType, payload) {
  const candidate = payload.title || payload.summary || payload.name || payload.subject || payload.message;
  return String(candidate || ACTION_LABELS[actionType] || actionType).slice(0, 200);
}

async function pendingProposals(user) {
  if (!aiAccess.hasPerm(user, 'ai_command.action.confirm')) {
    return { items: [], total: 0 };
  }

  const visibility = aiAccess.buildVisibilityFilter(user, 's');
  const crossEntityAdmin = aiAccess.hasPerm(user, 'entity.cross_access')
    && aiAccess.hasPerm(user, 'ai_command.admin.view');
  const entitySql = crossEntityAdmin ? '' : 'AND p.entity_id = ?';
  const args = crossEntityAdmin
    ? visibility.args
    : [...visibility.args, user.entityId];
  const baseSql = `FROM ai_action_proposals p
       JOIN ai_sessions s ON s.id = p.session_id AND s.deleted_at IS NULL
      WHERE p.status = 'proposed'
        AND (p.expires_at IS NULL OR p.expires_at > NOW())
        AND ${visibility.sql}
        ${entitySql}`;

  const [[rows], [[countRow]]] = await Promise.all([
    pool.query(
      `SELECT p.id, p.session_id, p.entity_id AS proposal_entity_id, p.action_type,
            p.payload_json, p.created_at, p.expires_at,
            s.title AS session_title, s.owner_user_id, s.entity_id, s.department_id,
            s.visibility, s.status, s.deleted_at
       ${baseSql}
      ORDER BY p.created_at DESC
      LIMIT ${MAX_ITEMS}`,
      args
    ),
    pool.query(`SELECT COUNT(*) AS total ${baseSql}`, args),
  ]);

  const items = [];
  for (const row of rows) {
    try {
      aiAccess.assertSessionAccess({ user, session: row, action: 'confirm_action' });
    } catch {
      continue;
    }
    items.push({
      id: row.id,
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      actionType: row.action_type,
      actionLabel: ACTION_LABELS[row.action_type] || row.action_type,
      title: proposalTitle(row.action_type, parseJson(row.payload_json)),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return { items, total: Number(countRow.total) || 0 };
}

async function userRoleIds(userId, entityId) {
  const [rows] = await pool.query(
    `SELECT ur.role_id AS roleId
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND r.entity_id = ? AND r.deleted_at IS NULL`,
    [userId, entityId]
  );
  return rows.map((row) => Number(row.roleId));
}

async function pendingApprovals(user) {
  if (!aiAccess.hasPerm(user, 'approval.decide') || !user.entityId) {
    return { items: [], total: 0 };
  }

  const roles = await userRoleIds(user.sub, user.entityId);
  const items = [];
  let total = 0;
  let offset = 0;
  let requests = [];

  // Authorization depends on active approval steps and delegation validity, so it
  // cannot safely be decided by limiting the newest requests first. Scan in bounded
  // database pages, keep only a small preview, and continue for an accurate badge.
  do {
    [requests] = await pool.query(
      `SELECT ar.id, ar.entity_id, ar.department_id, ar.subject_type, ar.subject_id,
              ar.title, ar.request_type, ar.document_type_id,
              ar.amount, ar.currency, ar.created_at, u.name AS requester_name
         FROM approval_requests ar
         LEFT JOIN users u ON u.id = ar.requested_by
        WHERE ar.entity_id = ? AND ar.status = 'pending'
        ORDER BY ar.created_at DESC, ar.id DESC
        LIMIT ? OFFSET ?`,
      [user.entityId, MAX_APPROVAL_CANDIDATES, offset]
    );

    for (const request of requests) {
      const steps = await approvalEngine.getActiveSteps(request.id);
      let canDecide = false;
      for (const step of steps) {
        canDecide = await approvalEngine.canDecide({
          step,
          userId: user.sub,
          userRoleIds: roles,
          userPermissions: user.permissions || [],
          entityId: request.entity_id,
          requestType: request.request_type,
          documentTypeId: request.document_type_id,
        });
        if (canDecide) break;
      }
      if (!canDecide) continue;
      // Module rules such as Warehouse separation of duties apply on top of the step.
      if (approvalLifecycle.isManagedSubject(request.subject_type)
        && !(await approvalLifecycle.canUserDecide({ approval: request, user, conn: pool }))) {
        continue;
      }

      total += 1;
      if (items.length >= MAX_ITEMS) continue;
      items.push({
        id: request.id,
        title: request.title,
        requestType: request.request_type,
        subjectType: request.subject_type,
        subjectId: request.subject_id,
        requesterName: request.requester_name,
        amount: request.amount,
        currency: request.currency,
        createdAt: request.created_at,
      });
    }

    offset += requests.length;
  } while (requests.length === MAX_APPROVAL_CANDIDATES);

  return { items, total };
}

async function unreadNotifications(user) {
  const { rows, meta } = await notificationCenter.listForUser({
    userId: user.sub,
    page: 1,
    limit: NOTIFICATION_LIMIT,
    unread: true,
  });
  return { items: rows, unreadCount: meta.unreadCount };
}

async function getInbox({ user }) {
  const [proposalResult, approvalResult, notifications] = await Promise.all([
    pendingProposals(user),
    pendingApprovals(user),
    unreadNotifications(user),
  ]);
  const proposals = proposalResult.items;
  const approvals = approvalResult.items;
  return {
    proposals,
    approvals,
    notifications: notifications.items,
    counts: {
      proposals: proposalResult.total,
      approvals: approvalResult.total,
      notifications: notifications.unreadCount,
      total: proposalResult.total + approvalResult.total + notifications.unreadCount,
    },
  };
}

module.exports = { getInbox, proposalTitle };
