// Who approves a People & Culture request (docs/rancangan-people-culture-g2.md,
// keputusan 7; shared by onboarding/offboarding and GA services):
//   (a) the direct manager from the directory, when that person has an active
//       app account holding approval.decide and is not the requester/subject;
//   (b) else the subject's division Head role (`<division>.head`), when at least
//       one active account other than the requester/subject holds it;
//   (c) else the Management Office Head role.
// None of them → 409 APPROVER_MISSING: an approval never goes out without
// someone who can decide it. Accounts marked "Dikecualikan" in the directory
// (test or system accounts) never count.

class ApproverError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const ids = (list) => [...new Set((list || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

// An account of the entity that can decide: active, holds approval.decide
// through one of its roles, and is not excluded in the directory. Placeholders:
// entity (users), entity (roles). Alias `u` is the account.
const ELIGIBLE_SQL = `
  u.entity_id = ? AND u.status = 'active' AND u.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL AND r.entity_id = ?
                JOIN role_permissions rp ON rp.role_id = r.id
                JOIN permissions p ON p.id = rp.permission_id AND p.code = 'approval.decide'
               WHERE ur.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM people_directory xp
                   WHERE xp.entity_id = u.entity_id AND xp.user_id = u.id AND xp.kind = 'excluded')`;

/** Whether one account may decide (eligibility only; not the requester/subject rule). */
async function isEligibleUser(conn, entityId, userId) {
  if (!userId) return false;
  const [[row]] = await conn.query(
    `SELECT u.id FROM users u WHERE u.id = ? AND ${ELIGIBLE_SQL} LIMIT 1`,
    [userId, entityId, entityId],
  );
  return Boolean(row);
}

/** Whether a directory row marks this account as excluded (test/system account). */
async function isExcludedAccount(conn, entityId, userId) {
  const [[row]] = await conn.query(
    "SELECT id FROM people_directory WHERE entity_id = ? AND user_id = ? AND kind = 'excluded' LIMIT 1",
    [entityId, userId],
  );
  return Boolean(row);
}

/** The role `roleKey` of the entity when ≥1 eligible account outside `exclude` holds it. */
async function qualifyingRole(conn, entityId, roleKey, exclude) {
  const [[role]] = await conn.query(
    'SELECT id, name FROM roles WHERE entity_id = ? AND role_key = ? AND deleted_at IS NULL LIMIT 1',
    [entityId, roleKey],
  );
  if (!role) return null;
  const [[holder]] = await conn.query(
    `SELECT COUNT(*) AS n FROM users u
       JOIN user_roles ur ON ur.user_id = u.id AND ur.role_id = ?
      WHERE ${ELIGIBLE_SQL}${exclude.length ? ' AND u.id NOT IN (?)' : ''}`,
    exclude.length ? [role.id, entityId, entityId, exclude] : [role.id, entityId, entityId],
  );
  return Number(holder?.n || 0) > 0 ? { id: Number(role.id), name: role.name } : null;
}

/**
 * → { userId, roleId, basis, name } — exactly one of userId / roleId is set.
 * `managerPersonId` is a people_directory id of the entity (or null);
 * `departmentId` the subject's division.
 */
async function resolveApprover(conn, { entityId, managerPersonId = null, departmentId = null, excludeUserIds = [] }) {
  const exclude = ids(excludeUserIds);

  if (managerPersonId) {
    const [[manager]] = await conn.query(
      `SELECT p.user_id, u.name FROM people_directory p
         LEFT JOIN users u ON u.id = p.user_id
        WHERE p.id = ? AND p.entity_id = ? AND p.kind <> 'excluded' AND p.status = 'active' LIMIT 1`,
      [managerPersonId, entityId],
    );
    const userId = manager?.user_id != null ? Number(manager.user_id) : null;
    if (userId && !exclude.includes(userId) && await isEligibleUser(conn, entityId, userId)) {
      return { userId, roleId: null, basis: 'manager', name: manager.name };
    }
  }

  if (departmentId) {
    const [[dept]] = await conn.query(
      'SELECT code FROM departments WHERE id = ? AND entity_id = ? AND deleted_at IS NULL LIMIT 1',
      [departmentId, entityId],
    );
    if (dept?.code) {
      const role = await qualifyingRole(conn, entityId, `${dept.code}.head`, exclude);
      if (role) return { userId: null, roleId: role.id, basis: 'division_head', name: role.name };
    }
  }

  const office = await qualifyingRole(conn, entityId, 'management_office.head', exclude);
  if (office) return { userId: null, roleId: office.id, basis: 'management_office', name: office.name };

  throw new ApproverError('APPROVER_MISSING',
    'Belum ada penyetuju: atasan langsung, Head divisi, dan Head Management Office tidak ada yang bisa memutuskan. Lengkapi atasan di direktori atau peran Head dulu.');
}

/**
 * Puts the resolved approver on step 1 of a matrix approval, in the caller's
 * transaction. The matrix rule stays attached, so the 24 h reminder and the
 * 48 h escalation to the Management Office Head keep working.
 */
async function assignFirstStep(conn, approvalRequestId, approver) {
  await conn.query(
    `UPDATE approval_steps SET approver_user_id = ?, approver_role_id = ?
      WHERE approval_request_id = ? AND order_index = 1`,
    [approver.userId || null, approver.roleId || null, approvalRequestId],
  );
}

module.exports = {
  ApproverError, ELIGIBLE_SQL, resolveApprover, assignFirstStep, isEligibleUser, isExcludedAccount,
};
