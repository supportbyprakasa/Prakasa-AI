-- ============================================================
-- Migration 086 — Procurement stage 1: vendors and POs from approved Accurate
-- data (docs/program-4-divisi.md 2.1; owner decisions P1–P3)
--
--   pc_vendors_accurate          vendors (no contact, tax or bank data exists)
--   pc_po_accurate               POs — quantities, dates, state; NO price column
--   pc_po_lines_accurate         PO lines in each line's own unit; NO price column
--   pc_po_prices_accurate        PO values (P1: price viewers only, via the
--   pc_po_price_lines_accurate   price service and the management provider)
--   pc_receipts_accurate         Warehouse-approved receipts (D4), shown under
--   pc_po_receipts_accurate      Procurement; never pulled or approved by it
-- Views only over the insert-only mirror (latest approved version, not "tidak
-- ada lagi"); nothing copied, changed or removed ("TEGAS"). Each view filters
-- its record type inside its own MAX(version) table. JSON text is compared as
-- utf8mb4_unicode_ci (lesson of 078); JSON_TABLE reads accurate_records itself
-- (lesson of 071). JSON nulls become SQL NULL. Idempotent (CREATE OR REPLACE).
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW pc_vendors_accurate AS
SELECT r.accurate_id AS id, r.entity_id,
       (SELECT d.id FROM departments d WHERE d.entity_id = r.entity_id AND d.deleted_at IS NULL AND d.code = 'procurement' LIMIT 1) AS department_id,
       r.number AS vendor_no, r.name, r.status,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.category')), 'null') COLLATE utf8mb4_unicode_ci AS category,
       r.batch_id, r.created_at AS approved_at
  FROM accurate_records r
  JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
         WHERE record_type = 'pc_vendor' GROUP BY entity_id, accurate_id) m
    ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
 WHERE r.record_type = 'pc_vendor' AND r.missing = 0;

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
               CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.expected_date')), 'null') AS DATE) AS expected_date,
               CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.percent_received')), 'null') AS DECIMAL(6,2)) AS percent_received,
               JSON_EXTRACT(r.data, '$.closed') = TRUE AS closed,
               NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.payment_term')), 'null') COLLATE utf8mb4_unicode_ci AS payment_term,
               CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.term_days')), 'null') AS SIGNED) AS term_days,
               NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.currency')), 'null') COLLATE utf8mb4_unicode_ci AS currency,
               JSON_LENGTH(JSON_EXTRACT(r.data, '$.lines')) AS line_count,
               r.batch_id, r.created_at AS approved_at
          FROM accurate_records r
          JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
                 WHERE record_type = 'pc_po' GROUP BY entity_id, accurate_id) m
            ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
         WHERE r.record_type = 'pc_po' AND r.missing = 0) x;

CREATE OR REPLACE VIEW pc_po_lines_accurate AS
SELECT r.accurate_id AS po_id, r.entity_id,
       (SELECT d.id FROM departments d WHERE d.entity_id = r.entity_id AND d.deleted_at IS NULL AND d.code = 'procurement' LIMIT 1) AS department_id,
       r.number AS po_number, r.trans_date,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.vendor_no')), 'null') COLLATE utf8mb4_unicode_ci AS vendor_no,
       l.line_no, l.item_no, l.item_name, l.qty, l.unit, l.unit_ratio, COALESCE(l.received_qty, 0) AS received_qty,
       IF(l.closed, 0, COALESCE(l.remaining_qty, GREATEST(l.qty - COALESCE(l.received_qty, 0), 0))) AS remaining_qty,
       COALESCE(l.returned_qty, 0) AS returned_qty, l.closed = TRUE AS closed, l.warehouse, l.pr_id
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
 WHERE r.record_type = 'pc_po' AND r.missing = 0;

-- Prices (P1). Read only by procurementPrices.service and the management provider.
CREATE OR REPLACE VIEW pc_po_prices_accurate AS
SELECT p.id AS po_id, p.entity_id, p.department_id, p.number, p.trans_date, p.vendor_no, p.vendor_name, p.currency, p.po_state,
       r.dpp_amount, r.total_amount,
       CAST(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.tax_amount')), 'null') AS DECIMAL(18,2)) AS tax_amount,
       NOT (p.po_state = 'closed' AND COALESCE(p.percent_received, 0) = 0) AS counts_as_spend
  FROM pc_po_accurate p
  JOIN accurate_records r ON r.entity_id = p.entity_id AND r.record_type = 'pc_po' AND r.accurate_id = p.id AND r.version = p.version;

CREATE OR REPLACE VIEW pc_po_price_lines_accurate AS
SELECT r.accurate_id AS po_id, r.entity_id,
       (SELECT d.id FROM departments d WHERE d.entity_id = r.entity_id AND d.deleted_at IS NULL AND d.code = 'procurement' LIMIT 1) AS department_id,
       r.number AS po_number, r.trans_date,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.vendor_no')), 'null') COLLATE utf8mb4_unicode_ci AS vendor_no,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.data, '$.vendor_name')), 'null') COLLATE utf8mb4_unicode_ci AS vendor_name,
       l.line_no, l.item_no, l.item_name, l.unit, l.unit_ratio, l.unit_price, l.disc_pct, l.line_total,
       IF(l.unit_ratio > 0, l.unit_price / l.unit_ratio, NULL) AS price_per_base
  FROM accurate_records r
  JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
         WHERE record_type = 'pc_po' GROUP BY entity_id, accurate_id) m
    ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
  JOIN JSON_TABLE(r.data, '$.lines[*]' COLUMNS (
         line_no FOR ORDINALITY,
         item_no VARCHAR(80) COLLATE utf8mb4_unicode_ci PATH '$.item_no',
         item_name VARCHAR(255) COLLATE utf8mb4_unicode_ci PATH '$.item_name',
         unit VARCHAR(40) COLLATE utf8mb4_unicode_ci PATH '$.unit',
         unit_ratio DECIMAL(18,4) PATH '$.unit_ratio',
         unit_price DECIMAL(18,2) PATH '$.unit_price',
         disc_pct DECIMAL(9,4) PATH '$.disc_pct',
         line_total DECIMAL(18,2) PATH '$.line_total')) l
 WHERE r.record_type = 'pc_po' AND r.missing = 0;

-- Receipts are the Warehouse's (D4): the same approved rows, under Procurement.
CREATE OR REPLACE VIEW pc_receipts_accurate AS
SELECT w.id, w.entity_id,
       (SELECT d.id FROM departments d WHERE d.entity_id = w.entity_id AND d.deleted_at IS NULL AND d.code = 'procurement' LIMIT 1) AS department_id,
       w.number, w.trans_date,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.vendor_no')), 'null') COLLATE utf8mb4_unicode_ci AS vendor_no,
       w.party AS vendor_name, w.supplier_do, w.po_numbers, JSON_LENGTH(w.po_numbers) AS po_count, w.line_count
  FROM wh_documents_accurate w
  JOIN accurate_latest a ON a.entity_id = w.entity_id AND a.record_type = 'wh_receipt' AND a.accurate_id = w.id
 WHERE w.doc_type = 'receipt';

CREATE OR REPLACE VIEW pc_po_receipts_accurate AS
SELECT l.document_id AS receipt_id, l.entity_id,
       (SELECT d.id FROM departments d WHERE d.entity_id = l.entity_id AND d.deleted_at IS NULL AND d.code = 'procurement' LIMIT 1) AS department_id,
       l.number AS receipt_number, l.trans_date AS received_on,
       l.reference COLLATE utf8mb4_unicode_ci AS po_number, l.item_no, l.qty, l.unit, l.unit_ratio, l.warehouse
  FROM wh_document_lines_accurate l
 WHERE l.doc_type = 'receipt' AND l.reference IS NOT NULL;
