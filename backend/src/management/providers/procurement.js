const pool = require('../../db/pool');
const { MAX_ITEMS_PER_SOURCE, int, num, round1, scope, escalationItem, byDepartment, grouping } = require('../helpers');
const rules = require('../../services/procurementRules');
const reorder = require('../../services/procurementReorder.service');
const { MIN_HISTORY_DAYS } = require('../../services/warehouseStock.service');

// Procurement (docs/program-4-divisi.md 2.1): POs from approved Accurate data.
// A waiting Procurement batch is already flagged by providers/accurate.js.
//
// Escalation texts never carry amounts. Rupiah appears in one KPI and one
// metric, and both declare `permission: 'procurement.price.view'` (P1): a
// caller without it never runs them and sees "Hanya untuk yang berwenang
// melihat harga beli" instead (management/contract.js). The saran pesan
// ulang sources (escalation + KPI) carry days and item counts only, never
// quantities or rupiah; their audience (MO, Procurement Head) is inside D2
// extended.
//
// Every query binds LATE_FROM (rules.lateFrom()) as a parameter, in text order.
const TODAY = rules.TODAY;
const LATE = `p.po_state IN ('open', 'partial') AND p.trans_date >= ? AND p.due_date_eff < ${TODAY} - INTERVAL ${rules.PO_LATE_GRACE_DAYS} DAY`;
// Every saran pesan ulang row belongs to the Procurement division, so the
// division scope is the first table of the one statement (entity first, then
// division): for another division's Head it is empty and the heavy part is
// never read — never a filter applied to its rows afterwards.
const procurementScope = (departmentId) => `FROM departments d
         WHERE d.entity_id = ? AND d.code = 'procurement' AND d.deleted_at IS NULL${departmentId ? ' AND d.id = ?' : ''} LIMIT 1`;
const scopeArgs = (entityId, departmentId) => [entityId, ...(departmentId ? [departmentId] : [])];
const dateOnly = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ? String(v).slice(0, 10) : null));

// Fill rate and lead time per division, or (whole) over every division at once.
async function fillRateRows(entityId, period, departmentId, whole) {
  const s = scope(departmentId, 'p.department_id');
  const g = grouping('p.department_id', whole);
  const [rows] = await pool.query(
    `SELECT ${g.select}, 100 * AVG(LEAST(COALESCE(l.received_qty, 0) / NULLIF(l.qty, 0), 1)) AS pct
       FROM pc_po_lines_accurate l JOIN pc_po_accurate p ON p.id = l.po_id AND p.entity_id = l.entity_id
      WHERE p.entity_id = ?${s.sql} AND p.trans_date >= ? AND l.qty > 0
        AND p.due_date_eff BETWEEN ? AND LEAST(?, ${TODAY} - INTERVAL 1 DAY)
      ${g.group}`,
    [entityId, ...s.args, rules.lateFrom(), period.start, period.end],
  );
  return rows;
}

async function leadTimeRows(entityId, period, departmentId, whole) {
  const s = scope(departmentId, 'p.department_id');
  const g = grouping('p.department_id', whole);
  const [rows] = await pool.query(
    `SELECT ${g.select}, AVG(DATEDIFF(g.last_receipt, p.trans_date)) AS days
       FROM pc_po_accurate p
       JOIN (SELECT r.po_number, MAX(r.received_on) AS last_receipt FROM pc_po_receipts_accurate r
              WHERE r.entity_id = ? GROUP BY r.po_number) g ON g.po_number = p.number COLLATE utf8mb4_unicode_ci
      WHERE p.entity_id = ?${s.sql} AND p.po_state = 'received' AND g.last_receipt BETWEEN ? AND ?
      ${g.group}`,
    [entityId, entityId, ...s.args, period.start, period.end],
  );
  return rows;
}

module.exports = {
  key: 'procurement',
  label: 'Procurement',
  navPaths: ['/procurement', '/procurement/orders', '/procurement/vendors', '/procurement/reorder'],

  escalations: [
    {
      key: 'procurement_po_late',
      label: 'PO terlambat datang',
      async list(entityId, { departmentId }) {
        const s = scope(departmentId, 'p.department_id');
        const [rows] = await pool.query(
          `SELECT p.id, p.number, p.vendor_name, p.percent_received, p.expected_date, p.department_id, d.name AS department_name,
                  -- Days since the promised date, the same number the PO page shows.
                  p.due_date_eff AS due, DATEDIFF(${TODAY}, p.due_date_eff) AS days_late,
                  DATEDIFF(p.due_date_eff, '2000-01-01') AS due_day
             FROM pc_po_accurate p
             LEFT JOIN departments d ON d.id = p.department_id
            WHERE p.entity_id = ?${s.sql} AND ${LATE}
            ORDER BY p.due_date_eff, p.id
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args, rules.lateFrom()],
        );
        return rows.map((row) => escalationItem({
          // A new promised date is a new episode: a closed follow-up never hides it.
          sourceId: Number(row.id) * rules.EPISODE_FACTOR + int(row.due_day),
          title: `${row.number} · ${row.vendor_name || '-'}`,
          reference: row.number,
          context: row.expected_date
            ? `${round1(num(row.percent_received) || 0)}% diterima · diharapkan ${dateOnly(row.expected_date)}`
            : `${round1(num(row.percent_received) || 0)}% diterima · diharapkan ${dateOnly(row.due)} (perkiraan: ${rules.DEFAULT_LEAD_DAYS} hari dari tanggal PO)`,
          departmentId: row.department_id,
          departmentName: row.department_name,
          daysLate: row.days_late,
          since: row.due,
          link: `/procurement/orders?state=late&po=${row.id}`,
        }));
      },
      async locate(sourceId, { entityId } = {}) {
        const id = Math.floor(Number(sourceId) / rules.EPISODE_FACTOR);
        const [[row]] = await pool.query(
          `SELECT entity_id, department_id FROM pc_po_accurate WHERE id = ?${entityId ? ' AND entity_id = ?' : ''} LIMIT 1`,
          entityId ? [id, entityId] : [id],
        );
        return row ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null } : null;
      },
    },
    {
      // Saran pesan ulang: items that run out before a new order could arrive,
      // with nothing on order — one row per vendor. A new PO to that vendor is
      // a new episode, so a closed follow-up never hides the next shortage.
      // A stock below zero counts as 0 and is named (program rule): the item
      // escalates here; "Stok minus di Accurate" asks the Warehouse to fix it.
      key: 'procurement_reorder_missed',
      label: 'Barang habis sebelum barang datang, belum dipesan',
      async list(entityId, { departmentId }) {
        // Days since the reorder point was crossed, but never before the app
        // could have known: the outflow needs MIN_HISTORY_DAYS of stock history.
        const late = `GREATEST(0, LEAST(CEIL(MAX(r.lead_days + ${reorder.SAFETY_DAYS} - r.cover_days)), MAX(r.history_days) - ${MIN_HISTORY_DAYS}))`;
        // One row per vendor (its id), named as the vendor is named now — the
        // name on each item's last PO may predate a rename.
        const [rows] = await pool.query(
          `SELECT r.vendor_id, MAX(r.vendor_no) AS vendor_no,
                  COALESCE(MAX(r.vendor_master_name), MAX(r.vendor_name), MAX(r.vendor_no)) AS vendor_title,
                  MIN(pd.id) AS department_id, MIN(pd.name) AS department_name,
                  COUNT(*) AS items, MIN(r.cover_days) AS min_cover, MAX(r.lead_days) AS lead_days,
                  MAX(COALESCE(r.lead_samples, 0)) AS lead_samples, SUM(r.legacy_pos > 0) AS with_legacy,
                  SUM(r.stock_qty < 0) AS negative,
                  ${late} AS days_late, ${TODAY} - INTERVAL ${late} DAY AS since,
                  DATEDIFF(COALESCE(lv.last_po, '2000-01-01'), '2000-01-01') AS po_day
             FROM (SELECT d.id, d.name ${procurementScope(departmentId)}) pd
             JOIN (${reorder.REORDER_SQL}) r ON r.department_id = pd.id
             LEFT JOIN (SELECT p.vendor_no, MAX(p.trans_date) AS last_po FROM pc_po_accurate p
                         WHERE p.entity_id = ? AND NOT (p.po_state = 'closed' AND COALESCE(p.percent_received, 0) = 0)
                         GROUP BY p.vendor_no) lv ON lv.vendor_no = r.vendor_no
            WHERE r.urgency = 'critical' AND r.vendor_id IS NOT NULL AND ${reorder.NO_PO_SQL}
            GROUP BY r.vendor_id, lv.last_po
            ORDER BY days_late DESC, vendor_title, r.vendor_id
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [...scopeArgs(entityId, departmentId), ...reorder.reorderBinds(entityId), entityId],
        );
        return rows.map((row) => escalationItem({
          sourceId: Number(row.vendor_id) * rules.EPISODE_FACTOR + int(row.po_day),
          title: row.vendor_title,
          reference: row.vendor_no,
          context: `${int(row.items)} barang habis sebelum barang datang, belum ada PO baru · paling cepat habis ± ${Math.floor(num(row.min_cover) || 0)} hari`
            + ` · waktu datang ${int(row.lead_days)} hari${int(row.lead_samples) ? '' : ' (perkiraan)'}`
            + (int(row.with_legacy) ? ` · ${int(row.with_legacy)} dengan PO lama belum ditutup` : '')
            + (int(row.negative) ? ` · ${int(row.negative)} stok minus di Accurate` : ''),
          departmentId: row.department_id,
          departmentName: row.department_name,
          daysLate: row.days_late,
          since: row.since,
          // Opens exactly these items: critical, this vendor, nothing on order.
          link: `/procurement/reorder?urgency=critical&vendor=${encodeURIComponent(row.vendor_no)}&noPo=1`,
        }));
      },
      async locate(sourceId, { entityId } = {}) {
        const id = Math.floor(Number(sourceId) / rules.EPISODE_FACTOR);
        const [[row]] = await pool.query(
          `SELECT entity_id, department_id FROM pc_vendors_accurate WHERE id = ?${entityId ? ' AND entity_id = ?' : ''} LIMIT 1`,
          entityId ? [id, entityId] : [id],
        );
        return row ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null } : null;
      },
    },
  ],

  metrics: [
    {
      key: 'procurement_fill_rate',
      label: 'Fill rate pemasok',
      unit: '%',
      better: 'higher',
      cumulative: false,
      // Line-weighted, each line in its own unit (never summed across units);
      // only POs already due in the period count, short-closed lines against it.
      async actuals(entityId, period, { departmentId }) {
        const rows = await fillRateRows(entityId, period, departmentId, false);
        return byDepartment(rows, (r) => round1(num(r.pct)));
      },
      // Company-wide: every due PO line together (exact).
      async entityActuals(entityId, period) {
        const [row] = await fillRateRows(entityId, period, null, true);
        return row && row.pct != null ? round1(num(row.pct)) : null;
      },
    },
    {
      // Program 3.1/3.4: of the POs fully received in the period with
      // Warehouse-approved receipts, the share that arrived by their due date.
      // An open PO already past due counts against it (no survivor bias).
      key: 'procurement_on_time_rate',
      label: 'PO datang tepat waktu',
      unit: '%',
      better: 'higher',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        const s = scope(departmentId, 'p.department_id');
        const [rows] = await pool.query(
          `SELECT p.department_id,
                  100 * SUM(p.po_state = 'received' AND g.last_receipt <= p.due_date_eff)
                      / NULLIF(SUM((p.po_state = 'received' AND g.last_receipt IS NOT NULL) OR p.po_state IN ('open', 'partial')), 0) AS pct
             FROM pc_po_accurate p
             LEFT JOIN (SELECT r.po_number, MAX(r.received_on) AS last_receipt FROM pc_po_receipts_accurate r
                         WHERE r.entity_id = ? GROUP BY r.po_number) g ON g.po_number = p.number COLLATE utf8mb4_unicode_ci
            WHERE p.entity_id = ?${s.sql} AND p.trans_date >= ?
              AND p.due_date_eff BETWEEN ? AND LEAST(?, ${TODAY} - INTERVAL 1 DAY)
            GROUP BY p.department_id
            -- No rate until a PO has arrived with an approved receipt: late ones alone would read 0%.
           HAVING SUM(p.po_state = 'received' AND g.last_receipt IS NOT NULL) > 0`,
          [entityId, entityId, ...s.args, rules.lateFrom(), period.start, period.end],
        );
        return byDepartment(rows.filter((r) => r.pct !== null), (r) => round1(num(r.pct)));
      },
    },
    {
      key: 'procurement_lead_time',
      label: 'Rata-rata waktu datang pemasok',
      unit: 'hari',
      better: 'lower',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        const rows = await leadTimeRows(entityId, period, departmentId, false);
        return byDepartment(rows, (r) => round1(num(r.days)));
      },
      async entityActuals(entityId, period) {
        const [row] = await leadTimeRows(entityId, period, null, true);
        return row && row.days != null ? round1(num(row.days)) : null;
      },
    },
    {
      key: 'procurement_po_value',
      label: 'Nilai PO (sebelum PPN)',
      unit: 'rupiah',
      better: 'lower',
      cumulative: true,
      // Purchase prices (P1): without this permission the metric is left out.
      permission: 'procurement.price.view',
      restrictedText: 'Hanya untuk yang berwenang melihat harga beli',
      async actuals(entityId, period, { departmentId }) {
        const s = scope(departmentId, 'v.department_id');
        const [rows] = await pool.query(
          `SELECT v.department_id, SUM(v.dpp_amount) AS total FROM pc_po_prices_accurate v
            WHERE v.entity_id = ?${s.sql} AND v.currency = 'IDR' AND v.counts_as_spend = 1 AND v.trans_date BETWEEN ? AND ?
            GROUP BY v.department_id`,
          [entityId, ...s.args, period.start, period.end],
        );
        return byDepartment(rows, (r) => Math.round(num(r.total) || 0));
      },
    },
  ],

  kpis: [
    {
      key: 'procurement_po_open',
      label: 'PO menunggu barang',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'p.department_id');
        const from = rules.lateFrom();
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS total,
                  COALESCE(SUM(p.po_state IN ('open', 'partial') AND p.trans_date >= ?), 0) AS n,
                  COALESCE(SUM(${LATE}), 0) AS late,
                  COALESCE(SUM(p.po_state IN ('open', 'partial') AND p.trans_date < ?), 0) AS legacy
             FROM pc_po_accurate p WHERE p.entity_id = ?${s.sql}`,
          [from, from, from, entityId, ...s.args],
        );
        if (!int(row?.total)) return { value: 0, sub: 'Belum ada data PO dari Accurate', alert: false };
        return { value: int(row.n), sub: `${int(row.late)} terlambat · ${int(row.legacy)} PO lama belum ditutup`, alert: int(row.late) > 0 };
      },
    },
    {
      key: 'procurement_arrivals_week',
      label: 'Dijadwalkan datang 7 hari ke depan',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'p.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS n, COALESCE(SUM(p.percent_received > 0), 0) AS partial FROM pc_po_accurate p
            WHERE p.entity_id = ?${s.sql} AND p.po_state IN ('open', 'partial') AND p.trans_date >= ?
              AND p.due_date_eff BETWEEN ${TODAY} AND ${TODAY} + INTERVAL ${rules.DUE_SOON_DAYS - 1} DAY`,
          [entityId, ...s.args, rules.lateFrom()],
        );
        return { value: int(row?.n), sub: `${int(row?.partial)} sudah sebagian datang`, alert: false };
      },
    },
    {
      key: 'procurement_po_value_month',
      label: 'Nilai PO bulan ini (sebelum PPN)',
      unit: 'rupiah',
      // Purchase prices (P1): without this permission the value is never computed.
      permission: 'procurement.price.view',
      restrictedText: 'Hanya untuk yang berwenang melihat harga beli',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'v.department_id');
        const month = `DATE_FORMAT(${TODAY}, '%Y-%m-01')`;
        const [[row]] = await pool.query(
          `SELECT COALESCE(SUM(CASE WHEN v.trans_date >= ${month} THEN v.dpp_amount END), 0) AS cur,
                  COALESCE(SUM(CASE WHEN v.trans_date < ${month} THEN v.dpp_amount END), 0) AS prev,
                  COUNT(CASE WHEN v.trans_date >= ${month} THEN 1 END) AS n
             FROM pc_po_prices_accurate v
            WHERE v.entity_id = ?${s.sql} AND v.currency = 'IDR' AND v.counts_as_spend = 1
              AND v.trans_date >= ${month} - INTERVAL 1 MONTH`,
          [entityId, ...s.args],
        );
        const prev = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(num(row?.prev) || 0);
        return { value: Math.round(num(row?.cur) || 0), sub: `${int(row?.n)} PO · bulan lalu Rp ${prev}`, alert: false };
      },
    },
    {
      // Saran pesan ulang: items to order now. Held until stock and POs are
      // approved and the outflow has MIN_HISTORY_DAYS of history.
      key: 'procurement_reorder_due',
      label: 'Barang perlu dipesan',
      unit: 'item',
      async value(entityId, { departmentId }) {
        // Negative stock counts as 0, as in the escalation: a critical item
        // with stock below zero is counted and alerts here too.
        const [[row]] = await pool.query(
          `SELECT COUNT(pd.id) AS in_scope, MAX(pd.po_ready) AS po_ready,
                  COALESCE(SUM(r.history_days IS NOT NULL), 0) AS stocked,
                  COALESCE(SUM(r.history_days >= ${MIN_HISTORY_DAYS}), 0) AS known,
                  COALESCE(SUM(r.urgency IN ('critical', 'reorder')), 0) AS n,
                  COALESCE(SUM(r.urgency = 'critical'), 0) AS critical
             FROM (SELECT d.id, EXISTS(SELECT 1 FROM accurate_records p WHERE p.entity_id = d.entity_id AND p.record_type = 'pc_po') AS po_ready
                   ${procurementScope(departmentId)}) pd
             LEFT JOIN (${reorder.REORDER_SQL}) r ON r.department_id = pd.id`,
          [...scopeArgs(entityId, departmentId), ...reorder.reorderBinds(entityId)],
        );
        if (!int(row?.in_scope)) return { value: 0, sub: 'Hanya untuk divisi Procurement', alert: false };
        if (!int(row.stocked)) return { value: 0, sub: 'Belum ada data stok dari Accurate', alert: false };
        if (!int(row.known)) return { value: 0, sub: `Laju keluar dihitung setelah ${MIN_HISTORY_DAYS} hari riwayat stok`, alert: false };
        if (!int(row.po_ready)) return { value: int(row.n), sub: 'Menunggu data PO disetujui', alert: false };
        return { value: int(row.n), sub: `${int(row.critical)} habis sebelum barang datang`, alert: int(row.critical) > 0 };
      },
    },
    {
      key: 'procurement_data_age',
      label: 'Umur data Procurement',
      unit: 'hari',
      // Since the POs shown were approved; alerts only when an update has waited
      // for the (single) approver longer than DATA_STALE_HOURS.
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'b.department_id');
        const [[row]] = await pool.query(
          `SELECT TIMESTAMPDIFF(HOUR, MAX(CASE WHEN b.status = 'applied' THEN b.applied_at END), NOW()) AS hours,
                  TIMESTAMPDIFF(HOUR, MIN(CASE WHEN b.status = 'pending' THEN b.created_at END), NOW()) AS waiting_hours
             FROM sales_accurate_batches b JOIN departments d ON d.id = b.department_id AND d.code = 'procurement'
            WHERE b.entity_id = ?${s.sql} AND b.status IN ('applied', 'pending')`,
          [entityId, ...s.args],
        );
        if (row?.hours == null) return { value: 0, sub: 'Belum ada data PO dari Accurate', alert: false };
        const hours = int(row.hours);
        const waiting = row.waiting_hours == null ? null : int(row.waiting_hours);
        const age = hours < 24 ? `${hours} jam lalu` : `${Math.floor(hours / 24)} hari lalu`;
        return {
          value: Math.floor(hours / 24),
          sub: waiting === null ? `disetujui ${age}` : `disetujui ${age} · pembaruan menunggu ${waiting} jam`,
          alert: waiting !== null && waiting > rules.DATA_STALE_HOURS,
        };
      },
    },
  ],
};
