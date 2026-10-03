const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const records = require('../services/salesRecords.service');
const simplidots = require('../services/simplidotsImport.service');
const { log } = require('../services/activityLog.service');
const { ownScope } = require('../services/salesOwners.service');
const { LEAD_FOLLOWUP_DAYS } = require('../services/salesStatus');
const { paging, searchClause, int, positiveId } = require('../services/salesQuery');

// Leads: outlets the field team visits that are not customers yet. Added,
// visited and converted in the app; the list pages on the server.

const LEAD_FILTERS = {
  open: "l.customer_id IS NULL AND l.status = 'open'",
  needs_visit: `l.customer_id IS NULL AND l.status = 'open' AND (l.last_visit_date IS NULL OR DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), l.last_visit_date) >= ${LEAD_FOLLOWUP_DAYS})`,
  converted: 'l.customer_id IS NOT NULL',
  dropped: "l.customer_id IS NULL AND l.status = 'dropped'",
};

function handle(fn) {
  return async (req, res, next) => {
    try {
      return await fn(req, res);
    } catch (e) {
      if (e.status && e.code) return fail(res, e.code, e.message, e.status);
      return next(e);
    }
  };
}

const idOf = (req) => positiveId(req.params.id);

const listLeads = handle(async (req, res) => {
  const filter = req.query.status || 'open';
  if (filter !== 'all' && !LEAD_FILTERS[filter]) return fail(res, 'VALIDATION_ERROR', 'status tidak dikenal', 400);
  const ls = ownScope(req.user, 'lead', 'l.id');
  const base = `l.entity_id = ?${ls.sql} AND l.deleted_at IS NULL`;
  const baseArgs = [req.user.entityId, ...ls.args];
  const s = searchClause(req.query.q, ['l.name', 'l.outlet_code', 'l.area', 'l.address', 'l.sales_person_name']);
  const where = `${base}${filter !== 'all' ? ` AND ${LEAD_FILTERS[filter]}` : ''}${s.sql}`;
  const args = [...baseArgs, ...s.args];
  const { page, limit, offset } = paging(req.query);
  const [rows] = await pool.query(
    `SELECT l.id, l.outlet_code AS outletCode, l.name, l.address, l.area, l.latitude, l.longitude,
            l.sales_person_name AS salesPersonName, l.owner_user_id AS ownerUserId, l.first_visit_date AS firstVisitDate,
            l.last_visit_date AS lastVisitDate, l.visit_count AS visitCount, l.last_note AS lastNote,
            l.status, l.customer_id AS customerId, c.name AS customerName, c.customer_code AS customerCode,
            DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), l.last_visit_date) AS daysSinceVisit
       FROM sales_leads l LEFT JOIN sales_customers c ON c.id = l.customer_id
      WHERE ${where}
      ORDER BY l.last_visit_date IS NULL, l.last_visit_date DESC, l.id DESC
      LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );
  const [[total]] = await pool.query(`SELECT COUNT(*) AS n FROM sales_leads l WHERE ${where}`, args);
  // Chip counts ignore the search, so they always describe the whole list.
  const [[counts]] = await pool.query(
    `SELECT ${Object.entries(LEAD_FILTERS).map(([k, sql]) => `SUM(${sql}) AS ${k}`).join(', ')}, COUNT(*) AS \`all\`
       FROM sales_leads l WHERE ${base}`,
    baseArgs,
  );
  return ok(res, rows.map((r) => ({ ...r, daysSinceVisit: r.daysSinceVisit === null ? null : int(r.daysSinceVisit) })), {
    page, limit, total: int(total.n),
    counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, int(v)])),
    followupDays: LEAD_FOLLOWUP_DAYS,
  });
});

const leadDetail = handle(async (req, res) => {
  const id = idOf(req);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  const ls = ownScope(req.user, 'lead', 'l.id');
  const [[lead]] = await pool.query(
    `SELECT l.id, l.outlet_code AS outletCode, l.name, l.address, l.area, l.latitude, l.longitude,
            l.sales_person_name AS salesPersonName, l.owner_user_id AS ownerUserId,
            l.first_visit_date AS firstVisitDate, l.last_visit_date AS lastVisitDate, l.visit_count AS visitCount,
            l.status, l.customer_id AS customerId, c.name AS customerName
       FROM sales_leads l LEFT JOIN sales_customers c ON c.id = l.customer_id
      WHERE l.id = ? AND l.entity_id = ?${ls.sql} AND l.deleted_at IS NULL`,
    [id, req.user.entityId, ...ls.args],
  );
  if (!lead) return fail(res, 'NOT_FOUND', 'Lead tidak ditemukan', 404);
  const [visits] = await pool.query(
    `SELECT id, visit_date AS visitDate, sales_person_name AS salesPersonName,
            DATE_FORMAT(check_in_at, '%H:%i') AS checkInTime, DATE_FORMAT(check_out_at, '%H:%i') AS checkOutTime,
            duration_minutes AS durationMinutes, is_planned AS isPlanned, geo_mismatch AS geoMismatch,
            total_sales AS totalSales, summary, source
       FROM sales_visit_reports
      WHERE lead_id = ? AND entity_id = ?
      ORDER BY visit_date DESC, id DESC`,
    [id, req.user.entityId],
  );
  return ok(res, {
    lead,
    visits: visits.map((v) => ({ ...v, isPlanned: Boolean(v.isPlanned), geoMismatch: Boolean(v.geoMismatch) })),
  });
});

const createLead = handle(async (req, res) => ok(res, await records.createLead(req.user, req.body), undefined, 201));
const updateLead = handle(async (req, res) => {
  const id = idOf(req);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  return ok(res, await records.updateLead(req.user, id, req.body));
});
const addVisit = handle(async (req, res) => {
  const id = idOf(req);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  return ok(res, await records.addVisit(req.user, id, req.body), undefined, 201);
});
const convertLead = handle(async (req, res) => {
  const id = idOf(req);
  if (!id) return fail(res, 'VALIDATION_ERROR', 'id tidak valid', 400);
  return ok(res, await records.convertLead(req.user, id, req.body), undefined, 201);
});

const importVisits = handle(async (req, res) => {
  if (!req.file) return fail(res, 'VALIDATION_ERROR', 'Pilih file export SimpliDOTS (.xlsx / .xlsm).', 400);
  const result = await simplidots.importVisitFile({
    entityId: req.user.entityId, buffer: req.file.buffer, fileName: req.file.originalname, triggeredBy: req.user.sub,
  });
  await log({
    entityId: req.user.entityId, userId: req.user.sub, action: 'sales_visits.import',
    subjectType: 'sales_sync_run', subjectId: result.runId, metadata: { file: req.file.originalname, ...result.stats },
  });
  return ok(res, result);
});

module.exports = {
  listLeads, leadDetail, createLead, updateLead, addVisit, convertLead, importVisits, LEAD_FILTERS,
};
