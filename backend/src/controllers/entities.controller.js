const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const [rows] = await pool.query(
      `SELECT id, name, brand_code AS brandCode, logo_url AS logoUrl, created_at AS createdAt
         FROM entities WHERE deleted_at IS NULL
         ORDER BY id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM entities WHERE deleted_at IS NULL`
    );
    return ok(res, rows, { page, limit, total });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const { name, brandCode, logoUrl } = req.body;
    const [r] = await pool.query(
      `INSERT INTO entities (name, brand_code, logo_url) VALUES (?, ?, ?)`,
      [name, brandCode, logoUrl || null]
    );
    await log({
      entityId: r.insertId, userId: req.user.sub,
      action: 'entity.create', subjectType: 'entity', subjectId: r.insertId,
      metadata: { name, brandCode },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 'CONFLICT', 'brandCode sudah dipakai', 409);
    next(e);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { name, brandCode, logoUrl } = req.body;
    // The route validates a partial body, so only touch the fields that were
    // actually sent — otherwise a rename would blank the brand code and logo.
    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (brandCode !== undefined) { fields.push('brand_code = ?'); values.push(brandCode); }
    if (logoUrl !== undefined) { fields.push('logo_url = ?'); values.push(logoUrl || null); }
    if (!fields.length) return fail(res, 'VALIDATION_ERROR', 'Tidak ada perubahan', 400);
    const [r] = await pool.query(
      `UPDATE entities SET ${fields.join(', ')} WHERE id=? AND deleted_at IS NULL`,
      [...values, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Entity tidak ditemukan', 404);
    await log({
      entityId: Number(id), userId: req.user.sub,
      action: 'entity.update', subjectType: 'entity', subjectId: Number(id),
      metadata: { name, brandCode },
    });
    return ok(res, { id: Number(id) });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 'CONFLICT', 'brandCode sudah dipakai', 409);
    next(e);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    // An entity is the top of the tree: dozens of tables carry its entity_id.
    // Hiding one that still holds people or structure would orphan all of it
    // silently, so refuse while anything still belongs to it.
    const [[users]] = await pool.query(
      'SELECT COUNT(*) AS total FROM users WHERE entity_id = ? AND deleted_at IS NULL', [id]
    );
    const [[departments]] = await pool.query(
      'SELECT COUNT(*) AS total FROM departments WHERE entity_id = ? AND deleted_at IS NULL', [id]
    );
    const [[roles]] = await pool.query(
      'SELECT COUNT(*) AS total FROM roles WHERE entity_id = ? AND deleted_at IS NULL', [id]
    );
    if (Number(users.total) || Number(departments.total) || Number(roles.total)) {
      return fail(
        res,
        'ENTITY_IN_USE',
        `Entity masih dipakai ${Number(users.total)} pengguna, ${Number(departments.total)} divisi, dan ${Number(roles.total)} role. Pindahkan atau hapus semuanya terlebih dahulu.`,
        409,
      );
    }
    const [r] = await pool.query(
      `UPDATE entities SET deleted_at = NOW() WHERE id=? AND deleted_at IS NULL`,
      [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Entity tidak ditemukan', 404);
    await log({
      entityId: Number(id), userId: req.user.sub,
      action: 'entity.delete', subjectType: 'entity', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, create, update, remove };
