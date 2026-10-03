-- ============================================================
-- Migration 090 — Warehouse documents: no delivery address, customer number instead
--
-- A delivery order keeps no ship-to address at all (free text cannot be cleaned
-- of every phone number or ID number reliably, and the mirror is permanent).
-- The documents view drops ship_to and exposes the customer number, whose city
-- segment tells where the goods go (PFN-PR-GT-JKT-0001 → Jakarta). Same views
-- as 078 otherwise. Views only; nothing copied or changed. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW wh_documents_accurate AS
SELECT a.accurate_id AS id, a.entity_id,
       (SELECT d.id FROM departments d WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL AND d.code = 'warehouse' LIMIT 1) AS department_id,
       (CASE a.record_type WHEN 'wh_delivery' THEN 'delivery' WHEN 'wh_receipt' THEN 'receipt'
            WHEN 'wh_transfer' THEN 'transfer' ELSE 'adjustment' END) COLLATE utf8mb4_unicode_ci AS doc_type,
       a.number, a.trans_date, a.status,
       COALESCE(a.customer_name, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.vendor_name')), 'null')) AS party,
       a.channel,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.from_wh')), 'null') AS from_wh,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.to_wh')), 'null') AS to_wh,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.transfer_type')), 'null') AS transfer_type,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.out_status')), 'null') AS out_status,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.kind')), 'null') AS kind,
       NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.supplier_do')), 'null') AS supplier_do,
       JSON_EXTRACT(a.data, '$.so_numbers') AS so_numbers,
       JSON_EXTRACT(a.data, '$.po_numbers') AS po_numbers,
       a.customer_no,
       JSON_LENGTH(JSON_EXTRACT(a.data, '$.lines')) AS line_count,
       a.batch_id, a.created_at AS approved_at
  FROM accurate_latest a
 WHERE a.record_type IN ('wh_delivery', 'wh_receipt', 'wh_transfer', 'wh_adjustment');

CREATE OR REPLACE VIEW wh_document_lines_accurate AS
SELECT r.accurate_id AS document_id, r.entity_id,
       (CASE r.record_type WHEN 'wh_delivery' THEN 'delivery' WHEN 'wh_receipt' THEN 'receipt'
            WHEN 'wh_transfer' THEN 'transfer' ELSE 'adjustment' END) COLLATE utf8mb4_unicode_ci AS doc_type,
       r.number, r.trans_date,
       l.line_no, l.item_no, l.item_name, l.qty, l.unit, l.unit_ratio, l.warehouse, l.direction, l.received_qty,
       COALESCE(l.so_number, l.po_number) AS reference
  FROM accurate_records r
  JOIN (SELECT entity_id, record_type, accurate_id, MAX(version) AS v FROM accurate_records
         WHERE record_type IN ('wh_delivery', 'wh_receipt', 'wh_transfer', 'wh_adjustment')
         GROUP BY entity_id, record_type, accurate_id) m
    ON m.entity_id = r.entity_id AND m.record_type = r.record_type AND m.accurate_id = r.accurate_id AND m.v = r.version
  JOIN JSON_TABLE(r.data, '$.lines[*]' COLUMNS (
         line_no FOR ORDINALITY,
         item_no VARCHAR(80) PATH '$.item_no',
         item_name VARCHAR(255) PATH '$.item_name',
         qty DECIMAL(18,4) PATH '$.qty',
         unit VARCHAR(40) PATH '$.unit',
         unit_ratio DECIMAL(18,4) PATH '$.unit_ratio',
         warehouse VARCHAR(120) PATH '$.warehouse',
         direction VARCHAR(10) PATH '$.direction',
         received_qty DECIMAL(18,4) PATH '$.received_qty',
         so_number VARCHAR(80) PATH '$.so_number',
         po_number VARCHAR(80) PATH '$.po_number')) l
 WHERE r.record_type IN ('wh_delivery', 'wh_receipt', 'wh_transfer', 'wh_adjustment') AND r.missing = 0;
