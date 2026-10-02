-- ============================================================
-- Migration 088 — Procurement: PO line quantities in the line's own unit
--
-- Accurate gives a PO line's received (shipQuantity), remaining and returned
-- quantities in BASE units (checked on 85 multi-unit lines: received = ordered ×
-- unit ratio, 41/41), while the ordered quantity is in the line's unit. 086 read
-- them side by side as if in one unit. This view converts them to the line's
-- unit, and also gives every quantity in base units. The mirror is unchanged
-- (it keeps Accurate's raw values with the ratio). Views only. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW pc_po_lines_accurate AS
SELECT y.po_id, y.entity_id, y.department_id, y.po_number, y.trans_date, y.vendor_no, y.line_no, y.item_no, y.item_name,
       y.qty, y.unit, y.unit_ratio,
       y.received_base / y.ratio AS received_qty,
       y.remaining_base / y.ratio AS remaining_qty,
       y.returned_base / y.ratio AS returned_qty,
       y.qty * y.ratio AS qty_base, y.received_base, y.remaining_base,
       y.closed, y.warehouse, y.pr_id
  FROM (SELECT r.accurate_id AS po_id, r.entity_id,
               (SELECT d.id FROM departments d WHERE d.entity_id = r.entity_id AND d.deleted_at IS NULL AND d.code = 'procurement' LIMIT 1) AS department_id,
               r.number AS po_number, r.trans_date,
               NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.vendor_no')), 'null') COLLATE utf8mb4_unicode_ci AS vendor_no,
               l.line_no, l.item_no, l.item_name, l.qty, l.unit, l.unit_ratio,
               COALESCE(NULLIF(l.unit_ratio, 0), 1) AS ratio,
               COALESCE(l.received_qty, 0) AS received_base,
               IF(l.closed, 0, COALESCE(l.remaining_qty, GREATEST(l.qty * COALESCE(NULLIF(l.unit_ratio, 0), 1) - COALESCE(l.received_qty, 0), 0))) AS remaining_base,
               COALESCE(l.returned_qty, 0) AS returned_base,
               l.closed = TRUE AS closed, l.warehouse, l.pr_id
          FROM accurate_records r
          JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
                 WHERE record_type = 'pc_po' GROUP BY entity_id, accurate_id) m
            ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
          JOIN JSON_TABLE(r.data, '$.lines[*]' COLUMNS (
                 line_no FOR ORDINALITY,
                 item_no VARCHAR(80) COLLATE utf8mb4_unicode_ci PATH '$.item_no',
                 item_name VARCHAR(255) COLLATE utf8mb4_unicode_ci PATH '$.item_name',
                 qty DECIMAL(18,4) PATH '$.qty',
                 unit VARCHAR(40) COLLATE utf8mb4_unicode_ci PATH '$.unit',
                 unit_ratio DECIMAL(18,4) PATH '$.unit_ratio',
                 received_qty DECIMAL(18,4) PATH '$.received_qty',
                 remaining_qty DECIMAL(18,4) PATH '$.remaining_qty',
                 returned_qty DECIMAL(18,4) PATH '$.returned_qty',
                 closed BOOLEAN PATH '$.closed',
                 warehouse VARCHAR(120) COLLATE utf8mb4_unicode_ci PATH '$.warehouse',
                 pr_id BIGINT PATH '$.pr_id')) l
         WHERE r.record_type = 'pc_po' AND r.missing = 0) y;
