const { ok, fail } = require('../utils/response');
const svc = require('../services/notificationCenter.service');

function svcError(e, res, next) {
  if (e.status === 400) return fail(res, 'VALIDATION_ERROR', e.message, 400);
  if (e.status === 403) return fail(res, 'FORBIDDEN', e.message, 403);
  if (e.status === 404) return fail(res, 'NOT_FOUND', e.message, 404);
  return next(e);
}

/* ============================================================
   LIST
   ============================================================ */
async function list(req, res, next) {
  try {
    const result = await svc.listForUser({
      userId: req.user.sub,
      page: req.query.page,
      limit: req.query.limit,
      unread: req.query.unread,
      event: req.query.event,
      subjectType: req.query.subjectType,
      from: req.query.from,
      to: req.query.to,
    });
    return ok(res, result.rows, result.meta);
  } catch (e) { return svcError(e, res, next); }
}

/* ============================================================
   UNREAD COUNT
   ============================================================ */
async function unreadCount(req, res, next) {
  try {
    const count = await svc.getUnreadCount(req.user.sub);
    return ok(res, { count });
  } catch (e) { return svcError(e, res, next); }
}

/* ============================================================
   MARK READ / UNREAD
   ============================================================ */
async function markRead(req, res, next) {
  try {
    const r = await svc.markRead({ userId: req.user.sub, id: Number(req.params.id) });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

async function markUnread(req, res, next) {
  try {
    const r = await svc.markUnread({ userId: req.user.sub, id: Number(req.params.id) });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

async function markAllRead(req, res, next) {
  try {
    const r = await svc.markAllRead(req.user.sub);
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

/* ============================================================
   DISMISS ONE / CLEAR READ
   ============================================================ */
async function dismiss(req, res, next) {
  try {
    const r = await svc.dismiss({ userId: req.user.sub, id: Number(req.params.id) });
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

async function clearRead(req, res, next) {
  try {
    const r = await svc.clearRead(req.user.sub);
    return ok(res, r);
  } catch (e) { return svcError(e, res, next); }
}

module.exports = {
  list,
  unreadCount,
  markRead,
  markUnread,
  markAllRead,
  dismiss,
  clearRead,
};