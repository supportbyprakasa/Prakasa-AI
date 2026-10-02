const { ok, fail } = require('../utils/response');
const taskAccess = require('../services/taskAccess.service');
const trackerReports = require('../services/trackerReports.service');
const escalation = require('../services/escalation.service');
const roadmap = require('../services/roadmap.service');
const targets = require('../services/targets.service');
const registry = require('../management/registry');
const { permitted, restrictedText } = require('../management/contract');
const { kpiValue } = require('../management/figureCache');
const { mapLimit } = require('../utils/mapLimit');

// KPIs asked at a time: the pool has five connections for every user.
const KPI_CONCURRENCY = 3;

/**
 * Management Dashboard summary: the headline number of every division module,
 * plus the most urgent escalations — both gathered from the management
 * providers, so a new module shows up here without touching this function.
 *
 * Entity-wide for management_dashboard.view; a division Head gets the same
 * page for their own division.
 */
async function summary(req, res, next) {
  try {
    const { entityId, departmentId } = resolveScope(req);
    const permissions = req.user?.permissions || [];
    const kpis = await mapLimit(registry.kpis(), KPI_CONCURRENCY, async (kpi) => {
      const meta = {
        provider: kpi.provider, providerLabel: kpi.providerLabel, key: kpi.key, label: kpi.label, unit: kpi.unit || null,
      };
      // A figure behind its own permission (purchase prices, P1) is not even
      // computed for a caller without it: the card only says why it is empty.
      if (!permitted(kpi, permissions)) {
        return { ...meta, value: null, sub: restrictedText(kpi), alert: false, error: false, restricted: true };
      }
      // One module failing must not blank the whole dashboard.
      try {
        const result = await kpiValue(kpi, entityId, { departmentId });
        return {
          ...meta,
          value: result?.value == null ? null : Number(result.value),
          sub: result?.sub || null,
          alert: Boolean(result?.alert),
          error: false,
          restricted: false,
        };
      } catch (error) {
        req.log?.warn?.({ err: error.message, kpi: `${kpi.provider}.${kpi.key}` }, 'management KPI failed');
        return { ...meta, value: null, sub: null, alert: false, error: true, restricted: false };
      }
    });
    const queue = await escalation.list(entityId, { departmentId, status: 'open', limit: 5 });
    return ok(res, {
      scope: queue.scope,
      kpis,
      topEscalations: queue.items,
      escalationTotals: queue.totals,
    });
  } catch (e) {
    if (e?.status && e?.code && e.status < 500) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
}

/**
 * Project Tracker · Live: read-only aggregates of every Chat-space project in
 * the entity (titles only, never issue descriptions or comments).
 *
 * management_dashboard.view sees the whole entity. A division Head holding only
 * management_dashboard.division sees their own division — and nothing at all if
 * they have no division, rather than silently falling back to everything.
 */
async function projects(req, res, next) {
  try {
    const { entityId, departmentId } = resolveScope(req);
    return ok(res, await trackerReports.managementProjects(entityId, { departmentId }));
  } catch (e) {
    if (e?.status && e?.code && e.status < 500) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
}

/**
 * Resolves what slice of the entity this caller may see. Entity-wide for
 * management_dashboard.view; otherwise their own division, and nothing at all
 * when they have none — never a silent fallback to everything.
 */
function resolveScope(req) {
  const entityId = taskAccess.resolveTargetEntity({ user: req.user, requestedEntityId: req.query.entityId });
  const entityWide = (req.user?.permissions || []).includes('management_dashboard.view');
  if (entityWide) return { entityId, departmentId: null };
  const departmentId = req.user?.departmentId ? Number(req.user.departmentId) : null;
  if (!departmentId) {
    const error = new Error('Akun Anda belum terhubung ke divisi mana pun.');
    error.status = 403;
    error.code = 'NO_DEPARTMENT';
    throw error;
  }
  return { entityId, departmentId };
}

/**
 * Pusat Eskalasi: everything past its deadline across modules, computed live.
 */
async function escalations(req, res, next) {
  try {
    const { entityId, departmentId } = resolveScope(req);
    const data = await escalation.list(entityId, {
      departmentId,
      status: req.query.status ? String(req.query.status) : 'open',
      source: req.query.source ? String(req.query.source) : null,
    });
    return ok(res, data);
  } catch (e) {
    if (e?.status && e?.code && e.status < 500) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
}

/**
 * Records who is handling one breach and what they noted. The breach itself is
 * derived, so only this follow-up is stored.
 */
async function saveEscalation(req, res, next) {
  try {
    const { departmentId } = resolveScope(req);
    const followup = await escalation.saveFollowup(req.user, {
      source: String(req.params.source || ''),
      sourceId: req.params.sourceId,
      departmentId,
      status: req.body?.status,
      ownerUserId: req.body?.ownerUserId,
      note: req.body?.note,
    });
    return ok(res, { followup });
  } catch (e) {
    if (e?.status && e?.code && e.status < 500) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
}

/**
 * Peta Program: every project of the entity on one timeline, grouped by division.
 */
async function roadmapView(req, res, next) {
  try {
    const { entityId, departmentId } = resolveScope(req);
    const data = await roadmap.get(entityId, {
      departmentId,
      from: req.query.from ? String(req.query.from) : null,
      to: req.query.to ? String(req.query.to) : null,
    });
    return ok(res, data);
  } catch (e) {
    if (e?.status && e?.code && e.status < 500) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
}

/**
 * Target & realisasi: stored targets next to live actuals, per division.
 * Everyone who may read the portfolio may read this; only the entity-wide
 * view may SET targets — a division Head does not grade their own division.
 * A metric behind its own permission (purchase prices) is left out for a
 * caller without it.
 */
async function targetsView(req, res, next) {
  try {
    const { entityId, departmentId } = resolveScope(req);
    const permissions = req.user?.permissions || [];
    const canEdit = permissions.includes('management_dashboard.view');
    return ok(res, await targets.list(entityId, {
      departmentId,
      period: req.query.period ? String(req.query.period) : null,
      canEdit,
      permissions,
    }));
  } catch (e) {
    if (e?.status && e?.code && e.status < 500) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
}

async function saveTarget(req, res, next) {
  try {
    const cell = await targets.save(req.user, {
      departmentId: req.body?.departmentId,
      metricKey: req.body?.metricKey,
      period: req.body?.period,
      targetValue: req.body?.targetValue,
      note: req.body?.note,
    });
    return ok(res, { target: cell });
  } catch (e) {
    if (e?.status && e?.code && e.status < 500) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
}

module.exports = {
  summary, projects, escalations, saveEscalation, roadmap: roadmapView, targets: targetsView, saveTarget,
};
