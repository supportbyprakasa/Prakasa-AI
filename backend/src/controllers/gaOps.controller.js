const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const ops = require('../services/gaOps.service');

// /ga/ops/* — Operasional GA of the signed-in user's entity (migration 114).
// The entity is always req.user.entityId; every write runs in one
// transaction with its activity log.

const KEYS = { maintenance: 'maintenance', contracts: 'contracts', bills: 'bills' };

function sendError(res, next, e) {
  if (e instanceof ops.GaOpsError) return fail(res, e.code, e.message, e.status, e.details);
  return next(e);
}

async function inTransaction(res, next, fn, status = 200) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const data = await fn(conn);
    await conn.commit();
    return ok(res, data, undefined, status);
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    return sendError(res, next, e);
  } finally {
    conn.release();
  }
}

const idParam = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

async function summary(req, res, next) {
  try {
    return ok(res, await ops.summary(pool, req.user.entityId));
  } catch (e) { return sendError(res, next, e); }
}

const list = (key) => async (req, res, next) => {
  try {
    const rows = await ops.listRows(pool, req.user.entityId, key);
    return ok(res, rows, { total: rows.length });
  } catch (e) { return sendError(res, next, e); }
};

const create = (key) => (req, res, next) => inTransaction(res, next, async (conn) => {
  const id = await ops.createRow(conn, { entityId: req.user.entityId, userId: req.user.sub, key, body: req.body });
  return ops.getRow(conn, req.user.entityId, key, id);
}, 201);

const update = (key) => (req, res, next) => {
  const id = idParam(req);
  if (!id) return fail(res, 'NOT_FOUND', `${ops.REGISTERS[key].label} tidak ditemukan`, 404);
  return inTransaction(res, next, async (conn) => {
    const result = await ops.updateRow(conn, { entityId: req.user.entityId, userId: req.user.sub, key, id, body: req.body });
    return { ...(await ops.getRow(conn, req.user.entityId, key, id)), changed: result.changed };
  });
};

async function maintenanceLogs(req, res, next) {
  const id = idParam(req);
  if (!id) return fail(res, 'NOT_FOUND', 'Jadwal perawatan tidak ditemukan', 404);
  try {
    return ok(res, await ops.listMaintenanceLogs(pool, req.user.entityId, id));
  } catch (e) { return sendError(res, next, e); }
}

function addMaintenanceLog(req, res, next) {
  const id = idParam(req);
  if (!id) return fail(res, 'NOT_FOUND', 'Jadwal perawatan tidak ditemukan', 404);
  return inTransaction(res, next, async (conn) => {
    const result = await ops.addMaintenanceLog(conn, { entityId: req.user.entityId, userId: req.user.sub, itemId: id, ...req.body });
    return { ...result, item: await ops.getRow(conn, req.user.entityId, 'maintenance', id) };
  }, 201);
}

module.exports = { KEYS, summary, list, create, update, maintenanceLogs, addMaintenanceLog };
