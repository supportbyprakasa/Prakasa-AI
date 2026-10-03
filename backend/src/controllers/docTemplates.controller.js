const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const docs = require('../services/docTemplates.service');
const bast = require('../services/bast.service');

// /doc-templates — template dokumen, kop & footer per divisi, and documents
// made from templates (migration 115); BAST for devices and company numbers.

function sendError(res, next, e) {
  if (e instanceof docs.DocTemplateError) return fail(res, e.code, e.message, e.status, e.details);
  if (e?.code === 'GOOGLE_DRIVE_NOT_CONFIGURED') return fail(res, e.code, e.message, 503);
  if (e?.code === 'SEQUENCE_BUSY') return fail(res, e.code, e.message, 503);
  return next(e);
}
const handle = (fn, status = 200) => async (req, res, next) => {
  try { return ok(res, await fn(req), undefined, status); } catch (e) { return sendError(res, next, e); }
};
const idParam = (req) => Number(req.params.id);
// ':scope' is 'company' (the whole company) or a department id.
const scopeOf = (req) => (req.params.scope === 'company' ? null : Number(req.params.scope));

module.exports = {
  list: handle((req) => docs.listTemplates(pool, req.user)),
  prepareBuiltins: handle((req) => docs.prepareBuiltins(req.user), 201),
  create: handle((req) => docs.createTemplate(req.user, req.body), 201),
  update: handle((req) => docs.updateTemplate(req.user, idParam(req), req.body)),
  check: handle((req) => docs.checkTemplate(req.user, idParam(req))),
  generate: handle((req) => docs.generate(req.user, { templateId: idParam(req), departmentId: req.body.departmentId ?? null, values: req.body.values, title: req.body.title }), 201),
  kops: handle((req) => docs.listKops(pool, req.user)),
  saveKop: handle((req) => docs.saveKop(req.user, scopeOf(req), req.body)),
  kopLogo: handle(async (req) => (await docs.kopLogo(req.user, scopeOf(req))) || { mimeType: null, base64: null }),
  generated: handle((req) => docs.listGenerated(pool, req.user, {
    subjectType: req.query.subjectType || null,
    subjectIds: req.query.subjectIds ? String(req.query.subjectIds).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0) : null,
  })),
  deviceBast: handle((req) => bast.makeDeviceBast(req.user, idParam(req), req.body), 201),
  phoneBast: handle((req) => bast.makePhoneBast(req.user, idParam(req), req.body), 201),
  bastOptions: handle(async (req) => {
    const [staff] = await pool.query(
      `SELECT u.id, u.name, p.position FROM users u
         JOIN departments d ON d.id = u.department_id AND d.code = 'people_culture'
         LEFT JOIN people_directory p ON p.entity_id = u.entity_id AND p.user_id = u.id
        WHERE u.entity_id = ? AND u.status = 'active' AND u.deleted_at IS NULL ORDER BY u.name`,
      [req.user.entityId],
    );
    const [[setting]] = await pool.query("SELECT value FROM settings WHERE entity_id = ? AND `key` = 'people_culture.pic' LIMIT 1", [req.user.entityId]);
    let pic = setting?.value;
    if (typeof pic === 'string') { try { pic = JSON.parse(pic); } catch { pic = null; } }
    return {
      staff: staff.map((s) => ({ id: Number(s.id), name: s.name, position: s.position || null })),
      pic: { itUserId: Number(pic?.itUserId) || null, gaUserId: Number(pic?.gaUserId) || null },
    };
  }),
};
