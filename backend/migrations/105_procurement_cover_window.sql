-- ============================================================
-- Migration 105 — Saran pesan ulang (program 3.1): the cover view reads only
-- its 30-day window; the last PO line is the main line of the latest PO
--
--   wh_stock_cover_accurate    as in 080 — same columns, same numbers — but it
--                              no longer runs LAG over every stock version ever
--                              approved (only the last 30 days are used; at a
--                              year of daily versions the old view took seconds
--                              and slowed saran pesan ulang, its KPI and
--                              escalation, "Barang menipis", the stock page and
--                              barang lambat laku (102), which all read it):
--                                out_30d       the drops of each version of the
--                                              last 30 days against the version
--                                              before it (version − 1: versions
--                                              are numbered 1, 2, 3… per item)
--                                history_days  from version 1, found through the
--                                              unique key (versions only grow
--                                              with time: approving inserts
--                                              MAX(version) + 1 at NOW())
--   pc_item_last_po_accurate   as in 089, except which line of the latest PO wins
--                              when the item is on it twice: the largest quantity
--                              in base units (then the last line). PO.2026.08.00030
--                              lists MKR-160 as 576 Pcs and, after it, 1 Pcs at
--                              Rp 2 (a bonus line); 089 took the 1 Pcs line as
--                              "PO terakhir" and could take its unit and ratio.
--   idx_accurate_records_type_created (record_type, created_at)
--                              one non-unique index; no row changes. Every
--                              "latest version per record" view (pc_po_*,
--                              pc_vendors, item_units, wh documents, sales…)
--                              groups one record type by MAX(version); with the
--                              unique key led by entity_id MySQL read the WHOLE
--                              mirror for it, and the mirror grows with every
--                              approved stock version (~1,300 rows per Warehouse
--                              approval). With this index it reads only that
--                              type, and the cover window reads only its 30 days.
--                              Measured with a year of simulated daily stock
--                              versions (rolled back), same rows: the saran
--                              query took 9–11 s before 105, 1.2–1.4 s with
--                              these views but without the index, 0.14–0.18 s
--                              with it.
-- barang lambat laku (mg_stock_idle_accurate, 102) reads the cover view by name
-- and takes the change as it is. 080 and 089 are not edited (applied, checksums
-- recorded). Views and one index over the insert-only mirror; nothing copied,
-- changed or removed. Idempotent (CREATE OR REPLACE; the index only when
-- missing).
-- ============================================================
SET NAMES utf8mb4;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accurate_records'
              AND INDEX_NAME = 'idx_accurate_records_type_created');
SET @s := IF(@c = 0, 'ALTER TABLE accurate_records ADD INDEX idx_accurate_records_type_created (record_type, created_at)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE OR REPLACE VIEW wh_stock_cover_accurate AS
SELECT f.entity_id, f.accurate_id AS item_id,
       COALESCE(w.out_30d, 0) AS out_30d,
       LEAST(30, GREATEST(0, DATEDIFF(NOW(), f.created_at))) AS history_days
  FROM accurate_records f
  LEFT JOIN (SELECT c.entity_id, c.accurate_id,
                    SUM(CASE WHEN CAST(JSON_EXTRACT(c.data, '$.qty') AS DECIMAL(18,4)) < CAST(JSON_EXTRACT(p.data, '$.qty') AS DECIMAL(18,4))
                             THEN CAST(JSON_EXTRACT(p.data, '$.qty') AS DECIMAL(18,4)) - CAST(JSON_EXTRACT(c.data, '$.qty') AS DECIMAL(18,4))
                             ELSE 0 END) AS out_30d
               FROM accurate_records c
               JOIN accurate_records p
                 ON p.entity_id = c.entity_id AND p.record_type = 'wh_stock_total'
                AND p.accurate_id = c.accurate_id AND p.version = c.version - 1
              WHERE c.record_type = 'wh_stock_total' AND c.created_at >= NOW() - INTERVAL 30 DAY
              GROUP BY c.entity_id, c.accurate_id) w
    ON w.entity_id = f.entity_id AND w.accurate_id = f.accurate_id
 WHERE f.record_type = 'wh_stock_total' AND f.version = 1;

CREATE OR REPLACE VIEW pc_item_last_po_accurate AS
SELECT z.entity_id, z.department_id, z.item_no, z.item_name, z.vendor_no, z.vendor_name,
       z.unit, z.ratio, z.qty, z.po_id, z.po_number, z.trans_date
  FROM (SELECT l.entity_id, l.department_id, l.item_no, l.item_name, l.vendor_no, p.vendor_name,
               l.unit, COALESCE(NULLIF(l.unit_ratio, 0), 1) AS ratio, l.qty, l.po_id, l.po_number, l.trans_date,
               ROW_NUMBER() OVER (PARTITION BY l.entity_id, l.item_no
                                  ORDER BY l.trans_date DESC, l.po_id DESC, l.qty_base DESC, l.line_no DESC) AS rn
          FROM pc_po_lines_accurate l
          JOIN pc_po_accurate p ON p.entity_id = l.entity_id AND p.id = l.po_id
         WHERE l.item_no IS NOT NULL AND l.qty > 0
           AND NOT (p.po_state = 'closed' AND COALESCE(p.percent_received, 0) = 0)) z
 WHERE z.rn = 1;
