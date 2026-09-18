const boardSvc = require('../services/board.service');
const { ok, fail } = require('../utils/response');

function svcError(e, res, next) {
  if ([400, 403, 404, 409].includes(e.status)) {
    const fallback =
      e.status === 403 ? 'FORBIDDEN' :
      e.status === 404 ? 'NOT_FOUND' :
      e.status === 409 ? 'CONFLICT' :
      'VALIDATION_ERROR';
    return fail(res, e.code || fallback, e.message, e.status);
  }
  return next(e);
}

async function list(req, res, next) {
  try {
    const rows = await boardSvc.listBoards({
      user: req.user,
      filters: {
        entityId: req.query.entityId ? Number(req.query.entityId) : undefined,
        departmentId: req.query.departmentId ? Number(req.query.departmentId) : undefined,
        activeOnly: req.query.activeOnly,
      },
    });
    return ok(res, rows);
  } catch (e) { return svcError(e, res, next); }
}

async function detail(req, res, next) {
  try {
    const r = await boardSvc.getBoardDetail({
      boardId: Number(req.params.id), user: req.user,
    });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

async function create(req, res, next) {
  try {
    const r = await boardSvc.createBoard({ user: req.user, input: req.body });
    return ok(res, r, undefined, 201);
  } catch (e) { return svcError(e, res, next); }
}

async function remove(req, res, next) {
  try {
    const r = await boardSvc.deleteBoard({
      boardId: Number(req.params.id), user: req.user,
    });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

async function listTasksByBoard(req, res, next) {
  try {
    const taskSvc = require('../services/task.service');
    const rows = await taskSvc.listTasksByBoard({
      boardId: Number(req.params.id),
      user: req.user,
      filters: {
        assigneeId: req.query.assigneeId ? Number(req.query.assigneeId) : undefined,
        priority: req.query.priority,
        status: req.query.status,
      },
    });
    return ok(res, rows);
  } catch (e) { return svcError(e, res, next); }
}

module.exports = { list, detail, create, remove, listTasksByBoard };