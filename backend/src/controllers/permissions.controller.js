const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const { invalidateAuth } = require('../middleware/requireAuth');

async function list(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, code, description, created_at AS createdAt
         FROM permissions ORDER BY code ASC`
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const { code, description } = req.body;
    const [r] = await pool.query(
      `INSERT INTO permissions (code, description) VALUES (?, ?)`, [code, description || null]
    );
    await log({
      entityId: null, userId: req.user.sub,
      action: 'permission.create', subjectType: 'permission', subjectId: r.insertId,
      metadata: { code },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, 'CONFLICT', 'Code sudah dipakai', 409);
    next(e);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { code, description } = req.body;
    const [[current]] = await pool.query('SELECT id, code, description FROM permissions WHERE id=? LIMIT 1', [id]);
    if (!current) return fail(res, 'NOT_FOUND', 'Permission tidak ditemukan', 404);
    // A permission's code is what every role and route checks; renaming it
    // would silently move a power to whoever holds the new name.
    if (code !== undefined && code !== current.code) {
      return fail(res, 'PERMISSION_CODE_IMMUTABLE', 'Kode izin tidak bisa diubah, hanya deskripsinya', 400);
    }
    // Only the fields that were sent: a body without description keeps it.
    if (description !== undefined) {
      await pool.query('UPDATE permissions SET description=? WHERE id=?', [description || null, id]);
    }
    await log({
      entityId: null, userId: req.user.sub,
      action: 'permission.update', subjectType: 'permission', subjectId: Number(id),
      metadata: { code: current.code, descriptionChanged: description !== undefined },
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(`DELETE FROM permissions WHERE id=?`, [id]);
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Permission tidak ditemukan', 404);
    invalidateAuth();
    await log({
      entityId: null, userId: req.user.sub,
      action: 'permission.delete', subjectType: 'permission', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, create, update, remove };
