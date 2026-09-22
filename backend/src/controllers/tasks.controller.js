const taskSvc = require('../services/task.service');
const checklistSvc = require('../services/taskChecklist.service');
const watcherSvc = require('../services/taskWatcher.service');
const dependencySvc = require('../services/taskDependency.service');
const dependencyGraphSvc = require('../services/taskDependencyGraph.service');
const taskActivity = require('../services/taskActivity.service');
const taskAccess = require('../services/taskAccess.service');
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

/* ============================================================
   Task CRUD
   ============================================================ */

async function listByBoard(req, res, next) {
  try {
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

async function detail(req, res, next) {
  try {
    const data = await taskSvc.getTaskDetail({
      taskId: Number(req.params.id), user: req.user,
    });
    return ok(res, data);
  } catch (e) { return svcError(e, res, next); }
}

async function create(req, res, next) {
  try {
    // Public POST: entityId allowed but validated by service.
    // sourceType from body is IGNORED (forced to 'manual').
    const r = await taskSvc.createTask({
      input: req.body,
      user: req.user,
      trustedSource: null,
    });
    return ok(res, { id: r.id }, undefined, 201);
  } catch (e) { return svcError(e, res, next); }
}

async function update(req, res, next) {
  try {
    const r = await taskSvc.updateTask({
      taskId: Number(req.params.id),
      patch: req.body,
      user: req.user,
    });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

async function remove(req, res, next) {
  try {
    const r = await taskSvc.deleteTask({
      taskId: Number(req.params.id), user: req.user,
    });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

async function addComment(req, res, next) {
  try {
    const r = await taskSvc.addComment({
      taskId: Number(req.params.id), user: req.user, body: req.body.body,
    });
    return ok(res, r, undefined, 201);
  } catch (e) { return svcError(e, res, next); }
}

/* ============================================================
   Activity
   ============================================================ */

async function listActivity(req, res, next) {
  try {
    const task = await taskAccess.loadTask(Number(req.params.id));
    if (!task) return fail(res, 'NOT_FOUND', 'Task tidak ditemukan', 404);
    taskAccess.assertTaskAccess({ user: req.user, task, action: 'view' });
    const r = await taskActivity.list({
      taskId: task.id,
      page: Math.max(1, parseInt(req.query.page) || 1),
      limit: Math.min(200, parseInt(req.query.limit) || 50),
    });
    return ok(res, r.rows, { page: r.page, limit: r.limit, total: r.total });
  } catch (e) { return svcError(e, res, next); }
}

/* ============================================================
   Watchers
   ============================================================ */

async function listWatchers(req, res, next) {
  try {
    const task = await taskAccess.loadTask(Number(req.params.id));
    const r = await watcherSvc.list({ task, user: req.user });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

async function addWatcher(req, res, next) {
  try {
    const task = await taskAccess.loadTask(Number(req.params.id));
    const userId = req.body.userId ? Number(req.body.userId) : req.user.sub;
    const r = await watcherSvc.add({ task, user: req.user, targetUserId: userId });
    return ok(res, r, undefined, 201);
  } catch (e) { return svcError(e, res, next); }
}

async function removeWatcher(req, res, next) {
  try {
    const task = await taskAccess.loadTask(Number(req.params.id));
    const r = await watcherSvc.remove({
      task, user: req.user, targetUserId: Number(req.params.userId),
    });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

/* ============================================================
   Checklist
   ============================================================ */

async function listChecklist(req, res, next) {
  try {
    const task = await taskAccess.loadTask(Number(req.params.id));
    const r = await checklistSvc.list({ task, user: req.user });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

async function addChecklistItem(req, res, next) {
  try {
    const task = await taskAccess.loadTask(Number(req.params.id));
    const r = await checklistSvc.create({
      task, user: req.user, title: req.body.title, position: req.body.position,
    });
    return ok(res, r, undefined, 201);
  } catch (e) { return svcError(e, res, next); }
}

async function patchChecklistItem(req, res, next) {
  try {
    const task = await taskAccess.loadTask(Number(req.params.id));
    const r = await checklistSvc.patch({
      task,
      user: req.user,
      itemId: Number(req.params.itemId),
      changes: req.body,
    });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

async function removeChecklistItem(req, res, next) {
  try {
    const task = await taskAccess.loadTask(Number(req.params.id));
    const r = await checklistSvc.remove({
      task, user: req.user, itemId: Number(req.params.itemId),
    });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

async function reorderChecklist(req, res, next) {
  try {
    const task = await taskAccess.loadTask(Number(req.params.id));
    const r = await checklistSvc.reorder({
      task, user: req.user, orderedIds: req.body.orderedIds,
    });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

/* ============================================================
   Dependencies
   ============================================================ */

async function listDependencies(req, res, next) {
  try {
    const task = await taskAccess.loadTask(Number(req.params.id));
    const r = await dependencySvc.list({ task, user: req.user });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

async function dependencyGraph(req, res, next) {
  try {
    const r = await dependencyGraphSvc.buildGraph({
      taskId: Number(req.params.id),
      user: req.user,
      depth: req.query.depth ? Number(req.query.depth) : undefined,
    });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

async function addDependency(req, res, next) {
  try {
    const task = await taskAccess.loadTask(Number(req.params.id));
    const r = await dependencySvc.add({
      task, user: req.user,
      predecessorTaskId: req.body.predecessorTaskId,
      successorTaskId: req.body.successorTaskId,
      dependencyType: req.body.dependencyType,
    });
    return ok(res, r, undefined, 201);
  } catch (e) { return svcError(e, res, next); }
}

async function removeDependency(req, res, next) {
  try {
    const task = await taskAccess.loadTask(Number(req.params.id));
    const r = await dependencySvc.remove({
      task, user: req.user, dependencyId: Number(req.params.dependencyId),
    });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

module.exports = {
  listByBoard, detail, create, update, remove, addComment,
  listActivity,
  listWatchers, addWatcher, removeWatcher,
  listChecklist, addChecklistItem, patchChecklistItem,
  removeChecklistItem, reorderChecklist,
  listDependencies, dependencyGraph, addDependency, removeDependency,
};