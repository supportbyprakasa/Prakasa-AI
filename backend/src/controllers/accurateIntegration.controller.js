const { ok, fail } = require('../utils/response');
const accurate = require('../services/accurate/accurateConnection.service');

// "Integrasi Accurate" admin endpoints. Read-only integration: nothing here
// ever writes to Accurate, and no response ever carries a token.

function handleError(error, res, next) {
  if (error instanceof accurate.AccurateConnectionError || error.status) {
    return fail(res, error.code || 'VALIDATION_ERROR', error.message, error.status || 400);
  }
  return next(error);
}

// The callback URL this API answers on, for the credentials form to suggest.
const suggestedRedirectUri = (req) => `${req.protocol}://${req.get('host')}${accurate.CALLBACK_PATH}`;

async function status(req, res, next) {
  try {
    return ok(res, { ...(await accurate.getStatus(req.user.entityId)), suggestedRedirectUri: suggestedRedirectUri(req) });
  } catch (error) {
    return handleError(error, res, next);
  }
}

async function saveCredentials(req, res, next) {
  try {
    const result = await accurate.saveCredentials({
      clientId: req.body?.clientId, clientSecret: req.body?.clientSecret, redirectUri: req.body?.redirectUri,
      entityId: req.user.entityId, userId: req.user.sub,
    });
    return ok(res, { ...result, suggestedRedirectUri: suggestedRedirectUri(req) });
  } catch (error) {
    return handleError(error, res, next);
  }
}

async function connect(req, res, next) {
  try {
    return ok(res, await accurate.startConnect({ entityId: req.user.entityId, userId: req.user.sub }));
  } catch (error) {
    return handleError(error, res, next);
  }
}

// Public: Accurate sends the browser here. Always answers with a redirect to
// the admin page carrying only ?accurate=connected|error&reason=<code>.
async function callback(req, res) {
  const target = await accurate.handleCallback({ query: req.query || {} });
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  return res.redirect(302, target);
}

async function refresh(req, res, next) {
  try {
    return ok(res, await accurate.refresh({ entityId: req.user.entityId, userId: req.user.sub }));
  } catch (error) {
    return handleError(error, res, next);
  }
}

async function disconnect(req, res, next) {
  try {
    return ok(res, await accurate.disconnect({ entityId: req.user.entityId, userId: req.user.sub }));
  } catch (error) {
    return handleError(error, res, next);
  }
}

module.exports = { status, connect, callback, refresh, disconnect, saveCredentials };
