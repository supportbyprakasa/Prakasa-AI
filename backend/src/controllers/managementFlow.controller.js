const { ok, fail } = require('../utils/response');
const taskAccess = require('../services/taskAccess.service');
const rules = require('../services/flowRules');
const flow = require('../services/managementFlow.service');
const prices = require('../services/procurementPrices.service');
const marginModel = require('../services/marginModel');

// Alur & Margin (program 3.3, Management): four read-only endpoints under
// /management-dashboard. Every route demands management_dashboard.view, so the
// page is entity-wide (no division scope); the margin also needs
// procurement.price.view and the slow movers warehouse.stock.view (checked on
// the route, and the margin again here). Prakasa AI never reads these.

const can = (req, code) => (req.user?.permissions || []).includes(code);
const entityOf = (req) => taskAccess.resolveTargetEntity({ user: req.user, requestedEntityId: req.query.entityId });

function handle(req, res, next, label) {
  return (e) => {
    if (e?.status && e?.code && e.status < 500) return fail(res, e.code, e.message, e.status);
    req.log?.warn?.({ err: e?.message }, `management flow ${label} failed`);
    return next(e);
  };
}

async function salesFlow(req, res, next) {
  try {
    const entityId = entityOf(req);
    const period = rules.parsePeriod(req.query);
    return ok(res, await flow.salesFlow(entityId, period));
  } catch (e) { return handle(req, res, next, 'sales')(e); }
}

async function purchaseFlow(req, res, next) {
  try {
    const entityId = entityOf(req);
    const period = rules.parsePeriod(req.query);
    return ok(res, await flow.purchaseFlow(entityId, period));
  } catch (e) { return handle(req, res, next, 'purchase')(e); }
}

// Perkiraan margin (harga PO): management AND purchase prices (P1).
async function margin(req, res, next) {
  try {
    if (!can(req, 'management_dashboard.view') || !can(req, 'procurement.price.view')) {
      return fail(res, 'FORBIDDEN', 'Perkiraan margin hanya untuk manajemen yang berwenang melihat harga beli.', 403);
    }
    const entityId = entityOf(req);
    const period = rules.parsePeriod(req.query);
    const divisions = await flow.marginDivisions(entityId);
    const departmentId = req.query.departmentId == null || req.query.departmentId === '' ? null : Number(req.query.departmentId);
    if (departmentId !== null && !divisions.some((d) => d.id === departmentId)) {
      return fail(res, 'VALIDATION_ERROR', 'Divisi harus Sales atau Retail Commerce.', 400);
    }
    const [rows, context, pending] = await Promise.all([
      prices.marginLines(entityId, { ...period, departmentId }, { prices: true }),
      flow.marginContext(entityId, period, departmentId),
      flow.pendingDivisions(entityId),
    ]);
    return ok(res, {
      period,
      departmentId,
      pending,
      divisionOptions: divisions,
      basis: 'po_price_estimate',
      lowCoveragePct: rules.LOW_COVERAGE_PCT,
      ...marginModel.aggregateMargin(rows, { context, divisionNames: new Map(divisions.map((d) => [d.id, d.name])) }),
    });
  } catch (e) { return handle(req, res, next, 'margin')(e); }
}

// Barang lambat laku: quantities for management with stock view (D2); the
// rupiah value only for price viewers (P1).
async function slowMovers(req, res, next) {
  try {
    if (!can(req, 'management_dashboard.view') || !can(req, 'warehouse.stock.view')) {
      return fail(res, 'FORBIDDEN', 'Barang lambat laku hanya untuk manajemen yang berwenang melihat stok.', 403);
    }
    const entityId = entityOf(req);
    return ok(res, await flow.slowMovers(entityId, { prices: can(req, 'procurement.price.view') }));
  } catch (e) { return handle(req, res, next, 'slow movers')(e); }
}

module.exports = { salesFlow, purchaseFlow, margin, slowMovers };
