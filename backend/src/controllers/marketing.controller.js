const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const insightsService = require('../services/marketingInsights.service');
const campaigns = require('../services/marketingCampaigns.service');

// /marketing/* — the Marketing module of the signed-in user's entity
// (migration 119). The entity is always req.user.entityId; every campaign
// write runs in one transaction with its activity log.

function sendError(res, next, e) {
  if (e instanceof campaigns.CampaignError || e instanceof insightsService.MarketingError) {
    return fail(res, e.code, e.message, e.status, e.details);
  }
  return next(e);
}

async function inTransaction(res, next, fn, status = 200) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const data = await fn(conn);
    await conn.commit();
    return ok(res, data, undefined, status);
  } catch (e) {
    try { await conn.rollback(); } catch { /* noop */ }
    return sendError(res, next, e);
  } finally {
    conn.release();
  }
}

const idParam = (req) => {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// ------------------------------------------------------------ Produk & channel
async function insights(req, res, next) {
  try {
    return ok(res, await insightsService.insights(req.user.entityId, { month: req.query.month }));
  } catch (e) { return sendError(res, next, e); }
}

// Web sessions from GA4: only for those who may read Analytics. Any setup
// problem is a normal answer ({ available: false }), the card just hides.
async function webSessions(req, res, next) {
  try {
    if (!(req.user.permissions || []).includes('analytics.view')) return ok(res, { available: false, reason: 'NO_PERMISSION' });
    // Validate the month first, so a bad one is a 400 like /insights.
    insightsService.resolveMonth(req.query.month);
    return ok(res, await insightsService.webSessions(req.user.entityId, { month: req.query.month, userId: req.user.sub }));
  } catch (e) { return sendError(res, next, e); }
}

async function items(req, res, next) {
  try {
    return ok(res, await insightsService.searchItems(req.user.entityId, req.query.q));
  } catch (e) { return sendError(res, next, e); }
}

// ------------------------------------------------------------ Kampanye
async function listCampaigns(req, res, next) {
  try {
    const rows = await campaigns.listCampaigns(pool, req.user.entityId);
    return ok(res, rows, { total: rows.length, summary: await campaigns.summary(pool, req.user.entityId) });
  } catch (e) { return sendError(res, next, e); }
}

async function getCampaign(req, res, next) {
  const id = idParam(req);
  if (!id) return fail(res, 'NOT_FOUND', 'Kampanye tidak ditemukan', 404);
  try {
    return ok(res, await campaigns.getCampaignWithPerformance(pool, req.user.entityId, id));
  } catch (e) { return sendError(res, next, e); }
}

function createCampaign(req, res, next) {
  return inTransaction(res, next, async (conn) => {
    const id = await campaigns.createCampaign(conn, { entityId: req.user.entityId, userId: req.user.sub, body: req.body });
    return campaigns.getCampaign(conn, req.user.entityId, id);
  }, 201);
}

function updateCampaign(req, res, next) {
  const id = idParam(req);
  if (!id) return fail(res, 'NOT_FOUND', 'Kampanye tidak ditemukan', 404);
  return inTransaction(res, next, async (conn) => {
    const result = await campaigns.updateCampaign(conn, { entityId: req.user.entityId, userId: req.user.sub, id, body: req.body });
    return { ...(await campaigns.getCampaign(conn, req.user.entityId, id)), changed: result.changed };
  });
}

module.exports = { insights, webSessions, items, listCampaigns, getCampaign, createCampaign, updateCampaign };
