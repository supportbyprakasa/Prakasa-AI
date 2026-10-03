const { ok, fail } = require('../utils/response');
const { handleGoogleError } = require('../services/googleUserClient');
const tracker = require('../services/tracker.service');
const trackerReports = require('../services/trackerReports.service');

// Project Tracker per Google Chat space. Every handler re-derives access from
// the path id (entity + Chat membership as the signed-in user); nothing about
// space membership or entity is taken from the client.
const SERVICE = { service: 'Google Chat' };

const isGoogleError = (error) => Boolean(error?.response || error?.config || error?.errors);

function handle(error, res, next) {
  if (!isGoogleError(error) && typeof error?.status === 'number' && typeof error?.code === 'string' && error.status < 500) {
    return fail(res, error.code, error.message, error.status);
  }
  if (error?.appCode) return fail(res, error.appCode, error.message, error.appStatus || 403);
  if (error?.code === 'ER_DUP_ENTRY') return fail(res, 'CONFLICT', 'Data bentrok dengan perubahan lain. Coba lagi.', 409);
  if (isGoogleError(error)) return handleGoogleError(error, res, next, SERVICE);
  return next(error);
}

const route = (fn, status = 200) => async (req, res, next) => {
  try {
    const data = await fn(req);
    return ok(res, data, undefined, status);
  } catch (error) {
    return handle(error, res, next);
  }
};

const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

module.exports = {
  listProjects: route((req) => tracker.listProjects(req.user)),
  getSpaceProject: route((req) => tracker.getSpaceProject(req.user, req.params.spaceId)),
  enableProject: route((req) => tracker.enableProject(req.user, req.params.spaceId, body(req)), 201),
  updateProject: route((req) => tracker.updateProject(req.user, req.params.projectId, body(req))),
  listIssues: route((req) => tracker.listIssues(req.user, req.params.projectId, req.query || {})),
  createIssue: route((req) => tracker.createIssue(req.user, req.params.projectId, body(req)), 201),
  getIssue: route((req) => tracker.getIssue(req.user, req.params.issueId)),
  updateIssue: route((req) => tracker.updateIssue(req.user, req.params.issueId, body(req))),
  deleteIssue: route((req) => tracker.deleteIssue(req.user, req.params.issueId)),
  addComment: route((req) => tracker.addComment(req.user, req.params.issueId, body(req)), 201),
  createSprint: route((req) => tracker.createSprint(req.user, req.params.projectId, body(req)), 201),
  updateSprint: route((req) => tracker.updateSprint(req.user, req.params.sprintId, body(req))),
  getReports: route((req) => trackerReports.getReports(req.user, req.params.projectId, req.query || {})),
  handle,
};
