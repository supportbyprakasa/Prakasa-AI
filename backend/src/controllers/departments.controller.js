const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { z } = require('zod');
const { log } = require('../services/activityLog.service');
const { ImportRowError, importHandler } = require('../services/bulkImport.service');

// Just the id/name pairs of the caller's own entity, for pickers such as
// "which division owns this project". Division names are org structure that
// every page already shows, so this needs no management permission — unlike
// list(), which exposes the full admin record.
async function options(req, res, next) {
  try {
    const entityId = req.user?.entityId;
    if (!entityId) return ok(res, []);
    const [rows] = await pool.query(
      `SELECT id, name FROM departments
        WHERE entity_id = ? AND deleted_at IS NULL
        ORDER BY name ASC`,
      [entityId]
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = ['d.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('d.entity_id = ?'); args.push(req.query.entityId); }

    const [rows] = await pool.query(
      `SELECT d.id, d.entity_id AS entityId, e.name AS entityName,
              d.name, d.created_at AS createdAt
         FROM departments d
         JOIN entities e ON e.id = d.entity_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.id DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM departments d WHERE ${where.join(' AND ')}`, args
    );
    return ok(res, rows, { page, limit, total });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const { entityId, name } = req.body;
    const [r] = await pool.query(
      `INSERT INTO departments (entity_id, name) VALUES (?, ?)`, [entityId, name]
    );
    await log({
      entityId, userId: req.user.sub,
      action: 'department.create', subjectType: 'department',
      subjectId: r.insertId, metadata: { entityId, name },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { entityId, name } = req.body;
    const fields = [];
    const values = [];
    if (entityId !== undefined) { fields.push('entity_id = ?'); values.push(entityId); }
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (!fields.length) return fail(res, 'VALIDATION_ERROR', 'Tidak ada perubahan', 400);
    const [r] = await pool.query(
      `UPDATE departments SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      [...values, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Department tidak ditemukan', 404);
    await log({
      entityId, userId: req.user.sub,
      action: 'department.update', subjectType: 'department',
      subjectId: Number(id), metadata: { entityId, name },
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [[users]] = await pool.query(
      'SELECT COUNT(*) AS total FROM users WHERE department_id = ? AND deleted_at IS NULL', [id]
    );
    const [[roles]] = await pool.query(
      'SELECT COUNT(*) AS total FROM roles WHERE department_id = ? AND deleted_at IS NULL', [id]
    );
    if (Number(users.total) || Number(roles.total)) {
      return fail(
        res,
        'DEPARTMENT_IN_USE',
        `Divisi masih dipakai ${Number(users.total)} pengguna dan ${Number(roles.total)} role. Pindahkan pengguna dan hapus role-nya terlebih dahulu.`,
        409,
      );
    }
    const [r] = await pool.query(
      `UPDATE departments SET deleted_at = NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Department tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'department.delete', subjectType: 'department', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

const importSchema = z.object({
  entityId: z.number().int().positive(),
  name: z.string().trim().min(1).max(150),
});

const importRows = importHandler({
  schema: importSchema,
  action: 'department.import',
  subjectType: 'department',
  async insertRow(connection, { entityId, name }) {
    const [entities] = await connection.query(
      'SELECT id FROM entities WHERE id = ? AND deleted_at IS NULL', [entityId]
    );
    if (!entities.length) throw new ImportRowError('entityId', 'Entity tidak ditemukan');
    const [existing] = await connection.query(
      'SELECT id FROM departments WHERE entity_id = ? AND name = ? AND deleted_at IS NULL', [entityId, name]
    );
    if (existing.length) throw new ImportRowError('name', `Divisi "${name}" sudah ada di entity ini`);
    const [result] = await connection.query(
      'INSERT INTO departments (entity_id, name) VALUES (?, ?)', [entityId, name]
    );
    return result.insertId;
  },
});

module.exports = {
  options, list, create, update, remove, importRows };
