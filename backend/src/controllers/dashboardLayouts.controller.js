const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log: activityLog } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const where = ['drl.entity_id = ?'];
    const args = [req.entityScope.entityId];
    if (req.query.roleId) { where.push('drl.role_id = ?'); args.push(req.query.roleId); }

    const [rows] = await pool.query(
      `SELECT drl.id, drl.entity_id AS entityId, drl.role_id AS roleId,
              r.name AS roleName, drl.name, drl.layout_json AS layoutJson,
              drl.is_default AS isDefault, drl.created_at AS createdAt,
              drl.updated_at AS updatedAt
         FROM dashboard_role_layouts drl
         LEFT JOIN roles r ON r.id = drl.role_id
        WHERE ${where.join(' AND ')}
        ORDER BY drl.id DESC`, args
    );
    return ok(res, rows.map((r) => ({
      ...r,
      layout: parseJson(r.layoutJson) || [],
      layoutJson: undefined,
    })));
  } catch (e) { next(e); }
}

async function getForRole(req, res, next) {
  try {
    const { roleId } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM dashboard_role_layouts
        WHERE entity_id = ? AND role_id = ? LIMIT 1`,
      [req.entityScope.entityId, roleId]
    );
    if (!rows[0]) return ok(res, null);
    return ok(res, {
      ...rows[0],
      layout: parseJson(rows[0].layout_json) || [],
    });
  } catch (e) { next(e); }
}

async function upsert(req, res, next) {
  try {
    const {
      roleId, name, layout, isDefault = false,
    } = req.body;
    const entityId = req.entityScope.entityId;

    if (!roleId) return fail(res, 'VALIDATION_ERROR', 'roleId wajib', 400);
    if (!Array.isArray(layout)) return fail(res, 'VALIDATION_ERROR', 'layout harus array', 400);

    // Validate each entry
    const valid = layout.every((entry) =>
      entry && typeof entry.widgetCode === 'string' && entry.widgetCode.length > 0
    );
    if (!valid) {
      return fail(res, 'VALIDATION_ERROR',
        'Setiap entry harus punya widgetCode (string)', 400);
    }

    // Verify widget codes exist
    const codes = [...new Set(layout.map((e) => e.widgetCode))];
    if (codes.length) {
      const [found] = await pool.query(
        `SELECT code FROM dashboard_widgets WHERE code IN (?)`, [codes]
      );
      const foundSet = new Set(found.map((f) => f.code));
      const missing = codes.filter((c) => !foundSet.has(c));
      if (missing.length) {
        return fail(res, 'VALIDATION_ERROR',
          `Widget code tidak dikenal: ${missing.join(', ')}`, 400);
      }
    }

    await pool.query(
      `INSERT INTO dashboard_role_layouts
       (entity_id, role_id, name, layout_json, is_default, created_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         layout_json = VALUES(layout_json),
         is_default = VALUES(is_default)`,
      [entityId, roleId, name || null, JSON.stringify(layout),
       isDefault ? 1 : 0, req.user.sub]
    );

    await activityLog({
      entityId, userId: req.user.sub,
      action: 'dashboard_layout.update', subjectType: 'dashboard_role_layout',
      subjectId: roleId, metadata: { widgetCount: layout.length },
    });

    return ok(res, { roleId, entityId });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `DELETE FROM dashboard_role_layouts WHERE id = ? AND entity_id = ?`,
      [id, req.entityScope.entityId]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Layout tidak ditemukan', 404);
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

function parseJson(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

module.exports = { list, getForRole, upsert, remove };
