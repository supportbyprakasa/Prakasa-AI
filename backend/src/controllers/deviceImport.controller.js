const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const importer = require('../services/itAssetImport.service');
const { ImportError } = require('../services/itAssetImportModel');
const { DirectoryError } = require('../services/peopleDirectory.service');
const { DeviceError } = require('../services/deviceLifecycle.service');

// IT → Perangkat → Impor dari Excel (the owner's device report layout only).
// device.manage guards the route; when the "User List" sheet is sent along,
// its people are written to the directory, which needs people.directory.manage too.

const may = (req, code) => (req.user?.permissions || []).includes(code);

function guardPeople(req, res) {
  if (req.body.people && !may(req, 'people.directory.manage')) {
    fail(res, 'FORBIDDEN', 'Sheet "User List" mengubah direktori: butuh izin kelola direktori People & Culture. Kirim tanpa sheet itu.', 403);
    return false;
  }
  return true;
}

function handle(res, next, e) {
  if (e instanceof ImportError || e instanceof DirectoryError || e instanceof DeviceError) {
    return fail(res, e.code, e.message, e.status);
  }
  return next(e);
}

async function preview(req, res, next) {
  try {
    if (!guardPeople(req, res)) return undefined;
    const plan = await importer.preview(req.user.entityId, {
      devices: req.body.devices,
      people: req.body.people || null,
      createLocations: req.body.createLocations,
      personChoices: req.body.personChoices,
    });
    return ok(res, plan);
  } catch (e) { return handle(res, next, e); }
}

async function apply(req, res, next) {
  if (!guardPeople(req, res)) return undefined;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await importer.apply(conn, { entityId: req.user.entityId, actorId: req.user.sub, payload: req.body });
    await conn.commit();
    return ok(res, out);
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    return handle(res, next, e);
  } finally { conn.release(); }
}

module.exports = { preview, apply };
