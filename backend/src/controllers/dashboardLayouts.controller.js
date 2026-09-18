const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

async function assertRoleInEntity(roleId, entityId) {
  const [rows] = await pool.query(
    `SELECT id, name FROM roles
      WHERE id=? AND entity_id=? AND deleted_at IS NULL`,
    [roleId, entityId]
  );
  if (!rows[0]) {
    const error = new Error('Role tidak valid untuk entity ini');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  return rows[0];
}

async function userHasRole(userId, roleId) {
  const [rows] = await pool.query(
    'SELECT 1 FROM user_roles WHERE user_id=? AND role_id=? LIMIT 1',
    [userId, roleId]
  );
  return Boolean(rows[0]);
}

async function list(req, res, next) {
  try {
    const where = ['drl.entity_id=?'];
    const args = [req.entityScope.entityId];
    if (req.query.roleId) { where.push('drl.role_id=?'); args.push(req.query.roleId); }

    const [rows] = await pool.query(
      `SELECT drl.id, drl.entity_id AS entityId, drl.role_id AS roleId,
              r.name AS roleName, drl.name, drl.layout_json AS layoutJson,
              drl.is_default AS isDefault, drl.created_at AS createdAt,
              drl.updated_at AS updatedAt
         FROM dashboard_role_layouts drl
         JOIN roles r ON r.id=drl.role_id
        WHERE ${where.join(' AND ')}
        ORDER BY drl.id DESC`,
      args
    );

    return ok(res, rows.map((row) => ({
      ...row,
      layout: parseJson(row.layoutJson) || [],
      layoutJson: undefined,
      isDefault: Boolean(row.isDefault),
    })));
  } catch (error) { next(error); }
}

async function getForRole(req, res, next) {
  try {
    const roleId = Number(req.params.roleId);
    await assertRoleInEntity(roleId, req.entityScope.entityId);

    const canManage = (req.user.permissions || []).includes('dashboard_layout.manage');
    if (!canManage && !(await userHasRole(req.user.sub, roleId))) {
      return fail(res, 'FORBIDDEN', 'Tidak punya akses ke layout role ini', 403);
    }

    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, role_id AS roleId, name,
              layout_json AS layoutJson, is_default AS isDefault,
              created_at AS createdAt, updated_at AS updatedAt
         FROM dashboard_role_layouts
        WHERE entity_id=? AND role_id=? LIMIT 1`,
      [req.entityScope.entityId, roleId]
    );
    if (!rows[0]) return ok(res, null);

    return ok(res, {
      ...rows[0],
      layout: parseJson(rows[0].layoutJson) || [],
      layoutJson: undefined,
      isDefault: Boolean(rows[0].isDefault),
    });
  } catch (error) {
    if (error.status) return fail(res, error.code, error.message, error.status);
    next(error);
  }
}

async function mine(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT drl.id, drl.entity_id AS entityId, drl.role_id AS roleId,
              r.name AS roleName, drl.name, drl.layout_json AS layoutJson,
              drl.is_default AS isDefault
         FROM user_roles ur
         JOIN roles r ON r.id=ur.role_id AND r.deleted_at IS NULL
         LEFT JOIN dashboard_role_layouts drl
           ON drl.role_id=r.id AND drl.entity_id=r.entity_id
        WHERE ur.user_id=? AND r.entity_id=?
        ORDER BY drl.is_default DESC, r.name ASC`,
      [req.user.sub, req.entityScope.entityId]
    );

    return ok(res, rows.map((row) => ({
      ...row,
      layout: parseJson(row.layoutJson) || [],
      layoutJson: undefined,
      isDefault: Boolean(row.isDefault),
    })));
  } catch (error) { next(error); }
}

async function upsert(req, res, next) {
  try {
    const { roleId, name, layout, isDefault = false } = req.body;
    const entityId = req.entityScope.entityId;

    await assertRoleInEntity(roleId, entityId);

    const codes = [...new Set(layout.map((entry) => entry.widgetCode))];
    if (codes.length) {
      const [widgets] = await pool.query(
        `SELECT code, permission_code AS permissionCode
           FROM dashboard_widgets
          WHERE code IN (?) AND is_active=1`,
        [codes]
      );
      const found = new Set(widgets.map((widget) => widget.code));
      const missing = codes.filter((code) => !found.has(code));
      if (missing.length) {
        return fail(
          res,
          'VALIDATION_ERROR',
          `Widget code tidak dikenal/aktif: ${missing.join(', ')}`,
          400
        );
      }
    }

    await pool.query(
      `INSERT INTO dashboard_role_layouts
       (entity_id, role_id, name, layout_json, is_default, created_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name=VALUES(name),
         layout_json=VALUES(layout_json),
         is_default=VALUES(is_default),
         updated_at=CURRENT_TIMESTAMP`,
      [
        entityId,
        roleId,
        name ?? null,
        JSON.stringify(layout),
        isDefault ? 1 : 0,
        req.user.sub,
      ]
    );

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'dashboard_layout.update',
      subjectType: 'dashboard_role_layout',
      subjectId: roleId,
      metadata: { widgetCount: layout.length },
    });

    return ok(res, { roleId, entityId });
  } catch (error) {
    if (error.status) return fail(res, error.code, error.message, error.status);
    next(error);
  }
}

async function remove(req, res, next) {
  try {
    const [result] = await pool.query(
      'DELETE FROM dashboard_role_layouts WHERE id=? AND entity_id=?',
      [req.params.id, req.entityScope.entityId]
    );
    if (!result.affectedRows) {
      return fail(res, 'NOT_FOUND', 'Layout tidak ditemukan', 404);
    }

    await activityLog({
      entityId: req.entityScope.entityId,
      userId: req.user.sub,
      action: 'dashboard_layout.delete',
      subjectType: 'dashboard_role_layout',
      subjectId: Number(req.params.id),
    });

    return ok(res, { id: Number(req.params.id) });
  } catch (error) { next(error); }
}

async function roles(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, name
         FROM roles
        WHERE entity_id=? AND deleted_at IS NULL
        ORDER BY name ASC`,
      [req.entityScope.entityId]
    );
    return ok(res, rows);
  } catch (error) { next(error); }
}

module.exports = { list, roles, getForRole, mine, upsert, remove };
