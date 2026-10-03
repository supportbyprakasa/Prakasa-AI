-- ============================================================
-- Migration 071 — invoice lines view reads the mirror table directly
--
-- JSON_TABLE cannot take its document from a column of a materialized view,
-- so the lines view unnests accurate_records itself (latest non-missing
-- version) and joins the invoice view for the rest. View only. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW sales_invoice_lines_accurate AS
SELECT i.id AS invoice_id, i.entity_id, i.department_id, i.invoice_number, i.trans_date, i.customer_id, i.customer_name,
       i.channel, i.sales_person_name, l.item_code, l.item_name, l.qty, l.unit, l.amount
  FROM accurate_records r
  JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
         WHERE record_type = 'sales_invoice' GROUP BY entity_id, accurate_id) m
    ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
  JOIN JSON_TABLE(r.data, '$.lines[*]' COLUMNS (
         item_code VARCHAR(80) PATH '$.item_no',
         item_name VARCHAR(255) PATH '$.item_name',
         qty DECIMAL(18,3) PATH '$.qty',
         unit VARCHAR(40) PATH '$.unit',
         amount DECIMAL(18,2) PATH '$.amount')) l
  JOIN sales_invoices_accurate i ON i.entity_id = r.entity_id AND i.id = r.accurate_id
 WHERE r.record_type = 'sales_invoice' AND r.missing = 0;
