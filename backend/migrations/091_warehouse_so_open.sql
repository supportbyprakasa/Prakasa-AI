-- ============================================================
-- Migration 091 — Warehouse 2.2: the shipping schedule from approved Accurate data
--
--   wh_so_open_accurate        sales orders not fully shipped (one row each)
--   wh_so_open_lines_accurate  what is still to ship per line, in the line's own
--                              unit and in base units (qty × unit ratio)
-- Views over the insert-only mirror (latest approved version, not "tidak ada
-- lagi"); nothing copied, changed or removed. Quantities only — no price, no
-- address. Dates are read with JSON_VALUE (see 087). Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW wh_so_open_accurate AS
SELECT r.accurate_id AS id, r.entity_id,
       (SELECT d.id FROM departments d WHERE d.entity_id = r.entity_id AND d.deleted_at IS NULL AND d.code = 'warehouse' LIMIT 1) AS department_id,
       r.number, r.trans_date, r.customer_no, r.customer_name, r.channel, r.status,
       JSON_VALUE(r.data, '$.ship_date' RETURNING DATE) AS ship_date,
       JSON_VALUE(r.data, '$.percent_shipped' RETURNING DECIMAL(9,4)) AS percent_shipped,
       JSON_LENGTH(JSON_EXTRACT(r.data, '$.lines')) AS line_count,
       r.batch_id, r.created_at AS approved_at
  FROM accurate_records r
  JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
         WHERE record_type = 'wh_so_open' GROUP BY entity_id, accurate_id) m
    ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
 WHERE r.record_type = 'wh_so_open' AND r.missing = 0;

CREATE OR REPLACE VIEW wh_so_open_lines_accurate AS
SELECT r.accurate_id AS so_id, r.entity_id, r.number, r.customer_name,
       JSON_VALUE(r.data, '$.ship_date' RETURNING DATE) AS ship_date,
       l.line_no, l.item_no, l.item_name, l.qty, l.unit, l.unit_ratio, COALESCE(l.shipped_qty, 0) AS shipped_qty,
       IF(l.closed, 0, GREATEST(l.qty - COALESCE(l.shipped_qty, 0), 0)) AS remaining_qty,
       IF(l.closed, 0, GREATEST(l.qty - COALESCE(l.shipped_qty, 0), 0)) * COALESCE(NULLIF(l.unit_ratio, 0), 1) AS remaining_base,
       l.warehouse
  FROM accurate_records r
  JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
         WHERE record_type = 'wh_so_open' GROUP BY entity_id, accurate_id) m
    ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
  JOIN JSON_TABLE(r.data, '$.lines[*]' COLUMNS (
         line_no FOR ORDINALITY,
         item_no VARCHAR(80) COLLATE utf8mb4_unicode_ci PATH '$.item_no',
         item_name VARCHAR(255) COLLATE utf8mb4_unicode_ci PATH '$.item_name',
         qty DECIMAL(18,4) PATH '$.qty',
         unit VARCHAR(40) COLLATE utf8mb4_unicode_ci PATH '$.unit',
         unit_ratio DECIMAL(18,4) PATH '$.unit_ratio',
         shipped_qty DECIMAL(18,4) PATH '$.shipped_qty',
         warehouse VARCHAR(120) COLLATE utf8mb4_unicode_ci PATH '$.warehouse',
         closed BOOLEAN PATH '$.closed')) l
 WHERE r.record_type = 'wh_so_open' AND r.missing = 0;
