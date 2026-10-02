const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const directory = require('../services/peopleDirectory.service');
const importer = require('../services/itAssetImport.service');
const { ImportError } = require('../services/itAssetImportModel');

// People & Culture → Direktori. Always the signed-in user's entity.
// people.directory.view: work contacts; people.directory.manage: everything.

const canManage = (req) => (req.user?.permissions || []).includes('people.directory.manage');

function handle(res, next, e) {
  if (e instanceof directory.DirectoryError || e instanceof ImportError) {
    return fail(res, e.code, e.message, e.status, e.details);
  }
  return next(e);
}

async function list(req, res, next) {
  try {
    const out = await directory.list(req.user.entityId, req.query || {}, { canManage: canManage(req) });
    return ok(res, out.rows, out.meta);
  } catch (e) { return handle(res, next, e); }
}

async function summary(req, res, next) {
  try {
    const out = await directory.summary(req.user.entityId);
    if (!canManage(req)) { delete out.resigned; delete out.excluded; }
    return ok(res, out);
  } catch (e) { return handle(res, next, e); }
}

async function detail(req, res, next) {
  try {
    const out = await directory.detail(req.user.entityId, req.params.key, { canManage: canManage(req) });
    if (!out) return fail(res, 'NOT_FOUND', 'Orang tidak ditemukan di direktori', 404);
    // The running onboarding/offboarding of this person, for People & Culture only (wave 2).
    if ((req.user?.permissions || []).includes('hrga.view')) {
      out.runningWorkflow = await require('../services/hrgaWorkflow.service').runningWorkflowForPerson(req.user.entityId, out.personId);
    }
    return ok(res, out);
  } catch (e) { return handle(res, next, e); }
}

async function org(req, res, next) {
  try {
    return ok(res, await directory.orgChart(req.user.entityId, { departmentId: req.query.departmentId || null }));
  } catch (e) { return handle(res, next, e); }
}

async function create(req, res, next) {
  try {
    const out = await directory.createPerson(req.user.entityId, req.user.sub, req.body);
    return ok(res, out, undefined, 201);
  } catch (e) { return handle(res, next, e); }
}

async function update(req, res, next) {
  try {
    const out = await directory.update(req.user.entityId, req.user.sub, req.params.key, req.body);
    return ok(res, out);
  } catch (e) { return handle(res, next, e); }
}

// ---------------------------------------------------------------- import
// The directory import reads only the report's "User List" sheet.

async function importPreview(req, res, next) {
  try {
    const plan = await importer.preview(req.user.entityId, {
      people: req.body.people, devices: null, personChoices: req.body.personChoices,
    });
    return ok(res, plan);
  } catch (e) { return handle(res, next, e); }
}

async function importApply(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await importer.apply(conn, {
      entityId: req.user.entityId,
      actorId: req.user.sub,
      payload: { ...req.body, devices: null, createLocations: false },
    });
    await conn.commit();
    return ok(res, out);
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    return handle(res, next, e);
  } finally { conn.release(); }
}

module.exports = { list, summary, detail, org, create, update, importPreview, importApply, canManage };
