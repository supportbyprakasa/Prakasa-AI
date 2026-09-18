const { fail } = require('../utils/response');

function hasCrossEntityAccess(req) {
  return (req.user?.permissions || []).includes('entity.cross_access');
}

function resolveEntityScope(req) {
  const requested = req.query?.entityId ?? req.body?.entityId ?? req.params?.entityId;
  const userEntityId = req.user?.entityId ? Number(req.user.entityId) : null;

  if (requested !== undefined && requested !== null && requested !== '') {
    const entityId = Number(requested);
    if (!Number.isInteger(entityId) || entityId <= 0) {
      const error = new Error('entityId tidak valid');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }

    if (!hasCrossEntityAccess(req) && (!userEntityId || entityId !== userEntityId)) {
      const error = new Error('Tidak punya akses ke entity ini');
      error.status = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }

    return {
      entityId,
      crossEntity: Boolean(userEntityId && entityId !== userEntityId),
    };
  }

  if (userEntityId) {
    return { entityId: userEntityId, crossEntity: false };
  }

  const error = new Error('entityId wajib');
  error.status = 400;
  error.code = 'VALIDATION_ERROR';
  throw error;
}

function requireEntityScope(req, res, next) {
  try {
    req.entityScope = resolveEntityScope(req);
    next();
  } catch (error) {
    return fail(
      res,
      error.code || 'FORBIDDEN',
      error.message,
      error.status || 403
    );
  }
}

function assertEntityAccess(req, row) {
  if (!row) {
    const error = new Error('Resource tidak ditemukan');
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  if (hasCrossEntityAccess(req)) return;

  const userEntityId = req.user?.entityId ? Number(req.user.entityId) : null;
  const rowEntityId = row.entity_id ?? row.entityId;
  if (!userEntityId || Number(rowEntityId) !== userEntityId) {
    const error = new Error('Tidak punya akses ke resource ini');
    error.status = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }
}

module.exports = {
  hasCrossEntityAccess,
  resolveEntityScope,
  requireEntityScope,
  assertEntityAccess,
};
