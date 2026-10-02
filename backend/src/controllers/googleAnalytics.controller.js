const { ok, fail } = require('../utils/response');
const { handleGoogleError } = require('../services/googleUserClient');
const analytics = require('../services/googleAnalytics.service');

const ctxOf = (req) => ({ entityId: req.user.entityId, userId: req.user.sub });
const message = (error) => String(error?.response?.data?.error?.message || error?.message || '');

// Setup problems are an expected state (the page shows setup steps), not an
// error: they come back as 200 { ready: false, reason }.
function setupReason(error) {
  const text = message(error);
  if (/has not been used in project|is disabled|SERVICE_DISABLED/i.test(text)) return 'API_DISABLED';
  const status = Number(error?.status || error?.code || error?.response?.status);
  if (/unauthorized_client|invalid_grant|insufficient permissions|PERMISSION_DENIED/i.test(text) || status === 401 || status === 403) {
    return 'NO_ACCESS';
  }
  return null;
}

async function status(req, res, next) {
  const setup = analytics.setupStatus();
  if (!setup.serviceAccountConfigured) {
    return ok(res, { ...setup, ready: false, reason: 'NOT_CONFIGURED', properties: [] });
  }
  try {
    const properties = await analytics.listProperties(ctxOf(req));
    return ok(res, {
      ...setup,
      ready: properties.length > 0,
      reason: properties.length ? null : 'NO_PROPERTIES',
      properties,
    });
  } catch (error) {
    const reason = setupReason(error);
    if (reason) return ok(res, { ...setup, ready: false, reason, properties: [] });
    return handleGoogleError(error, res, next, { service: 'Google Analytics' });
  }
}

async function report(req, res, next) {
  const { property } = req.query;
  if (!analytics.isValidPropertyId(property)) return fail(res, 'VALIDATION_ERROR', 'Properti tidak valid', 400);
  const range = analytics.resolveRange({ range: req.query.range, start: req.query.start, end: req.query.end });
  if (range.error) return fail(res, 'VALIDATION_ERROR', range.error, 400);
  try {
    // Only properties the service account actually lists — never an arbitrary id.
    const properties = await analytics.listProperties(ctxOf(req));
    if (!properties.some((item) => item.id === property)) {
      return fail(res, 'NOT_FOUND', 'Properti Google Analytics tidak ditemukan.', 404);
    }
    const data = await analytics.runReport(property, range, ctxOf(req));
    return ok(res, data);
  } catch (error) {
    return handleGoogleError(error, res, next, { service: 'Google Analytics' });
  }
}

module.exports = { status, report, setupReason };
