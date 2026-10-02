/**
 * Shared division (department) scoping rules.
 *
 * Product rule: data inside a company (entity) is scoped per division.
 * Management roles (Management Office, Super Admin) see across divisions.
 * Entity boundaries are enforced separately (entityScope / taskAccess);
 * these helpers only answer the division question.
 */

const CROSS_DIVISION_PERMISSIONS = Object.freeze([
  'workspace.cross_division.view',
  'management_dashboard.view',
]);

function permissionsOf(user) {
  return Array.isArray(user?.permissions) ? user.permissions : [];
}

/** True when the user may see data of every division in their entity. */
function spansDivisions(user) {
  const perms = permissionsOf(user);
  return CROSS_DIVISION_PERMISSIONS.some((code) => perms.includes(code));
}

/**
 * True when a row with this department belongs to the user's division.
 * Rows without a department (company-wide) count as visible to everyone.
 */
function sameDivision(user, departmentId) {
  if (departmentId === null || departmentId === undefined) return true;
  if (user?.departmentId === null || user?.departmentId === undefined) return false;
  return Number(departmentId) === Number(user.departmentId);
}

/** spansDivisions OR sameDivision — the plain "division visible" check. */
function canSeeDivision(user, departmentId) {
  return spansDivisions(user) || sameDivision(user, departmentId);
}

/**
 * SQL fragment for the plain division rule on a column, e.g.
 * divisionSql(user, 'd.department_id') -> { sql: '(d.department_id IS NULL OR d.department_id = ?)', args: [5] }
 * Returns { sql: '1=1', args: [] } for users who span divisions.
 */
function divisionSql(user, column) {
  if (spansDivisions(user)) return { sql: '1=1', args: [] };
  if (user?.departmentId === null || user?.departmentId === undefined) {
    return { sql: `(${column} IS NULL)`, args: [] };
  }
  return { sql: `(${column} IS NULL OR ${column} = ?)`, args: [Number(user.departmentId)] };
}

/**
 * Documents: own division, company-wide (no division) or created by the user,
 * unless the user spans divisions. The caller still filters the entity.
 */
function documentVisibilitySql(user, alias = 'd') {
  if (spansDivisions(user)) return { sql: '1=1', args: [] };
  const dept = user?.departmentId == null ? null : Number(user.departmentId);
  return {
    sql: `(${alias}.department_id IS NULL OR ${alias}.department_id = ? OR ${alias}.created_by = ?)`,
    args: [dept, Number(user?.sub) || 0],
  };
}

/** Row-level twin of documentVisibilitySql. */
function canSeeDocument(user, doc) {
  if (!doc) return false;
  if (spansDivisions(user) || sameDivision(user, doc.department_id)) return true;
  return doc.created_by != null && Number(doc.created_by) === Number(user?.sub);
}

/**
 * Signature requests: own division / company-wide, or — whatever the
 * division — the requester, the assigned signer (user or role), the signer,
 * and anyone who is or was a decider on the linked approval request.
 * The caller still filters the entity.
 */
function signatureVisibilitySql(user, alias = 's') {
  if (spansDivisions(user)) return { sql: '1=1', args: [] };
  const dept = user?.departmentId == null ? null : Number(user.departmentId);
  const uid = Number(user?.sub) || 0;
  return {
    sql: `(${alias}.department_id IS NULL OR ${alias}.department_id = ?
           OR ${alias}.requested_by = ? OR ${alias}.assigned_signer_user_id = ? OR ${alias}.signed_by = ?
           OR ${alias}.assigned_signer_role_id IN (SELECT ur_sig.role_id FROM user_roles ur_sig WHERE ur_sig.user_id = ?)
           OR EXISTS (
             SELECT 1 FROM approval_steps st_sig
              WHERE st_sig.approval_request_id = ${alias}.approval_request_id
                AND (st_sig.approver_user_id = ? OR st_sig.decided_by = ? OR st_sig.escalated_to_user_id = ?
                     OR st_sig.approver_role_id IN (SELECT ur_sig2.role_id FROM user_roles ur_sig2 WHERE ur_sig2.user_id = ?))))`,
    args: [dept, uid, uid, uid, uid, uid, uid, uid, uid],
  };
}

module.exports = {
  CROSS_DIVISION_PERMISSIONS,
  spansDivisions,
  sameDivision,
  canSeeDivision,
  divisionSql,
  documentVisibilitySql,
  canSeeDocument,
  signatureVisibilitySql,
};
