const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const sigSvc = require('../services/signature.service');
const { log } = require('../services/activityLog.service');

function hasPerm(user, code) {
  return Boolean(user && (user.permissions || []).includes(code));
}

// Same rule as Division Storage: a user may act on their own division, or any
// division in the entity when they hold the cross-division permission.
function hasDepartmentAccess(user, departmentId) {
  if (hasPerm(user, 'workspace.cross_division.view')) return true;
  return Number(user.departmentId) === Number(departmentId);
}

async function listDivisions(req, res, next) {
  try {
    const crossDivision = hasPerm(req.user, 'workspace.cross_division.view');
    if (!crossDivision && !req.user.departmentId) {
      return ok(res, { divisions: [], defaultDepartmentId: null });
    }
    const [rows] = await pool.query(
      `SELECT id, name, code FROM departments
        WHERE entity_id=? AND deleted_at IS NULL ${crossDivision ? '' : 'AND id=?'}
        ORDER BY name`,
      crossDivision ? [req.user.entityId] : [req.user.entityId, req.user.departmentId]
    );
    return ok(res, {
      divisions: rows.map((row) => ({ id: row.id, name: row.name, code: row.code })),
      defaultDepartmentId: req.user.departmentId || null,
    });
  } catch (e) { next(e); }
}

async function get(req, res, next) {
  try {
    const departmentId = Number(req.query.departmentId || req.user.departmentId);
    if (!departmentId) return fail(res, 'VALIDATION_ERROR', 'departmentId wajib diisi', 400);
    if (!hasDepartmentAccess(req.user, departmentId)) {
      return fail(res, 'FORBIDDEN', 'Tidak punya akses ke divisi ini', 403);
    }
    const [rows] = await pool.query(
      `SELECT encrypted_blob, iv, auth_tag, mime_type, uploaded_by, updated_at
         FROM letterhead_assets WHERE department_id=? LIMIT 1`,
      [departmentId]
    );
    if (!rows[0]) return ok(res, { exists: false });

    // Unlike a personal signature, a division letterhead is meant to be seen
    // and used by anyone in that division — it already appears on outgoing
    // documents, so returning it decrypted here is not a new exposure.
    const decrypted = sigSvc.decryptBuffer({
      encrypted: rows[0].encrypted_blob, iv: rows[0].iv, authTag: rows[0].auth_tag,
    });
    return ok(res, {
      exists: true,
      mimeType: rows[0].mime_type,
      imageBase64: decrypted.toString('base64'),
      uploadedBy: rows[0].uploaded_by,
      updatedAt: rows[0].updated_at,
    });
  } catch (e) { next(e); }
}

async function save(req, res, next) {
  try {
    const departmentId = Number(req.body.departmentId);
    if (!departmentId) return fail(res, 'VALIDATION_ERROR', 'departmentId wajib diisi', 400);
    if (!hasDepartmentAccess(req.user, departmentId)) {
      return fail(res, 'FORBIDDEN', 'Tidak punya akses ke divisi ini', 403);
    }

    const raw = String(req.body.imageBase64 || '').replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(raw, 'base64');
    if (!buffer.length || buffer.length > 500 * 1024) {
      return fail(res, 'VALIDATION_ERROR', 'Ukuran cap surat tidak valid (maks 500KB)', 400);
    }

    const { encrypted, iv, authTag } = sigSvc.encryptBuffer(buffer);
    await pool.query(
      `INSERT INTO letterhead_assets
       (entity_id, department_id, encrypted_blob, iv, auth_tag, mime_type, uploaded_by)
       VALUES (?, ?, ?, ?, ?, 'image/png', ?)
       ON DUPLICATE KEY UPDATE
         encrypted_blob=VALUES(encrypted_blob),
         iv=VALUES(iv),
         auth_tag=VALUES(auth_tag),
         mime_type='image/png',
         uploaded_by=VALUES(uploaded_by)`,
      [req.user.entityId, departmentId, encrypted, iv, authTag, req.user.sub]
    );

    await log({
      entityId: req.user.entityId, userId: req.user.sub,
      action: 'letterhead.save', subjectType: 'department', subjectId: departmentId,
    });
    return ok(res, { saved: true });
  } catch (e) { next(e); }
}

module.exports = { listDivisions, get, save };
