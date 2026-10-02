const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const salesOwners = require('../services/salesOwners.service');
const salesActions = require('../services/salesActions.service');
const salesTargets = require('../services/salesTargets.service');
const { transactionSource, transactionsReliable, numbersFromAccurate } = require('../services/salesSource');
const { factsFor } = require('../services/salesFacts');

const { ownScope } = salesOwners;
const {
  statusSql, stageSql, ACTIVE_DAYS, LOST_DAYS, LEAD_FOLLOWUP_DAYS,
} = require('../services/salesStatus');
const {
  paging, searchClause, money, int, unitQuantities, baseQtyOf,
} = require('../services/salesQuery');

// Sales overview, the automatic pipeline (funnel), the sales accounts that can
// be PIC, and the salesperson mapping. Every query is bound to the caller's
// entity and, without sales.data.view_all, to the records they own.

function can(req, code) {
  return (req.user?.permissions || []).includes(code);
}

// ------------------------------------------------------------------ overview

async function overview(req, res, next) {
  try {
    const entityId = req.user.entityId;
    const src = await factsFor(req.user);
    const cs = ownScope(req.user, 'customer', 'c.id');
    const ls = ownScope(req.user, 'lead', 'l.id');
    const os = src.scope('t');
    const [[customers]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(s = 'aktif') AS aktif, SUM(s = 'dormant') AS dormant, SUM(s = 'lost') AS lost,
              SUM(last_order_date IS NULL) AS neverOrdered
         FROM (SELECT ${statusSql('c')} AS s, c.last_order_date
                 FROM ${src.customers} c WHERE c.entity_id = ?${cs.sql} AND c.deleted_at IS NULL) x`,
      [entityId, ...cs.args],
    );
    const [[leads]] = await pool.query(
      `SELECT SUM(l.customer_id IS NULL AND l.status = 'open') AS open,
              SUM(l.customer_id IS NOT NULL) AS converted,
              SUM(l.customer_id IS NULL AND l.status = 'open'
                  AND DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), l.last_visit_date) >= ${LEAD_FOLLOWUP_DAYS}) AS needsVisit
         FROM sales_leads l WHERE l.entity_id = ?${ls.sql} AND l.deleted_at IS NULL`,
      [entityId, ...ls.args],
    );
    const data = {
      customers: {
        total: int(customers.total), aktif: int(customers.aktif), dormant: int(customers.dormant),
        lost: int(customers.lost), neverOrdered: int(customers.neverOrdered),
      },
      leads: { open: int(leads.open), converted: int(leads.converted), needsVisit: int(leads.needsVisit) },
      rules: { activeDays: ACTIVE_DAYS, lostDays: LOST_DAYS, leadFollowupDays: LEAD_FOLLOWUP_DAYS },
      scope: await salesOwners.scopeInfo(req.user),
      sales: null,
      bySalesperson: null,
      // 'accurate' once the numbers read approved Accurate invoices (Tahap B).
      source: src.accurate ? 'accurate' : 'recap',
    };

    // Money is only for those who may see orders.
    if (can(req, 'sales.order.view')) {
      const [months] = await pool.query(
        `SELECT DATE_FORMAT(t.tdate, '%Y-%m') AS month,
                ${src.orderCount('t')} AS orders, SUM(t.dpp_amount) AS revenue
           FROM ${src.revenueFacts} t
          WHERE t.entity_id = ?${os.sql}
            AND t.tdate >= DATE_SUB(DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-%m-01'), INTERVAL 11 MONTH)
          GROUP BY month ORDER BY month`,
        [entityId, ...os.args],
      );
      // NOO: with Accurate, per Accurate customer (customer number) from the
      // invoices — also customers not (yet) in the app's master — the same count
      // as management (sales_new_customers) and Marketing.
      const nooScope = ownScope(req.user, 'customer', src.accurate ? 'c.customer_id' : 'c.id');
      const [noo] = await pool.query(
        `SELECT DATE_FORMAT(c.noo_date, '%Y-%m') AS month, COUNT(*) AS n
           FROM ${src.accurate ? 'sales_customer_orders_accurate' : src.customers} c
          WHERE c.entity_id = ?${nooScope.sql}${src.accurate ? '' : ' AND c.deleted_at IS NULL'}
            AND c.noo_date >= DATE_SUB(DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-%m-01'), INTERVAL 11 MONTH)
          GROUP BY month`,
        [entityId, ...nooScope.args],
      );
      const nooByMonth = new Map(noo.map((r) => [r.month, int(r.n)]));
      const [channels] = await pool.query(
        `SELECT COALESCE(t.channel, 'Lainnya') AS channel, ${src.orderCount('t')} AS orders, SUM(t.dpp_amount) AS revenue
           FROM ${src.revenueFacts} t
          WHERE t.entity_id = ?${os.sql}
            AND t.tdate >= DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-%m-01')
          GROUP BY t.channel ORDER BY revenue DESC`,
        [entityId, ...os.args],
      );
      const [[ar]] = await pool.query(
        `SELECT SUM(t.outstanding_amount) AS outstanding, SUM(t.outstanding_amount > 0) AS orders
           FROM ${src.facts} t WHERE t.entity_id = ?${os.sql}`,
        [entityId, ...os.args],
      );
      data.sales = {
        months: months.map((m) => ({
          month: m.month, orders: int(m.orders), revenue: money(m.revenue), newCustomers: nooByMonth.get(m.month) || 0,
        })),
        channelsThisMonth: channels.map((c) => ({ channel: c.channel, orders: int(c.orders), revenue: money(c.revenue) })),
        outstanding: money(ar.outstanding),
        outstandingOrders: int(ar.orders),
        unit: src.unit,
        topProducts: null,
      };
      // Tahap B: best sellers this month, from approved Accurate invoice lines:
      // each line's share of its invoice DPP (before PPN, as Marketing), no down payments.
      if (src.accurate) {
        const ps = src.scope('l');
        // Quantities per unit (cartons and packs are never added up).
        const [top] = await pool.query(
          `SELECT u.code, MIN(u.name) AS name, SUM(u.revenue) AS revenue,
                  JSON_ARRAYAGG(JSON_OBJECT('unit', u.unit, 'qty', u.qty)) AS units,
                  CASE WHEN SUM(iu.ratio IS NULL) = 0 THEN SUM(u.qty * iu.ratio) END AS base_qty, MIN(iu.base_unit) AS base_unit
             FROM (SELECT l.item_code AS code, MIN(l.item_name) AS name, l.unit, SUM(l.qty) AS qty, SUM(l.revenue) AS revenue
                     FROM sales_invoice_lines_accurate l
                    WHERE l.entity_id = ?${ps.sql} AND NOT l.is_dp AND l.trans_date >= DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-%m-01')
                    GROUP BY l.item_code, l.unit) u
             LEFT JOIN item_units_accurate iu ON iu.entity_id = ? AND iu.item_no = u.code COLLATE utf8mb4_unicode_ci
                   AND iu.unit_name = u.unit COLLATE utf8mb4_unicode_ci
            GROUP BY u.code ORDER BY revenue DESC LIMIT 10`,
          [entityId, ...ps.args, entityId],
        );
        // Also one total in the base unit, once Accurate's units are approved (1.3).
        data.sales.topProducts = top.map((t) => ({
          code: t.code, name: t.name, qtyByUnit: unitQuantities(t.units), baseQty: baseQtyOf(t.base_qty, t.base_unit), revenue: money(t.revenue),
        }));
      }

      // Per salesperson, as named in the sheet: only for those who see everyone.
      if (can(req, 'sales.data.view_all')) {
        const [people] = await pool.query(
          `SELECT COALESCE(t.sales_person_name, '') AS name,
                  SUM(t.tdate >= DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-%m-01') AND ${src.accurate ? "t.kind = 'invoice'" : 'TRUE'}) AS monthOrders,
                  SUM(CASE WHEN t.tdate >= DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-%m-01') THEN t.dpp_amount ELSE 0 END) AS monthRevenue,
                  ${src.orderCount('t')} AS yearOrders, SUM(t.dpp_amount) AS yearRevenue,
                  COUNT(DISTINCT t.customer_id) AS customers
             FROM ${src.revenueFacts} t
            WHERE t.entity_id = ?
              AND t.tdate >= DATE_FORMAT(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), '%Y-01-01')
            GROUP BY name
            ORDER BY yearRevenue DESC`,
          [entityId],
        );
        data.bySalesperson = people.map((r) => ({
          name: r.name || null,
          monthOrders: int(r.monthOrders), monthRevenue: money(r.monthRevenue),
          yearOrders: int(r.yearOrders), yearRevenue: money(r.yearRevenue), customers: int(r.customers),
        }));
      }
    }
    return ok(res, data);
  } catch (e) { next(e); }
}

// ------------------------------------------------------------------ funnel

const FUNNEL = [
  { key: 'prospek', label: 'Prospek dikunjungi', hint: 'Outlet yang sudah dikunjungi tapi belum jadi customer.' },
  { key: 'belum_order', label: 'Terdaftar, belum order', hint: 'Sudah punya ID pelanggan, belum ada order.' },
  { key: 'order_pertama', label: 'Order pertama (NOO)', hint: 'Order pertama dalam 30 hari terakhir.' },
  { key: 'aktif', label: 'Aktif', hint: `Order terakhir kurang dari ${ACTIVE_DAYS} hari.` },
  { key: 'dormant', label: 'Dormant', hint: `Order terakhir ${ACTIVE_DAYS}–${LOST_DAYS - 1} hari lalu. Hubungi sebelum jadi Lost.` },
  { key: 'lost', label: 'Lost', hint: `Order terakhir ${LOST_DAYS} hari atau lebih.` },
];

// Most urgent first: dormant closest to Lost, prospects waiting longest.
const STAGE_ORDER = {
  prospek: 'l.last_visit_date IS NULL, l.last_visit_date ASC, l.id',
  belum_order: 'c.id DESC',
  order_pertama: 'c.noo_date DESC, c.id',
  aktif: 'c.last_order_date DESC, c.id',
  dormant: 'c.last_order_date ASC, c.id',
  lost: 'c.last_order_date DESC, c.id',
};

// Stage counts for the chips, plus one page of the chosen stage.
async function funnel(req, res, next) {
  try {
    const entityId = req.user.entityId;
    const src = await factsFor(req.user);
    const stage = FUNNEL.some((s) => s.key === req.query.stage) ? req.query.stage : 'dormant';
    const cs = ownScope(req.user, 'customer', 'c.id');
    const ls = ownScope(req.user, 'lead', 'l.id');
    const leadBase = `l.entity_id = ?${ls.sql} AND l.deleted_at IS NULL AND l.customer_id IS NULL AND l.status = 'open'`;
    const custBase = `c.entity_id = ?${cs.sql} AND c.deleted_at IS NULL`;

    const [stageCounts] = await pool.query(
      `SELECT x.stage, COUNT(*) AS n FROM (SELECT ${stageSql('c')} AS stage FROM ${src.customers} c WHERE ${custBase}) x GROUP BY x.stage`,
      [entityId, ...cs.args],
    );
    const [[leadCount]] = await pool.query(`SELECT COUNT(*) AS n FROM sales_leads l WHERE ${leadBase}`, [entityId, ...ls.args]);
    const counts = new Map(stageCounts.map((r) => [r.stage, int(r.n)]));
    counts.set('prospek', int(leadCount.n));

    const { page, limit, offset } = paging(req.query);
    let items;
    let total;
    if (stage === 'prospek') {
      const s = searchClause(req.query.q, ['l.name', 'l.outlet_code', 'l.area', 'l.sales_person_name']);
      const [rows] = await pool.query(
        `SELECT l.id, l.name, l.outlet_code AS code, l.area AS channel, l.sales_person_name AS salesPersonName,
                l.last_visit_date AS lastVisitDate, DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), l.last_visit_date) AS daysSinceVisit
           FROM sales_leads l WHERE ${leadBase}${s.sql}
          ORDER BY ${STAGE_ORDER.prospek} LIMIT ? OFFSET ?`,
        [entityId, ...ls.args, ...s.args, limit, offset],
      );
      const [[n]] = await pool.query(`SELECT COUNT(*) AS n FROM sales_leads l WHERE ${leadBase}${s.sql}`, [entityId, ...ls.args, ...s.args]);
      items = rows.map((r) => ({ kind: 'lead', ...r, daysSinceVisit: r.daysSinceVisit === null ? null : int(r.daysSinceVisit) }));
      total = int(n.n);
    } else {
      const s = searchClause(req.query.q, ['c.name', 'c.customer_code', 'c.sales_person_name', 'c.channel']);
      const where = `${custBase} AND ${stageSql('c')} = ?${s.sql}`;
      const args = [entityId, ...cs.args, stage, ...s.args];
      const [rows] = await pool.query(
        `SELECT c.id, c.name, c.customer_code AS code, c.channel, c.sales_person_name AS salesPersonName,
                c.noo_date AS nooDate, c.last_order_date AS lastOrderDate,
                DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), c.last_order_date) AS daysSinceOrder
           FROM ${src.customers} c WHERE ${where}
          ORDER BY ${STAGE_ORDER[stage]} LIMIT ? OFFSET ?`,
        [...args, limit, offset],
      );
      const [[n]] = await pool.query(`SELECT COUNT(*) AS n FROM ${src.customers} c WHERE ${where}`, args);
      items = rows.map((r) => ({ kind: 'customer', ...r, daysSinceOrder: r.daysSinceOrder === null ? null : int(r.daysSinceOrder) }));
      total = int(n.n);
    }
    return ok(res, {
      stages: FUNNEL.map((s) => ({ ...s, count: counts.get(s.key) || 0 })),
      stage,
      items,
    }, {
      page, limit, total,
      rules: { activeDays: ACTIVE_DAYS, lostDays: LOST_DAYS, leadFollowupDays: LEAD_FOLLOWUP_DAYS },
    });
  } catch (e) { next(e); }
}

// ------------------------------------------------------------------ salespeople

async function scope(req, res, next) {
  try {
    return ok(res, {
      ...(await salesOwners.scopeInfo(req.user)),
      transactionSource: transactionSource(),
      transactionsReliable: await transactionsReliable(req.user.entityId),
      // 'accurate' once the numbers read approved Accurate invoices (Tahap B).
      numbersSource: (await numbersFromAccurate(req.user.entityId)) ? 'accurate' : 'recap',
    });
  } catch (e) { next(e); }
}

// Accounts that can be PIC of a customer, lead or order.
async function accounts(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, d.name AS departmentName
         FROM users u JOIN departments d ON d.id = u.department_id
        WHERE u.entity_id = ? AND u.deleted_at IS NULL AND u.status = 'active'
          AND d.code IN ('sales', 'retail_commerce')
        ORDER BY u.name`,
      [req.user.entityId],
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function listPeople(req, res, next) {
  try {
    return ok(res, await salesOwners.listPeople(req.user.entityId));
  } catch (e) { next(e); }
}

async function savePeople(req, res, next) {
  try {
    const result = await salesOwners.saveMapping(req.user.entityId, req.body.mappings, req.user.sub);
    await log({
      entityId: req.user.entityId, userId: req.user.sub, action: 'sales_people.map',
      subjectType: 'sales_person_accounts', subjectId: null, metadata: { mappings: req.body.mappings },
    });
    return ok(res, result);
  } catch (e) {
    if (e.status && e.code) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
}

// ------------------------------------------------------------------ to-do

// The menu badge is an alarm: held (0) while transactions are not reliable yet.
async function actionCount(req, res, next) {
  try {
    const [summary, reliable] = await Promise.all([salesActions.counts(req.user), transactionsReliable(req.user.entityId)]);
    return ok(res, { ...summary, badge: reliable ? summary.badge : 0, transactionsReliable: reliable });
  } catch (e) { next(e); }
}

async function actions(req, res, next) {
  try {
    const type = salesActions.TYPES[req.query.type] ? req.query.type : 'dormant';
    const { page, limit, offset } = paging(req.query);
    const [list, summary, reliable] = await Promise.all([
      salesActions.list(req.user, type, { page, limit, offset, q: req.query.q }),
      salesActions.counts(req.user),
      transactionsReliable(req.user.entityId),
    ]);
    return ok(res, list.items, {
      page: list.page, limit: list.limit, total: list.total, type,
      types: salesActions.catalogue(await numbersFromAccurate(req.user.entityId)).map((t) => ({ ...t, count: summary.counts[t.key] })),
      badge: reliable ? summary.badge : 0,
      transactionsReliable: reliable,
    });
  } catch (e) { next(e); }
}

// ------------------------------------------------------------------ targets

async function targets(req, res, next) {
  try {
    return ok(res, await salesTargets.listTargets(req.user, req.query.month));
  } catch (e) {
    if (e.status && e.code) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
}

async function saveTargets(req, res, next) {
  try {
    return ok(res, await salesTargets.saveTargets(req.user, req.body.month, req.body.targets));
  } catch (e) {
    if (e.status && e.code) return fail(res, e.code, e.message, e.status);
    return next(e);
  }
}

module.exports = {
  overview, funnel, scope, accounts, listPeople, savePeople, actions, actionCount, targets, saveTargets, FUNNEL,
};
