const { ok, fail } = require('../utils/response');
const movements = require('../services/warehouseMovement.service');

function handle(fn) {
  return async (req, res, next) => {
    try {
      return await fn(req, res);
    } catch (error) {
      if (error.status) return fail(res, error.code || 'VALIDATION_ERROR', error.message, error.status);
      return next(error);
    }
  };
}

const list = handle(async (req, res) => {
  const result = await movements.list({ user: req.user, ...req.query });
  return ok(res, result.rows, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    statusesVisible: result.statusesVisible,
  });
});

const detail = handle(async (req, res) => ok(res, await movements.get({
  user: req.user, type: req.params.type, id: req.params.id,
})));

const create = handle(async (req, res) => {
  const { type, ...input } = req.body;
  return ok(res, await movements.create({ user: req.user, type, input }), undefined, 201);
});

const update = handle(async (req, res) => {
  const { version, ...input } = req.body;
  return ok(res, await movements.updateDraft({
    user: req.user, type: req.params.type, id: req.params.id, input, version,
  }));
});

const submit = handle(async (req, res) => ok(res, await movements.submit({
  user: req.user, type: req.params.type, id: req.params.id, version: req.body?.version ?? null,
})));

const cancel = handle(async (req, res) => ok(res, await movements.cancel({
  user: req.user, type: req.params.type, id: req.params.id,
  reason: req.body.reason, version: req.body.version ?? null,
})));

const audit = handle(async (req, res) => ok(res, await movements.audit({
  user: req.user, type: req.params.type, id: req.params.id,
})));

module.exports = { list, detail, create, update, submit, cancel, audit };
