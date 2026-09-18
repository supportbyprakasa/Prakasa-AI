const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');

async function list(req, res, next) {
  try {
    const where = ['1=1'];
    const args = [];
    if (req.query.category) { where.push('category = ?'); args.push(req.query.category); }
    if (req.query.activeOnly === '1') where.push('is_active = 1');

    const [rows] = await pool.query(
      `SELECT id, code, name, description, category,
              default_size AS defaultSize, config_schema AS configSchema,
              permission_code AS permissionCode, is_active AS isActive
         FROM dashboard_widgets
        WHERE ${where.join(' AND ')}
        ORDER BY category ASC, name ASC`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
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
         name = VALUES(name),
         description = VALUES(description),
         category = VALUES(category),
         default_size = VALUES(default_size),
         config_schema = VALUES(config_schema),
         permission_code = VALUES(permission_code),
         is_active = VALUES(is_active)`,
      [code, name, description || null, category || null, defaultSize,
       configSchema ? JSON.stringify(configSchema) : null,
       permissionCode || null, isActive ? 1 : 0]
    );

    const [rows] = await pool.query(
      `SELECT id FROM dashboard_widgets WHERE code = ?`, [code]
    );
    return ok(res, { id: rows[0]?.id, code });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE dashboard_widgets SET is_active = 0 WHERE id = ?`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Widget tidak ditemukan', 404);
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, upsert, remove };
