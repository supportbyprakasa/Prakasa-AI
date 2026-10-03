-- ============================================================
-- Migration 092 — Warehouse 2.2: shipped quantities are in base units
--
-- Accurate gives a SO line's shipped quantity (shipQuantity) in BASE units, the
-- ordered quantity in the line's unit (the same model as PO lines; see 088).
-- 091 subtracted one from the other. Here: remaining in base units = ordered ×
-- ratio − shipped, and both shown back in the line's unit. The mirror is
-- unchanged. Views only. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW wh_so_open_lines_accurate AS
SELECT y.so_id, y.entity_id, y.number, y.customer_name, y.ship_date, y.line_no, y.item_no, y.item_name, y.qty, y.unit, y.unit_ratio,
       y.shipped_base / y.ratio AS shipped_qty,
       y.remaining_base / y.ratio AS remaining_qty,
       y.remaining_base, y.warehouse
  FROM (SELECT r.accurate_id AS so_id, r.entity_id, r.number, r.customer_name,
               JSON_VALUE(r.data, '$.ship_date' RETURNING DATE) AS ship_date,
               l.line_no, l.item_no, l.item_name, l.qty, l.unit, l.unit_ratio,
               COALESCE(NULLIF(l.unit_ratio, 0), 1) AS ratio,
               COALESCE(l.shipped_qty, 0) AS shipped_base,
               IF(l.closed, 0, GREATEST(l.qty * COALESCE(NULLIF(l.unit_ratio, 0), 1) - COALESCE(l.shipped_qty, 0), 0)) AS remaining_base,
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
         WHERE r.record_type = 'wh_so_open' AND r.missing = 0) y;
