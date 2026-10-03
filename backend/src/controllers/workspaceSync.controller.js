const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const rolePolicy = require('../services/rolePolicy.service');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const { invalidateAuth } = require('../middleware/requireAuth');
const directory = require('../services/googleDirectory.service');
const drive = require('../services/googleDrive.service');
const folderMappingRules = require('./folderMappingRules.controller');

// Best-effort: a synced user's account must exist regardless of whether Drive
// membership succeeds, so failures here are logged, never thrown.
async function grantDriveAccess({ entityId, departmentId, email, userId }, ctx) {
  try {
    const folderId = await folderMappingRules.resolveFolder({ entityId, departmentId, documentType: '*' });
    if (!folderId) return { granted: false, reason: 'no_folder_mapping' };
    const result = await drive.ensureFolderMember({ folderId, email, role: 'fileOrganizer' }, ctx);
    return { granted: result.added || result.reason === 'already_member', ...result };
  } catch (error) {
    await log({
      entityId, userId: ctx.userId,
      action: 'workspace_sync.drive_access_failed', subjectType: 'user', subjectId: userId,
      metadata: { email, departmentId, error: error.message },
    });
    return { granted: false, reason: 'error', error: error.message };
  }
}

function randomPassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12) + '!1';
}

// Pulls the current Workspace member list and stages anyone not already a
// Prakasa Workspace user as a review candidate. Never touches the `users`
// table itself — division + role level aren't reliably inferable from
// Workspace data (job titles are typically empty, org units don't map to our
// division taxonomy), so nothing becomes a real account without a human
// picking those two fields first.
async function fetchCandidates(req, res, next) {
  try {
    const entityId = req.user.entityId;
    const domainUsers = await directory.listDomainUsers({ entityId, userId: req.user.sub });

    const [existingUsers] = await pool.query(
      'SELECT email FROM users WHERE entity_id=? AND deleted_at IS NULL', [entityId]
    );
    const existingEmails = new Set(existingUsers.map((row) => row.email.toLowerCase()));

    const toStage = domainUsers.filter((user) => user.email && !existingEmails.has(user.email.toLowerCase()));

    let staged = 0;
    for (const user of toStage) {
      const [result] = await pool.query(
        `INSERT INTO workspace_sync_candidates (entity_id, email, name, org_unit_path, google_is_admin, status)
         VALUES (?, ?, ?, ?, ?, 'pending')
         ON DUPLICATE KEY UPDATE
           name=VALUES(name), org_unit_path=VALUES(org_unit_path), google_is_admin=VALUES(google_is_admin),
           status=IF(status='dismissed', status, 'pending')`,
        [entityId, user.email.toLowerCase(), user.name, user.orgUnitPath, user.isAdmin ? 1 : 0]
      );
      if (result.affectedRows) staged += 1;
    }

    await log({
      entityId, userId: req.user.sub,
      action: 'workspace_sync.fetch', subjectType: 'workspace_sync_candidate',
      metadata: { found: domainUsers.length, staged: toStage.length },
    });

    return ok(res, { found: domainUsers.length, staged: toStage.length });
  } catch (error) {
    if (error.code === 'GOOGLE_ADMIN_NOT_CONFIGURED') {
      return fail(res, error.code, error.message, 503);
    }
    next(error);
  }
}

async function listCandidates(req, res, next) {
  try {
    const status = req.query.status || 'pending';
    const [rows] = await pool.query(
      `SELECT c.id, c.email, c.name, c.org_unit_path AS orgUnitPath, c.google_is_admin AS googleIsAdmin,
              c.status, c.department_id AS departmentId, d.name AS departmentName,
              c.role_id AS roleId, r.name AS roleName, c.fetched_at AS fetchedAt
         FROM workspace_sync_candidates c
         LEFT JOIN departments d ON d.id = c.department_id
         LEFT JOIN roles r ON r.id = c.role_id
        WHERE c.entity_id=? AND c.status=?
        ORDER BY c.name`,
      [req.user.entityId, status]
    );
    return ok(res, rows);
  } catch (error) { next(error); }
}

async function updateCandidate(req, res, next) {
  try {
    const { id } = req.params;
    const { departmentId, roleId } = req.body;
    const [result] = await pool.query(
      `UPDATE workspace_sync_candidates
          SET department_id=?, role_id=?
        WHERE id=? AND entity_id=? AND status='pending'`,
      [departmentId || null, roleId || null, id, req.user.entityId]
    );
    if (!result.affectedRows) return fail(res, 'NOT_FOUND', 'Kandidat tidak ditemukan', 404);
    return ok(res, { id: Number(id) });
  } catch (error) { next(error); }
}

async function dismissCandidate(req, res, next) {
  try {
    const { id } = req.params;
    const [result] = await pool.query(
      `UPDATE workspace_sync_candidates
          SET status='dismissed', reviewed_by=?, reviewed_at=NOW()
        WHERE id=? AND entity_id=? AND status='pending'`,
      [req.user.sub, id, req.user.entityId]
    );
    if (!result.affectedRows) return fail(res, 'NOT_FOUND', 'Kandidat tidak ditemukan', 404);
    return ok(res, { id: Number(id) });
  } catch (error) { next(error); }
}

// Turns a reviewed candidate into a real account — only once an admin has
// picked its department + role here (or in the same request).
async function applyCandidate(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    const { departmentId: bodyDepartmentId, roleId: bodyRoleId } = req.body || {};

    const [rows] = await conn.query(
      `SELECT * FROM workspace_sync_candidates WHERE id=? AND entity_id=? AND status='pending' LIMIT 1 FOR UPDATE`,
      [id, req.user.entityId]
    );
    const candidate = rows[0];
    if (!candidate) return fail(res, 'NOT_FOUND', 'Kandidat tidak ditemukan', 404);

    const departmentId = bodyDepartmentId || candidate.department_id;
    const roleId = bodyRoleId || candidate.role_id;
    if (!departmentId || !roleId) {
      return fail(res, 'VALIDATION_ERROR', 'Pilih divisi dan role sebelum menerapkan kandidat ini', 400);
    }

    // Passwords are managed by the Super Admin only: a Super Admin gets a
    // temporary password to hand over; for anyone else the account is created
    // without one and its owner signs in with the office Google account.
    const password = await rolePolicy.isSuperAdmin(req.user.sub, conn) ? randomPassword() : null;
    const passwordHash = password ? await bcrypt.hash(password, 12) : null;

    await conn.beginTransaction();

    // Same role rules as creating a user by hand: a role of this company that
    // fits the division, and Super Admin only from a Super Admin.
    const roleRows = await rolePolicy.loadRolesForAssignment({ connection: conn, roleIds: [roleId] });
    rolePolicy.validateRoleAssignment({ entityId: req.user.entityId, departmentId, roleRows });
    await rolePolicy.assertCanChangeAccount({ connection: conn, actorId: req.user.sub, targetUserId: null, nextRoles: roleRows });

    const [userResult] = await conn.query(
      `INSERT INTO users (entity_id, department_id, name, email, password_hash, must_change_password, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [req.user.entityId, departmentId, candidate.name, candidate.email, passwordHash, passwordHash ? 1 : 0]
    );
    await conn.query('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [userResult.insertId, roleId]);
    // Same as creating a user by hand: attach the new account to its directory entry (rule 8).
    await require('../services/peopleDirectory.service').linkAccount(conn, req.user.entityId, userResult.insertId, req.user.sub);
    await conn.query(
      `UPDATE workspace_sync_candidates
          SET status='applied', department_id=?, role_id=?, applied_user_id=?, reviewed_by=?, reviewed_at=NOW()
        WHERE id=?`,
      [departmentId, roleId, userResult.insertId, req.user.sub, id]
    );

    await conn.commit();
    invalidateAuth(userResult.insertId);

    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'workspace_sync.apply', subjectType: 'user', subjectId: userResult.insertId,
      metadata: { candidateId: Number(id), email: candidate.email, departmentId, roleId },
    });

    const driveAccess = await grantDriveAccess(
      { entityId: req.user.entityId, departmentId, email: candidate.email, userId: userResult.insertId },
      { entityId: req.user.entityId, userId: req.user.sub }
    );

    return ok(res, { userId: userResult.insertId, email: candidate.email, password, driveAccess }, undefined, 201);
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    if (error.code === 'ER_DUP_ENTRY') {
      return fail(res, 'CONFLICT', 'Email sudah dipakai user lain', 409);
    }
    next(error);
  } finally {
    conn.release();
  }
}

// Retroactive pass for every already-existing active user (created before this
// feature existed, or created outside workspace-sync entirely): grants each
// one Shared Drive membership on their division's folder, same as a fresh
// apply does going forward. Safe to re-run — ensureFolderMember no-ops for
// anyone already a member.
async function backfillDriveAccess(req, res, next) {
  try {
    const entityId = req.user.entityId;
    const [users] = await pool.query(
      `SELECT id, email, department_id AS departmentId FROM users
        WHERE entity_id=? AND deleted_at IS NULL AND status='active' AND department_id IS NOT NULL`,
      [entityId]
    );

    const results = [];
    for (const user of users) {
      const driveAccess = await grantDriveAccess(
        { entityId, departmentId: user.departmentId, email: user.email, userId: user.id },
        { entityId, userId: req.user.sub }
      );
      results.push({ userId: user.id, email: user.email, ...driveAccess });
    }

    const granted = results.filter((r) => r.granted && r.added).length;
    const alreadyMember = results.filter((r) => r.granted && !r.added).length;
    const failed = results.filter((r) => !r.granted).length;

    await log({
      entityId, userId: req.user.sub,
      action: 'workspace_sync.backfill_drive_access', subjectType: 'user',
      metadata: { total: results.length, granted, alreadyMember, failed },
    });

    return ok(res, { total: results.length, granted, alreadyMember, failed, results });
  } catch (error) { next(error); }
}

module.exports = {
  fetchCandidates, listCandidates, updateCandidate, dismissCandidate, applyCandidate,
  backfillDriveAccess,
};
