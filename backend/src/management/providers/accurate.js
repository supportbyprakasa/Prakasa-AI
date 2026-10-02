const pool = require('../../db/pool');
const { MAX_ITEMS_PER_SOURCE, int, scope, escalationItem } = require('../helpers');
const quality = require('../../services/accurateQuality.service');

// Data Accurate, for every division that reads it (Sales, Retail Commerce,
// Warehouse, Procurement, Finance). Accurate data only reaches the app through
// a batch the division's Supervisor or Head approved, so a batch left waiting
// means that division's figures in the app lag behind Accurate. One escalation
// for every division, scoped by the batch's department.
//
// These batches are approval requests too; providers/approvals.js leaves them
// out of `approval_aged`, so a waiting batch is flagged once, here.

// A pending batch older than this reaches management.
const BATCH_LATE_DAYS = 1;

const located = (row) => (row
  ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null }
  : null);

module.exports = {
  key: 'accurate',
  label: 'Data Accurate',
  // /data-accurate is reached from each division's module and from the
  // notifications, not from the sidebar (like the approval inbox).
  navPaths: [],

  escalations: [
    {
      key: 'accurate_batch_pending',
      label: 'Data Accurate menunggu persetujuan',
      async list(entityId, { departmentId }) {
        const s = scope(departmentId, 'b.department_id');
        const [rows] = await pool.query(
          `SELECT b.id, b.item_count, b.department_id, d.name AS department_name, b.created_at,
                  DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), DATE(b.created_at + INTERVAL 7 HOUR)) - ${BATCH_LATE_DAYS} AS days_late
             FROM sales_accurate_batches b
             LEFT JOIN departments d ON d.id = b.department_id
            WHERE b.entity_id = ?${s.sql}
              AND b.status = 'pending'
              AND b.created_at <= DATE_SUB(NOW(), INTERVAL ${BATCH_LATE_DAYS} DAY)
            ORDER BY b.created_at ASC, b.id ASC
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args],
        );
        return rows.map((row) => escalationItem({
          sourceId: row.id,
          title: `Data Accurate ${row.department_name || ''}`.trim(),
          reference: `Batch #${row.id}`,
          context: `${int(row.item_count)} perubahan belum disetujui — data ${row.department_name || 'divisi ini'} di aplikasi belum ikut diperbarui.`,
          departmentId: row.department_id,
          departmentName: row.department_name,
          daysLate: row.days_late,
          since: row.created_at,
          link: `/data-accurate/${row.id}`,
        }));
      },
      async locate(id) {
        const [[row]] = await pool.query('SELECT entity_id, department_id FROM sales_accurate_batches WHERE id = ? LIMIT 1', [id]);
        return located(row);
      },
    },
  ],

  kpis: [
    {
      key: 'batches_waiting',
      label: 'Data Accurate menunggu keputusan',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'b.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS n, COALESCE(SUM(b.item_count), 0) AS items,
                  SUM(b.created_at <= DATE_SUB(NOW(), INTERVAL ${BATCH_LATE_DAYS} DAY)) AS late
             FROM sales_accurate_batches b
            WHERE b.entity_id = ?${s.sql} AND b.status = 'pending'`,
          [entityId, ...s.args],
        );
        const n = int(row?.n);
        return { value: n, sub: n ? `${int(row.items)} perubahan` : 'Semua sudah diputuskan', alert: int(row?.late) > 0 };
      },
    },
    {
      // Program 1.4: what approved Accurate data shows is wrong in Accurate,
      // listed on Data Accurate → "Perlu dibereskan di Accurate".
      key: 'accurate_to_fix',
      label: 'Perlu dibereskan di Accurate',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const q = quality.totalQuery(entityId, departmentId);
        const [rows] = await pool.query(q.sql, q.args);
        const labels = new Map(quality.CHECKS.map((c) => [c.key, c.label]));
        const found = rows.map((r) => ({ label: labels.get(r.k), n: int(r.n) })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
        const total = found.reduce((sum, r) => sum + r.n, 0);
        return {
          value: total,
          sub: total ? found.slice(0, 2).map((r) => `${r.n} ${r.label.toLowerCase()}`).join(' · ') : 'Tidak ada temuan',
          alert: total > 0,
        };
      },
    },
  ],

};
