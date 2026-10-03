-- ============================================================
-- Migration 098 — Procurement: a Tgl kirim on or before the PO date is "not set"
--
-- Accurate fills a PO's Tgl kirim (shipDate) with the PO date unless someone
-- changes it: 341 of the 347 POs in the first Procurement batch carry exactly
-- the PO date. Read as a promise, every PO was due the day it was issued, so
-- "PO terlambat datang" fired two days later and "PO datang tepat waktu"
-- measured same-day delivery. Decision (Head Supply Chain, 30 Sep 2026,
-- delegated by the owner): only a Tgl kirim AFTER the PO date is a promise
-- (expected_date); otherwise the existing fallback applies, PO date + 14 days,
-- labelled "perkiraan". procurementRules.promisedExpected() is the same rule in
-- JavaScript. The mirror keeps Accurate's value; only this reading changes.
-- Same columns, same order as 087 (pc_po_prices_accurate reads this view).
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
               -- Only a Tgl kirim AFTER the PO date is a promise (see header).
               IF(JSON_VALUE(r.data, '$.expected_date' RETURNING DATE) > r.trans_date,
                  JSON_VALUE(r.data, '$.expected_date' RETURNING DATE), NULL) AS expected_date,
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
