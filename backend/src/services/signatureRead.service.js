const pool = require('../db/pool');
const { signatureVisibilitySql } = require('./divisionAccess');

// Read-only views of signature requests for one user (Prakasa AI,
// tools/approvals.js): what waits for their signature and the requests they
// made. Bound to the entity and to signatureVisibilitySql (the rule of the
// Tanda Tangan list and detail). Never the signature image, the signed file,
// the document hash or a verification code.

const COLUMNS = `s.id, d.title AS documentTitle, d.document_type AS documentType,
  s.signature_type AS signatureType, s.status,
  s.requested_by AS requestedBy, ru.name AS requesterName,
  au.name AS assignedSignerUserName, ar.name AS assignedSignerRoleName,
  su.name AS signedByName, s.signed_at AS signedAt, s.created_at AS createdAt,
  s.approval_request_id AS approvalRequestId, a.status AS approvalStatus`;
const JOINS = `FROM signature_requests s
  JOIN documents d ON d.id = s.document_id
  LEFT JOIN users ru ON ru.id = s.requested_by
  LEFT JOIN users au ON au.id = s.assigned_signer_user_id
  LEFT JOIN roles ar ON ar.id = s.assigned_signer_role_id
  LEFT JOIN users su ON su.id = s.signed_by
  LEFT JOIN approval_requests a ON a.id = s.approval_request_id`;
const cap = (limit) => Math.min(100, Math.max(1, Number(limit) || 25));

async function query(user, extraWhere, extraArgs, order, limit) {
  const visible = signatureVisibilitySql(user, 's');
  const where = `s.entity_id = ? AND ${visible.sql} AND ${extraWhere}`;
  const args = [user.entityId, ...visible.args, ...extraArgs];
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM signature_requests s WHERE ${where}`, args);
  const [rows] = await pool.query(`SELECT ${COLUMNS} ${JOINS} WHERE ${where} ORDER BY ${order} LIMIT ?`, [...args, cap(limit)]);
  return { total: Number(total), rows };
}

/** Pending requests assigned to this user (by name or through one of their roles), oldest first. */
function waitingFor(user, { limit = 25 } = {}) {
  return query(
    user,
    `s.status = 'pending'
     AND (s.assigned_signer_user_id = ?
          OR s.assigned_signer_role_id IN (SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = ?))`,
    [user.sub, user.sub],
    's.created_at ASC, s.id ASC',
    limit,
  );
}

const STATUSES = ['pending', 'approved', 'rejected', 'signed', 'cancelled'];

/** Requests this user made, newest first. */
function requestedBy(user, { status = null, limit = 25 } = {}) {
  const filtered = STATUSES.includes(status);
  return query(
    user,
    `s.requested_by = ?${filtered ? ' AND s.status = ?' : ''}`,
    filtered ? [user.sub, status] : [user.sub],
    's.id DESC',
    limit,
  );
}

module.exports = { waitingFor, requestedBy, STATUSES };
