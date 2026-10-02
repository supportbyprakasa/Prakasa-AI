-- ============================================================
-- Migration 087 — Procurement: read PO dates and numbers with JSON_VALUE
--
-- In 086, CAST(NULLIF(JSON_UNQUOTE(...), 'null') AS DATE) returned NULL on
-- MySQL 9.6 (the text is taken as the integer 2026), so every PO fell back to
-- "PO date + 14 days" and a late PO never showed. JSON_VALUE(... RETURNING type)
-- reads the stored value as that type and gives NULL for a JSON null.
-- Views only; nothing copied, changed or removed. Idempotent (CREATE OR REPLACE).
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW pc_po_accurate AS
SELECT x.*,
       (CASE WHEN x.closed OR x.status = 'Ditutup' THEN 'closed'
             WHEN x.percent_received >= 100 OR x.status = 'Terproses' THEN 'received'
             WHEN x.percent_received > 0 OR x.status = 'Sebagian diproses' THEN 'partial'
             ELSE 'open' END) COLLATE utf8mb4_unicode_ci AS po_state,
       COALESCE(x.expected_date, x.trans_date + INTERVAL 14 DAY) AS due_date_eff
  FROM (SELECT r.accurate_id AS id, r.entity_id, r.version,
               (SELECT d.id FROM departments d WHERE d.entity_id = r.entity_id AND d.deleted_at IS NULL AND d.code = 'procurement' LIMIT 1) AS department_id,
               r.number, r.trans_date, r.status,
               NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.vendor_no')), 'null') COLLATE utf8mb4_unicode_ci AS vendor_no,
               NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.vendor_name')), 'null') COLLATE utf8mb4_unicode_ci AS vendor_name,
               JSON_VALUE(r.data, '$.expected_date' RETURNING DATE) AS expected_date,
               JSON_VALUE(r.data, '$.percent_received' RETURNING DECIMAL(6,2)) AS percent_received,
               JSON_EXTRACT(r.data, '$.closed') = TRUE AS closed,
               NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.payment_term')), 'null') COLLATE utf8mb4_unicode_ci AS payment_term,
               JSON_VALUE(r.data, '$.term_days' RETURNING SIGNED) AS term_days,
               NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.currency')), 'null') COLLATE utf8mb4_unicode_ci AS currency,
               JSON_LENGTH(JSON_EXTRACT(r.data, '$.lines')) AS line_count,
               r.batch_id, r.created_at AS approved_at
          FROM accurate_records r
          JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
                 WHERE record_type = 'pc_po' GROUP BY entity_id, accurate_id) m
            ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
         WHERE r.record_type = 'pc_po' AND r.missing = 0) x;

CREATE OR REPLACE VIEW pc_po_prices_accurate AS
SELECT p.id AS po_id, p.entity_id, p.department_id, p.number, p.trans_date, p.vendor_no, p.vendor_name, p.currency, p.po_state,
       r.dpp_amount, r.total_amount,
       JSON_VALUE(r.data, '$.tax_amount' RETURNING DECIMAL(18,2)) AS tax_amount,
       NOT (p.po_state = 'closed' AND COALESCE(p.percent_received, 0) = 0) AS counts_as_spend
  FROM pc_po_accurate p
  JOIN accurate_records r ON r.entity_id = p.entity_id AND r.record_type = 'pc_po' AND r.accurate_id = p.id AND r.version = p.version;
