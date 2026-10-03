const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const registers = require('../services/itRegisters.service');
const importer = require('../services/itInfraImport.service');
const { RegisterError } = registers;

// /it/infrastructure/* — the IT registers of the signed-in user's entity
// (docs/rancangan-people-culture-g2.md §4.2). The entity is always
// req.user.entityId; every write runs in one transaction with its log.

const KEYS = { 'network-devices': 'network', 'isp-links': 'isp', cctv: 'cctv', backups: 'backup', 'phone-lines': 'phone' };

function sendError(res, next, e) {
  if (e instanceof RegisterError) return fail(res, e.code, e.message, e.status, e.details);
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
    return ok(res, await registers.infrastructureBlock(pool, req.user.entityId));
  } catch (e) { return sendError(res, next, e); }
}

const list = (key) => async (req, res, next) => {
  try {
    const rows = await registers.listRows(pool, req.user.entityId, key);
    return ok(res, rows, { total: rows.length });
  } catch (e) { return sendError(res, next, e); }
};

const detail = (key) => async (req, res, next) => {
  try {
    const id = idParam(req);
    const row = id ? await registers.getRow(pool, req.user.entityId, key, id) : null;
    if (!row) return fail(res, 'NOT_FOUND', `${registers.REGISTERS[key].label} tidak ditemukan`, 404);
    return ok(res, row);
  } catch (e) { return sendError(res, next, e); }
};

const create = (key) => (req, res, next) => inTransaction(res, next, async (conn) => {
  const id = await registers.createRow(conn, { entityId: req.user.entityId, userId: req.user.sub, key, body: req.body });
  return registers.getRow(conn, req.user.entityId, key, id);
}, 201);

const update = (key) => (req, res, next) => {
  const id = idParam(req);
  if (!id) return fail(res, 'NOT_FOUND', `${registers.REGISTERS[key].label} tidak ditemukan`, 404);
  return inTransaction(res, next, async (conn) => {
    const result = await registers.updateRow(conn, { entityId: req.user.entityId, userId: req.user.sub, key, id, body: req.body });
    return { ...(await registers.getRow(conn, req.user.entityId, key, id)), changed: result.changed };
  });
};

function cctvStatus(req, res, next) {
  const id = idParam(req);
  if (!id) return fail(res, 'NOT_FOUND', 'Sistem CCTV tidak ditemukan', 404);
  return inTransaction(res, next, async (conn) => {
    await registers.setCctvStatus(conn, { entityId: req.user.entityId, userId: req.user.sub, id, ...req.body });
    return registers.getRow(conn, req.user.entityId, 'cctv', id);
  });
}

async function backupChecks(req, res, next) {
  try {
    const id = idParam(req);
    if (!id) return fail(res, 'NOT_FOUND', 'Backup tidak ditemukan', 404);
    return ok(res, await registers.listBackupChecks(pool, req.user.entityId, id));
  } catch (e) { return sendError(res, next, e); }
}

function addBackupCheck(req, res, next) {
  const id = idParam(req);
  if (!id) return fail(res, 'NOT_FOUND', 'Backup tidak ditemukan', 404);
  return inTransaction(res, next, async (conn) => {
    const check = await registers.addBackupCheck(conn, { entityId: req.user.entityId, userId: req.user.sub, jobId: id, ...req.body });
    return { check, job: await registers.getRow(conn, req.user.entityId, 'backup', id) };
  }, 201);
}

async function gwsReviews(req, res, next) {
  try {
    const rows = await registers.listGwsReviews(pool, req.user.entityId);
    return ok(res, rows, { total: rows.length });
  } catch (e) { return sendError(res, next, e); }
}

function addGwsReview(req, res, next) {
  return inTransaction(res, next, async (conn) => {
    const id = await registers.addGwsReview(conn, { entityId: req.user.entityId, userId: req.user.sub, body: req.body });
    const rows = await registers.listGwsReviews(conn, req.user.entityId);
    return rows.find((r) => r.id === id) || { id };
  }, 201);
}

function phoneHolder(req, res, next) {
  const id = idParam(req);
  if (!id) return fail(res, 'NOT_FOUND', 'Nomor perusahaan tidak ditemukan', 404);
  return inTransaction(res, next, async (conn) => {
    await registers.setPhoneLineHolder(conn, {
      entityId: req.user.entityId, userId: req.user.sub, id,
      personId: req.body.personId ?? null, accountUserId: req.body.userId ?? null,
      holderLabel: req.body.holderLabel ?? null, version: req.body.version,
    });
    return registers.getRow(conn, req.user.entityId, 'phone', id);
  });
}

async function vendors(req, res, next) {
  try {
    const rows = await registers.listVendors(pool, req.user.entityId);
    return ok(res, rows, { total: rows.length });
  } catch (e) { return sendError(res, next, e); }
}

async function importPreview(req, res, next) {
  try {
    return ok(res, await importer.preview(pool, req.user.entityId, req.body));
  } catch (e) { return sendError(res, next, e); }
}

function importApply(req, res, next) {
  return inTransaction(res, next, (conn) => importer.apply(conn, { entityId: req.user.entityId, userId: req.user.sub, body: req.body }));
}

/** GET /it/phone-lines/person/:personId — a person's active company lines (number/extension only). */
async function personLines(req, res, next) {
  try {
    const personId = Number(req.params.personId);
    if (!Number.isInteger(personId) || personId <= 0) return ok(res, []);
    return ok(res, await registers.companyLinesForPerson(pool, req.user.entityId, personId));
  } catch (e) { return sendError(res, next, e); }
}

module.exports = {
  KEYS, summary, list, detail, create, update, cctvStatus, backupChecks, addBackupCheck, gwsReviews, addGwsReview,
  phoneHolder, vendors, importPreview, importApply, personLines,
};
