const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');

async function list(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const where = ['c.deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('c.entity_id = ?'); args.push(req.query.entityId); }
    if (req.query.departmentId) { where.push('c.department_id = ?'); args.push(req.query.departmentId); }
    if (req.query.ownerUserId) { where.push('c.owner_user_id = ?'); args.push(req.query.ownerUserId); }
    if (req.query.q) { where.push('(c.name LIKE ? OR c.contact_person LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }

    const [rows] = await pool.query(
      `SELECT c.id, c.entity_id AS entityId, c.department_id AS departmentId,
              c.name, c.contact_person AS contactPerson, c.phone, c.email,
              c.city, c.segment, c.owner_user_id AS ownerUserId,
              u.name AS ownerName, c.created_at AS createdAt
         FROM sales_customers c
         LEFT JOIN users u ON u.id = c.owner_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.id DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM sales_customers c WHERE ${where.join(' AND ')}`, args
    );
    return ok(res, rows, { page, limit, total });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const {
      entityId, departmentId, name, contactPerson, phone, email,
      address, city, segment, notes, ownerUserId,
    } = req.body;
    const [r] = await pool.query(
      `INSERT INTO sales_customers
       (entity_id, department_id, name, contact_person, phone, email,
        address, city, segment, notes, owner_user_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, departmentId || null, name, contactPerson || null, phone || null,
       email || null, address || null, city || null, segment || null,
       notes || null, ownerUserId || null, req.user.sub]
    );
    await log({
      entityId, userId: req.user.sub,
      action: 'sales_customer.create', subjectType: 'sales_customer', subjectId: r.insertId,
      metadata: { name },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const {
      name, contactPerson, phone, email, address, city, segment, notes, ownerUserId,
    } = req.body;
    const [r] = await pool.query(
      `UPDATE sales_customers SET
         name=COALESCE(?,name), contact_person=COALESCE(?,contact_person),
         phone=COALESCE(?,phone), email=COALESCE(?,email),
         address=COALESCE(?,address), city=COALESCE(?,city),
         segment=COALESCE(?,segment), notes=COALESCE(?,notes),
         owner_user_id=COALESCE(?,owner_user_id)
       WHERE id=? AND deleted_at IS NULL`,
      [name || null, contactPerson || null, phone || null, email || null,
       address || null, city || null, segment || null, notes || null,
       ownerUserId ?? null, id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Customer tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'sales_customer.update', subjectType: 'sales_customer', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE sales_customers SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Customer tidak ditemukan', 404);
    await log({
      entityId: null, userId: req.user.sub,
      action: 'sales_customer.delete', subjectType: 'sales_customer', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

module.exports = { list, create, update, remove };
