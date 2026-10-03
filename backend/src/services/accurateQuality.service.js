// "Perlu dibereskan di Accurate" (program 1.4): what the approved Accurate data
// shows is wrong IN ACCURATE, for the division to pass on to whoever keys data
// there. Read-only views over the mirror; this app never fixes Accurate itself.
// Each check belongs to a division; a division's own people see theirs, the
// Management Office sees all (the same rule as the batches).
const pool = require('../db/pool');
const { promisedSql } = require('./warehouseRules');

const TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';
const TRANSFER_STUCK_DAYS = 3;
// A surat jalan dated tomorrow is a planned delivery; weeks or months ahead is a
// typo (the probe found an invoice dated 3 December 2026).
const FUTURE_TOLERANCE_DAYS = 7;
// An open SO this far past its ship date is a leftover nobody closed.
const SO_STALE_DAYS = 30;
const ROW_LIMIT = 100;
const WAREHOUSE = "(SELECT d.id FROM departments d WHERE d.entity_id = ? AND d.deleted_at IS NULL AND d.code = 'warehouse' LIMIT 1)";
const DOC_TYPES = "'sales_order', 'sales_invoice', 'delivery_order', 'sales_receipt', 'sales_return', 'wh_transfer', 'wh_adjustment', 'wh_receipt', 'wh_delivery'";
const DOC_LABEL = `CASE a.record_type WHEN 'sales_order' THEN 'Sales order' WHEN 'sales_invoice' THEN 'Faktur'
  WHEN 'delivery_order' THEN 'Surat jalan' WHEN 'sales_receipt' THEN 'Penerimaan' WHEN 'sales_return' THEN 'Retur penjualan'
  WHEN 'wh_transfer' THEN 'Pindah gudang' WHEN 'wh_adjustment' THEN 'Penyesuaian stok' WHEN 'wh_receipt' THEN 'Penerimaan barang'
  ELSE 'Surat jalan (gudang)' END`;

// Every check: one row source with `department_id`, plus how to read and fix it.
// `from(n)` is the row source; it binds the company `n` times.
const CHECKS = [
  {
    key: 'stock_minus',
    label: 'Stok minus',
    fix: 'Stok tidak mungkin di bawah nol: catat penerimaan atau penyesuaian yang belum masuk di Accurate, atau periksa pengeluaran yang tercatat dua kali.',
    binds: 1,
    from: `SELECT s.department_id, s.item_no AS ref, s.item_name AS name, s.warehouse_name AS detail, s.qty AS value
             FROM wh_stock_accurate s WHERE s.entity_id = ? AND s.qty < 0`,
  },
  {
    key: 'stock_mismatch',
    label: 'Stok per gudang tidak sama dengan total',
    fix: 'Jumlah stok semua gudang tidak sama dengan stok total barang di Accurate. Periksa kartu stok barang ini di Accurate.',
    // Both sides: an item whose total is 0 has no total row at all (zero is
    // never stored), yet its gudang can still hold stock (or minus).
    binds: 6,
    from: `SELECT ${WAREHOUSE} AS department_id, COALESCE(t.item_no, g.item_no) AS ref, COALESCE(t.item_name, g.item_name) AS name,
                  CONCAT('Total ', FORMAT(COALESCE(t.qty, 0), 0, 'id_ID'), ' · per gudang ', FORMAT(COALESCE(g.qty, 0), 0, 'id_ID')) AS detail,
                  COALESCE(t.qty, 0) - COALESCE(g.qty, 0) AS value
             FROM (SELECT item_id FROM wh_stock_total_accurate WHERE entity_id = ?
                   UNION SELECT item_id FROM wh_stock_accurate WHERE entity_id = ?) ids
             LEFT JOIN wh_stock_total_accurate t ON t.entity_id = ? AND t.item_id = ids.item_id
             LEFT JOIN (SELECT item_id, SUM(qty) AS qty, MIN(item_no) AS item_no, MIN(item_name) AS item_name
                          FROM wh_stock_accurate WHERE entity_id = ? GROUP BY item_id) g ON g.item_id = ids.item_id
            WHERE ABS(COALESCE(t.qty, 0) - COALESCE(g.qty, 0)) >= 0.0001
              AND EXISTS (SELECT 1 FROM wh_stock_accurate x WHERE x.entity_id = ?)`,
  },
  {
    key: 'transfer_not_received',
    label: `Pindah gudang belum dicatat diterima (${TRANSFER_STUCK_DAYS} hari atau lebih)`,
    fix: 'Barang sudah dikirim dari gudang asal, tetapi penerimaannya di gudang tujuan belum dicatat di Accurate.',
    binds: 1,
    // The same rule as the Warehouse escalation "Pindah gudang tertahan".
    from: `SELECT d.department_id, d.number AS ref, CONCAT(COALESCE(d.from_wh, '-'), ' → ', COALESCE(d.to_wh, '-')) AS name,
                  DATE_FORMAT(d.trans_date, '%Y-%m-%d') AS detail, DATEDIFF(${TODAY}, d.trans_date) AS value
             FROM wh_documents_accurate d
            WHERE d.entity_id = ? AND d.doc_type = 'transfer' AND d.transfer_type = 'TRANSFER_OUT' AND d.out_status = 'SENDING'
              AND d.trans_date <= ${TODAY} - INTERVAL ${TRANSFER_STUCK_DAYS} DAY`,
  },
  {
    key: 'future_date',
    label: `Tanggal lebih dari ${FUTURE_TOLERANCE_DAYS} hari ke depan`,
    fix: 'Tanggal transaksi jauh melewati hari ini. Biasanya salah ketik tahun atau bulan; perbaiki tanggalnya di Accurate.',
    binds: 3,
    from: `SELECT CASE WHEN a.record_type LIKE 'wh\\_%' THEN ${WAREHOUSE}
                  ELSE (SELECT d.id FROM departments d WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL
                          AND d.code COLLATE utf8mb4_unicode_ci = IF(a.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales') LIMIT 1) END AS department_id,
                  a.number AS ref, ${DOC_LABEL} AS name, DATE_FORMAT(a.trans_date, '%Y-%m-%d') AS detail,
                  DATEDIFF(a.trans_date, ${TODAY}) AS value
             FROM accurate_records a
             JOIN (SELECT record_type, accurate_id, MAX(version) AS v FROM accurate_records
                    WHERE entity_id = ? AND record_type IN (${DOC_TYPES}) GROUP BY record_type, accurate_id) m
               ON m.record_type = a.record_type AND m.accurate_id = a.accurate_id AND m.v = a.version
            WHERE a.entity_id = ? AND a.missing = 0 AND a.trans_date > ${TODAY} + INTERVAL ${FUTURE_TOLERANCE_DAYS} DAY`,
  },
  {
    key: 'so_stale',
    label: `SO belum terkirim penuh, lewat janji kirim lebih dari ${SO_STALE_DAYS} hari`,
    fix: 'Sisa barang di SO ini tidak dikirim lagi? Tutup SO-nya di Accurate supaya tidak terus muncul di jadwal kirim gudang.',
    binds: 1,
    // Owned by the SO's division (its customer channel), like the other Sales documents.
    from: `SELECT (SELECT d.id FROM departments d WHERE d.entity_id = o.entity_id AND d.deleted_at IS NULL
                     AND d.code COLLATE utf8mb4_unicode_ci = IF(o.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales') LIMIT 1) AS department_id,
                  o.number AS ref, o.customer_name AS name, DATE_FORMAT(${promisedSql('o')}, '%Y-%m-%d') AS detail,
                  DATEDIFF(${TODAY}, ${promisedSql('o')}) AS value
             FROM wh_so_open_accurate o
            WHERE o.entity_id = ? AND ${promisedSql('o')} < ${TODAY} - INTERVAL ${SO_STALE_DAYS} DAY`,
  },
  {
    key: 'unit_names',
    label: 'Nama satuan tidak seragam',
    fix: 'Satuan yang sama ditulis berbeda (misalnya Pcs dan PCS, atau Ctn dan Ctns). Seragamkan namanya di Accurate supaya jumlah bisa dijumlahkan.',
    binds: 2,
    // Same name but for letter case or a plural "s": Pcs · PCS, Ctn · Ctns · CTN.
    from: `SELECT ${WAREHOUSE} AS department_id, v.ref, v.variants AS name,
                  CONCAT(v.items, ' barang') AS detail, v.items AS value
             FROM (SELECT MIN(u.unit_name) AS ref,
                          GROUP_CONCAT(DISTINCT u.unit_name COLLATE utf8mb4_bin ORDER BY u.unit_name COLLATE utf8mb4_bin SEPARATOR ' · ') AS variants,
                          COUNT(DISTINCT u.item_id) AS items
                     FROM item_units_accurate u WHERE u.entity_id = ?
                    GROUP BY TRIM(TRAILING 's' FROM LOWER(u.unit_name))
                   HAVING COUNT(DISTINCT u.unit_name COLLATE utf8mb4_bin) > 1) v`,
  },
];

const scopeOf = (departmentId) => (departmentId ? { sql: ' WHERE q.department_id = ?', args: [departmentId] } : { sql: '', args: [] });

// Each check: how many, and the first ROW_LIMIT to pass on.
async function list(entityId, { departmentId = null } = {}) {
  const out = [];
  for (const check of CHECKS) {
    const scope = scopeOf(departmentId);
    const binds = Array(check.binds).fill(entityId);
    const [rows] = await pool.query(
      `SELECT q.ref, q.name, q.detail, q.value FROM (${check.from}) q${scope.sql} ORDER BY ABS(q.value) DESC, q.ref LIMIT ${ROW_LIMIT}`,
      [...binds, ...scope.args],
    );
    const [[count]] = await pool.query(`SELECT COUNT(*) AS n FROM (${check.from}) q${scope.sql}`, [...binds, ...scope.args]);
    out.push({
      key: check.key, label: check.label, fix: check.fix, count: Number(count.n),
      rows: rows.map((r) => ({ ref: r.ref, name: r.name, detail: r.detail, value: r.value === null ? null : Number(r.value) })),
    });
  }
  return out;
}

// All checks in one number (management KPI): one query.
function totalQuery(entityId, departmentId = null) {
  const scope = scopeOf(departmentId);
  const parts = CHECKS.map((c) => `SELECT '${c.key}' AS k, q.department_id FROM (${c.from}) q${scope.sql}`);
  const args = CHECKS.flatMap((c) => [...Array(c.binds).fill(entityId), ...scope.args]);
  return { sql: `SELECT k, COUNT(*) AS n FROM (${parts.join(' UNION ALL ')}) x GROUP BY k`, args };
}

module.exports = { CHECKS, list, totalQuery, TRANSFER_STUCK_DAYS, FUTURE_TOLERANCE_DAYS };
