const pool = require('../db/pool');
const engine = require('./approvalEngine.service');
const lifecycle = require('./approvalSubjectLifecycle.service');
const { PAGES } = require('./approvalLink');

// Read-only views of approvals for one user (Prakasa AI, tools/approvals.js).
// Nothing here decides, creates or changes a request. Every query is bound to
// the user's entity and to engine.approvalVisibilitySql — the rule of the
// approvals list, detail and global search — and "can I decide this" is asked
// of the same functions the decision itself uses (engine.canDecide plus the
// owning module's lifecycle.canUserDecide), so the answer never differs from
// what the module page allows.

const CANDIDATE_PAGE = 100;
const MAX_CANDIDATES = 2000;

async function roleIdsOf(userId, entityId) {
  const [rows] = await pool.query(
    `SELECT ur.role_id AS roleId
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND r.entity_id = ? AND r.deleted_at IS NULL`,
    [userId, entityId]
  );
  return rows.map((row) => Number(row.roleId));
}

// The page where this request is decided or followed (the generic /approvals
// page is closed — navigation.js BLOCKED_ROUTES): null when it has none.
function pageOf({ subjectType, subjectId }) {
  const page = PAGES[subjectType];
  return page && subjectId != null ? page(subjectId) : null;
}

// How the step reaches this user: escalation, delegation, by name, or by role.
function reachedVia(step, userId, roleIds) {
  if (step.approver_user_id && Number(step.approver_user_id) === Number(userId)) return step.delegated_from_user_id ? 'delegation' : 'user';
  if (step.approver_role_id && roleIds.includes(Number(step.approver_role_id))) return 'role';
  if (step.escalated_to_user_id && Number(step.escalated_to_user_id) === Number(userId)) return 'escalation';
  if (step.escalated_to_role_id && roleIds.includes(Number(step.escalated_to_role_id))) return 'escalation';
  return 'role';
}

/**
 * Pending requests with an active step this user can decide right now, oldest
 * first. Deciding needs approval.decide (the decide route's permission).
 * Returns { items, total, scanned, complete }.
 */
async function pendingForUser(user, { limit = 25 } = {}) {
  const permissions = user.permissions || [];
  if (!permissions.includes('approval.decide') || !user.entityId) {
    return { items: [], total: 0, complete: true };
  }
  const roles = await roleIdsOf(user.sub, user.entityId);
  const visible = engine.approvalVisibilitySql(user, 'a');
  const items = [];
  let total = 0;
  let offset = 0;
  let page = [];

  do {
    [page] = await pool.query(
      `SELECT a.id, a.entity_id, a.department_id, d.name AS department_name,
              a.subject_type, a.subject_id, a.request_type, a.document_type_id,
              a.title, a.status, a.requested_by, u.name AS requester_name, a.created_at
         FROM approval_requests a
         LEFT JOIN users u ON u.id = a.requested_by
         LEFT JOIN departments d ON d.id = a.department_id
        WHERE a.entity_id = ? AND a.status = 'pending' AND ${visible.sql}
        ORDER BY a.created_at ASC, a.id ASC
        LIMIT ? OFFSET ?`,
      [user.entityId, ...visible.args, CANDIDATE_PAGE, offset]
    );

    for (const request of page) {
      const steps = await engine.getActiveSteps(request.id);
      let mine = null;
      for (const step of steps) {
        if (await engine.canDecide({
          step,
          userId: user.sub,
          userRoleIds: roles,
          userPermissions: permissions,
          entityId: request.entity_id,
          requestType: request.request_type,
          documentTypeId: request.document_type_id,
          approval: request,
          userDepartmentId: user.departmentId,
        })) { mine = step; break; }
      }
      if (!mine) continue;
      // Module rules (e.g. Warehouse separation of duties) apply on top of the step.
      if (lifecycle.isManagedSubject(request.subject_type)
        && !(await lifecycle.canUserDecide({ approval: request, user, conn: pool }))) continue;

      total += 1;
      if (items.length >= limit) continue;
      items.push({
        id: Number(request.id),
        title: request.title,
        requestType: request.request_type,
        subjectType: request.subject_type,
        subjectId: request.subject_id != null ? Number(request.subject_id) : null,
        departmentName: request.department_name || null,
        requesterName: request.requester_name || null,
        createdAt: request.created_at,
        level: mine.level,
        deadlineAt: mine.deadline_at || null,
        escalatedAt: mine.escalated_at || null,
        via: reachedVia(mine, user.sub, roles),
        page: pageOf({ subjectType: request.subject_type, subjectId: request.subject_id }),
      });
    }
    offset += page.length;
  } while (page.length === CANDIDATE_PAGE && offset < MAX_CANDIDATES);

  return { items, total, complete: page.length < CANDIDATE_PAGE };
}

const STATUSES = ['pending', 'approved', 'rejected', 'revision_requested', 'cancelled'];

/** Requests this user submitted, newest first. Returns { rows, total, counts }. */
async function requestsOf(user, { status = null, limit = 25 } = {}) {
  const where = ['a.entity_id = ?', 'a.requested_by = ?'];
  const args = [user.entityId, user.sub];
  const [countRows] = await pool.query(
    `SELECT a.status, COUNT(*) AS n FROM approval_requests a WHERE ${where.join(' AND ')} GROUP BY a.status`, args
  );
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of countRows) counts[row.status] = Number(row.n);
  const listWhere = STATUSES.includes(status) ? [...where, 'a.status = ?'] : where;
  const listArgs = STATUSES.includes(status) ? [...args, status] : args;
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM approval_requests a WHERE ${listWhere.join(' AND ')}`, listArgs
  );
  const [rows] = await pool.query(
    `SELECT a.id, a.title, a.request_type AS requestType, a.subject_type AS subjectType, a.subject_id AS subjectId,
            a.status, a.current_level AS currentLevel, a.created_at AS createdAt, a.decided_at AS decidedAt,
            (SELECT COUNT(*) FROM approval_steps s WHERE s.approval_request_id = a.id) AS totalSteps,
            (SELECT COUNT(*) FROM approval_steps s WHERE s.approval_request_id = a.id AND s.status = 'approved') AS approvedSteps,
            (SELECT GROUP_CONCAT(DISTINCT COALESCE(au.name, ar.name) SEPARATOR ', ')
               FROM approval_steps s
               LEFT JOIN users au ON au.id = s.approver_user_id
               LEFT JOIN roles ar ON ar.id = s.approver_role_id
              WHERE s.approval_request_id = a.id AND s.status = 'pending' AND s.activated_at IS NOT NULL) AS waitingOn
       FROM approval_requests a
      WHERE ${listWhere.join(' AND ')}
      ORDER BY a.id DESC
      LIMIT ?`,
    [...listArgs, Math.min(100, Math.max(1, Number(limit) || 25))]
  );
  return {
    counts,
    total: Number(total),
    rows: rows.map((row) => ({ ...row, page: pageOf(row) })),
  };
}

/** One request the user may see (approvalVisibilitySql) with its steps, or null. */
async function visibleRequest(user, id) {
  const visible = engine.approvalVisibilitySql(user, 'a');
  const [rows] = await pool.query(
    `SELECT a.id, a.title, a.request_type AS requestType, a.subject_type AS subjectType, a.subject_id AS subjectId,
            a.department_id AS departmentId, d.name AS departmentName,
            a.status, a.current_level AS currentLevel,
            a.requested_by AS requestedBy, u.name AS requesterName,
            decider.name AS decidedByName, a.decided_at AS decidedAt, a.decision_note AS decisionNote,
            a.created_at AS createdAt
       FROM approval_requests a
       LEFT JOIN users u ON u.id = a.requested_by
       LEFT JOIN users decider ON decider.id = a.decided_by
       LEFT JOIN departments d ON d.id = a.department_id
      WHERE a.id = ? AND a.entity_id = ? AND ${visible.sql}
      LIMIT 1`,
    [id, user.entityId, ...visible.args]
  );
  if (!rows[0]) return null;
  const [steps] = await pool.query(
    `SELECT s.level, s.order_index AS orderIndex,
            au.name AS approverUserName, ar.name AS approverRoleName,
            du.name AS delegatedFromUserName,
            eu.name AS escalatedToUserName, er.name AS escalatedToRoleName,
            s.is_optional AS isOptional, s.status,
            s.activated_at AS activatedAt, s.deadline_at AS deadlineAt, s.escalated_at AS escalatedAt,
            decider.name AS decidedByName, s.decided_at AS decidedAt, s.note
       FROM approval_steps s
       LEFT JOIN users au ON au.id = s.approver_user_id
       LEFT JOIN roles ar ON ar.id = s.approver_role_id
       LEFT JOIN users du ON du.id = s.delegated_from_user_id
       LEFT JOIN users eu ON eu.id = s.escalated_to_user_id
       LEFT JOIN roles er ON er.id = s.escalated_to_role_id
       LEFT JOIN users decider ON decider.id = s.decided_by
      WHERE s.approval_request_id = ?
      ORDER BY s.order_index ASC, s.id ASC`,
    [rows[0].id]
  );
  return { ...rows[0], page: pageOf(rows[0]), steps };
}

/**
 * Delegations the user gave or received (never other people's), newest first.
 * `current` keeps only those in force now or starting later.
 */
async function delegationsOf(user, { current = true } = {}) {
  const where = ['d.entity_id = ?', 'd.deleted_at IS NULL', '(d.from_user_id = ? OR d.to_user_id = ?)'];
  const args = [user.entityId, user.sub, user.sub];
  if (current) where.push('d.is_active = 1 AND d.ends_at >= NOW()');
  const [rows] = await pool.query(
    `SELECT d.id, d.from_user_id AS fromUserId, fu.name AS fromUserName,
            d.to_user_id AS toUserId, tu.name AS toUserName,
            d.applies_to_request_type AS requestType, dt.name AS documentTypeName,
            d.starts_at AS startsAt, d.ends_at AS endsAt, d.reason, d.is_active AS isActive,
            (d.is_active = 1 AND d.starts_at <= NOW() AND d.ends_at >= NOW()) AS inForce
       FROM approval_delegations d
       JOIN users fu ON fu.id = d.from_user_id
       JOIN users tu ON tu.id = d.to_user_id
       LEFT JOIN document_types dt ON dt.id = d.applies_to_document_type_id
      WHERE ${where.join(' AND ')}
      ORDER BY d.starts_at DESC, d.id DESC
      LIMIT 100`,
    args
  );
  return rows;
}

module.exports = { pendingForUser, requestsOf, visibleRequest, delegationsOf, pageOf, STATUSES };
