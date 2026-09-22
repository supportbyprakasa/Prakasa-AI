const { ok, fail } = require('../utils/response');
const searchSvc = require('../services/globalSearch.service');

/**
 * GET /api/v1/search
 *
 * Query:
 *   q         (required, 2..200 chars)
 *   entityId  (optional; cross-entity requires entity.cross_access)
 *   type      (optional; comma-separated or array; whitelisted)
 *   page      (optional, >=1)
 *   limit     (optional, 1..50)
 */
async function search(req, res, next) {
  try {
    const { q, entityId, type, page, limit } = req.query;

    // Normalize type param: accept "task,device" or ["task","device"].
    let types = null;
    if (type != null && type !== '') {
      if (Array.isArray(type)) types = type.flatMap((t) => String(t).split(','));
      else types = String(type).split(',');
      types = types.map((t) => t.trim()).filter(Boolean);
    }

    const result = await searchSvc.search({
      user: req.user,
      q,
      entityId: entityId != null && entityId !== '' ? Number(entityId) : null,
      types,
      page: page != null ? Number(page) : 1,
      limit: limit != null ? Number(limit) : 20,
    });

    return ok(res, result.rows, result.meta);
  } catch (e) {
    if (e.status === 400) return fail(res, 'VALIDATION_ERROR', e.message, 400);
    if (e.status === 403) return fail(res, 'FORBIDDEN', e.message, 403);
    next(e);
  }
}

module.exports = { search };