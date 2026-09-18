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

async function list(req, res, next) {
  try {
    const where = ['1=1'];
    const args = [];
    if (req.query.category) { where.push('category=?'); args.push(req.query.category); }

    const canManage = (req.user.permissions || []).includes('dashboard_widget.manage');
    if (!canManage || req.query.activeOnly === '1') where.push('is_active=1');

    const [rows] = await pool.query(
      `SELECT id, code, name, description, category,
              default_size AS defaultSize, config_schema AS configSchema,
              permission_code AS permissionCode, is_active AS isActive
         FROM dashboard_widgets
        WHERE ${where.join(' AND ')}
        ORDER BY category ASC, name ASC`,
      args
    );

    const permissions = new Set(req.user.permissions || []);
    const visible = canManage
      ? rows
      : rows.filter((row) => !row.permissionCode || permissions.has(row.permissionCode));

    return ok(res, visible.map((row) => ({
      ...row,
      configSchema: parseJson(row.configSchema),
      isActive: Boolean(row.isActive),
    })));
  } catch (error) { next(error); }
}

async function upsert(req, res, next) {
  try {
    const {
      code, name, description, category, defaultSize = 'medium',
      configSchema, permissionCode, isActive = true,
    } = req.body;

    await pool.query(
      `INSERT INTO dashboard_widgets
       (code, name, description, category, default_size, config_schema,
        permission_code, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name=VALUES(name),
         description=VALUES(description),
         category=VALUES(category),
         default_size=VALUES(default_size),
         config_schema=VALUES(config_schema),
         permission_code=VALUES(permission_code),
         is_active=VALUES(is_active)`,
      [
        code, name, description ?? null, category ?? null, defaultSize,
        configSchema ? JSON.stringify(configSchema) : null,
        permissionCode ?? null, isActive ? 1 : 0,
      ]
    );

    const [rows] = await pool.query(
      'SELECT id FROM dashboard_widgets WHERE code=? LIMIT 1',
      [code]
    );
    const id = rows[0]?.id || null;

    await activityLog({
      entityId: req.user.entityId || null,
      userId: req.user.sub,
      action: 'dashboard_widget.upsert',
      subjectType: 'dashboard_widget',
      subjectId: id,
      metadata: { code },
    });

    return ok(res, { id, code });
  } catch (error) { next(error); }
}

async function remove(req, res, next) {
  try {
    const [result] = await pool.query(
      'UPDATE dashboard_widgets SET is_active=0 WHERE id=?',
      [req.params.id]
    );
    if (!result.affectedRows) {
      return fail(res, 'NOT_FOUND', 'Widget tidak ditemukan', 404);
    }

    await activityLog({
      entityId: req.user.entityId || null,
      userId: req.user.sub,
      action: 'dashboard_widget.deactivate',
      subjectType: 'dashboard_widget',
      subjectId: Number(req.params.id),
    });

    return ok(res, { id: Number(req.params.id) });
  } catch (error) { next(error); }
}

module.exports = { list, upsert, remove };
