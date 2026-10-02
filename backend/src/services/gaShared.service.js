// Layanan GA — building blocks shared by requests, bookings and resources:
// errors, the transaction helper, who may read what, numbering, approvals
// through the existing engine (with the People & Culture approver resolver),
// and notifications. The entity always comes from the signed-in account.

const pool = require('../db/pool');
const approvalEngine = require('./approvalEngine.service');
const approvalAudit = require('./approvalAudit.service');
const resolver = require('./approverResolver.service');
const notif = require('./notification.service');
const { logWith } = require('./activityLog.service');

class GaError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const notFound = (what = 'Data') => new GaError('NOT_FOUND', `${what} tidak ditemukan`, 404);
const forbidden = (message = 'Anda tidak punya akses untuk tindakan ini') => new GaError('FORBIDDEN', message, 403);
const versionConflict = () => new GaError('VERSION_CONFLICT', 'Data sudah diubah orang lain. Muat ulang lalu coba lagi.', 409);

const has = (user, code) => (user?.permissions || []).includes(code);
const canProcess = (user) => has(user, 'ga.request.process');
const canManageResources = (user) => has(user, 'ga.resource.manage');

// Management read rule (as 2.1): the Management Office reads everything, a
// division Head reads their own division's records (escalation links).
function managementReads(user, departmentId) {
  if (has(user, 'management_dashboard.view')) return true;
  return has(user, 'management_dashboard.division')
    && departmentId != null && user.departmentId != null
    && Number(departmentId) === Number(user.departmentId);
}

/**
 * One transaction on its own connection. The numbering lock (services/nextNumber.js,
 * a session GET_LOCK) is released after commit/rollback, never before.
 */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch { /* the original error matters */ }
    throw error;
  } finally {
    try { await conn.query('SELECT RELEASE_ALL_LOCKS()'); } catch { /* connection may be gone */ }
    conn.release();
  }
}

// MySQL lock wait timeout while another transaction holds a resource row.
function isLockTimeout(error) {
  return error?.code === 'ER_LOCK_WAIT_TIMEOUT' || error?.errno === 1205 || error?.code === 'ER_LOCK_DEADLOCK';
}

/** The signed-in account as stored (division, directory row and its manager). */
async function accountOf(conn, user) {
  const [[row]] = await conn.query(
    `SELECT u.id, u.name, u.department_id, p.id AS person_id, p.manager_id, p.location_id
       FROM users u
       LEFT JOIN people_directory p ON p.entity_id = u.entity_id AND p.user_id = u.id
      WHERE u.id = ? AND u.entity_id = ? AND u.deleted_at IS NULL LIMIT 1`,
    [user.sub, user.entityId],
  );
  if (!row) throw forbidden('Akun tidak ditemukan di perusahaan ini');
  return row;
}

/** An active location of the entity, or 400. */
async function assertLocation(conn, entityId, locationId) {
  const [[row]] = await conn.query(
    'SELECT id, name FROM org_locations WHERE id = ? AND entity_id = ? AND is_active = 1 LIMIT 1',
    [locationId, entityId],
  );
  if (!row) throw new GaError('LOCATION_INVALID', 'Lokasi tidak ditemukan atau sudah nonaktif');
  return row;
}

/**
 * Opens the approval for a GA subject through the existing engine and the
 * seeded matrix rule, then puts the resolved approver (manager → division Head
 * → Management Office Head; never the requester) on step 1. Same transaction.
 */
async function openApproval(conn, { entityId, account, requesterUserId, subjectType, subjectId, requestType, title, description }) {
  const approver = await resolver.resolveApprover(conn, {
    entityId,
    managerPersonId: account.manager_id || null,
    departmentId: account.department_id || null,
    excludeUserIds: [requesterUserId],
  });
  const approval = await approvalEngine.createApprovalRequest({
    entityId,
    departmentId: account.department_id || null,
    subjectType,
    subjectId,
    requestType,
    title,
    description,
    requestedBy: requesterUserId,
  }, conn);
  if (approval.flowType === 'legacy') {
    throw new GaError('APPROVAL_MATRIX_MISSING', 'Aturan approval Layanan GA belum ada, jadi pengajuan belum bisa dikirim.', 409);
  }
  await resolver.assignFirstStep(conn, approval.id, approver);
  await approvalAudit.log({
    entityId, actorUserId: requesterUserId, entityType: 'request', entityIdRef: approval.id, action: 'create',
    after: { subjectType, subjectId, flowType: approval.flowType, approverBasis: approver.basis },
  }, conn);
  return { approvalRequestId: approval.id, basis: approver.basis, approver };
}

/** Takes a pending approval back (cancel / expiry) on the caller's connection. */
async function withdrawApproval(conn, approvalRequestId, actorUserId, note) {
  if (!approvalRequestId) return;
  const [[row]] = await conn.query('SELECT status FROM approval_requests WHERE id = ? LIMIT 1', [approvalRequestId]);
  if (row?.status !== 'pending') return;
  await approvalEngine.withdrawRequest({ approvalRequestId, actorUserId: actorUserId || null, note, conn });
}

// Users who can decide the active step of an approval right now (approver
// user, holders of the approver/escalation role), minus the requester and
// excluded accounts — the people to notify.
async function activeStepUsers(entityId, approvalRequestId, excludeUserIds = []) {
  const [steps] = await pool.query(
    `SELECT approver_user_id, approver_role_id, escalated_to_user_id, escalated_to_role_id
       FROM approval_steps WHERE approval_request_id = ? AND status = 'pending' AND activated_at IS NOT NULL`,
    [approvalRequestId],
  );
  const users = new Set();
  const roles = new Set();
  for (const s of steps) {
    if (s.approver_user_id) users.add(Number(s.approver_user_id));
    if (s.escalated_to_user_id) users.add(Number(s.escalated_to_user_id));
    if (s.approver_role_id) roles.add(Number(s.approver_role_id));
    if (s.escalated_to_role_id) roles.add(Number(s.escalated_to_role_id));
  }
  if (roles.size) {
    const [rows] = await pool.query(
      `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
        WHERE ur.role_id IN (?) AND ${resolver.ELIGIBLE_SQL}`,
      [[...roles], entityId, entityId],
    );
    rows.forEach((r) => users.add(Number(r.id)));
  }
  const skip = new Set(excludeUserIds.map(Number));
  return [...users].filter((id) => !skip.has(id));
}

/**
 * The GA PIC chosen by the People & Culture Head (settings people_culture.pic,
 * §2.1.2) when still an active account holding ga.request.process; otherwise
 * everyone who processes GA requests, so a new request never goes unseen.
 */
async function gaRecipients(entityId, conn = pool) {
  const [[setting]] = await conn.query(
    "SELECT JSON_UNQUOTE(JSON_EXTRACT(value, '$.gaUserId')) AS ga FROM settings WHERE entity_id = ? AND `key` = 'people_culture.pic' LIMIT 1",
    [entityId],
  );
  const processors = `SELECT DISTINCT u.id FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL AND r.entity_id = u.entity_id
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id AND p.code = 'ga.request.process'
     WHERE u.entity_id = ? AND u.status = 'active' AND u.deleted_at IS NULL`;
  const pic = Number(setting?.ga);
  if (Number.isInteger(pic) && pic > 0) {
    const [[ok]] = await conn.query(`${processors} AND u.id = ?`, [entityId, pic]);
    if (ok) return { picUserId: pic, userIds: [pic] };
  }
  const [rows] = await conn.query(processors, [entityId]);
  return { picUserId: null, userIds: rows.map((r) => Number(r.id)) };
}

/** In-app notifications, best effort: a failed notification never undoes a change. */
async function notifyUsers(userIds, payload) {
  for (const userId of [...new Set((userIds || []).map(Number))].filter(Boolean)) {
    try { await notif.create({ ...payload, userId }); } catch { /* best effort */ }
  }
}

async function log(conn, entry) {
  await logWith(conn, entry);
}

/** Activity history of one GA record (newest first). */
async function history(entityId, subjectType, subjectId) {
  const [rows] = await pool.query(
    `SELECT l.id, l.action, l.metadata, l.created_at, u.name AS user_name
       FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.entity_id = ? AND l.subject_type = ? AND l.subject_id = ?
      ORDER BY l.created_at DESC, l.id DESC LIMIT 50`,
    [entityId, subjectType, subjectId],
  );
  return rows;
}

// Separation of duties at the decision (decision 5): the requester (and the
// creator) never decides, and an account excluded in the directory never does.
async function decisionDenial(conn, { approval, user, requesterUserId, createdBy }) {
  const actor = Number(user.sub);
  if (actor === Number(requesterUserId) || (createdBy && actor === Number(createdBy))) {
    return new GaError('SELF_APPROVAL_FORBIDDEN', 'Pengaju tidak bisa menyetujui pengajuannya sendiri', 403);
  }
  if (await resolver.isExcludedAccount(conn, approval.entity_id, actor)) {
    return new GaError('APPROVER_EXCLUDED', 'Akun ini dikecualikan di direktori, jadi tidak bisa memutuskan approval', 403);
  }
  return null;
}

/** Whether `user` can decide the active step of this approval (engine rule + SoD). */
async function userCanDecide(conn, { approvalRequestId, user, requesterUserId, createdBy }) {
  if (!approvalRequestId || !has(user, 'approval.decide')) return false;
  const [[approval]] = await conn.query(
    "SELECT * FROM approval_requests WHERE id = ? AND entity_id = ? AND status = 'pending' LIMIT 1",
    [approvalRequestId, user.entityId],
  );
  if (!approval) return false;
  if (await decisionDenial(conn, { approval, user, requesterUserId, createdBy })) return false;
  const [roles] = await conn.query(
    `SELECT ur.role_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND r.entity_id = ? AND r.deleted_at IS NULL`,
    [user.sub, user.entityId],
  );
  const steps = await approvalEngine.getActiveSteps(approval.id, conn);
  for (const step of steps) {
    if (await approvalEngine.canDecide({
      step, userId: user.sub, userRoleIds: roles.map((r) => Number(r.role_id)), userPermissions: user.permissions || [],
      entityId: approval.entity_id, requestType: approval.request_type, documentTypeId: approval.document_type_id, conn,
    })) return true;
  }
  return false;
}

module.exports = {
  GaError,
  notFound,
  forbidden,
  versionConflict,
  has,
  canProcess,
  canManageResources,
  managementReads,
  transaction,
  isLockTimeout,
  accountOf,
  assertLocation,
  openApproval,
  withdrawApproval,
  activeStepUsers,
  gaRecipients,
  notifyUsers,
  log,
  history,
  decisionDenial,
  userCanDecide,
};
