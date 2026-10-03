-- ============================================================
-- Migration 070 — Sales & Retail Commerce complete: more Accurate read views
--
-- Views only over approved Accurate data (accurate_latest); nothing copied or
-- changed ("TEGAS"). Same division rule as the invoices (Shopee/TokoPedia →
-- Retail Commerce). Text comparisons name the collation (older app tables use
-- utf8mb4_0900_ai_ci, the Accurate tables utf8mb4_unicode_ci).
-- Idempotent (CREATE OR REPLACE).
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW sales_do_accurate AS
SELECT a.accurate_id AS id, a.entity_id,
       (SELECT d.id FROM departments d WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL
           AND d.code COLLATE utf8mb4_unicode_ci = IF(a.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales') LIMIT 1) AS department_id,
       a.number AS do_number, a.trans_date, a.customer_no AS customer_code,
       (SELECT c.id FROM sales_customers c WHERE c.entity_id = a.entity_id AND c.customer_code COLLATE utf8mb4_unicode_ci = a.customer_no
           AND c.deleted_at IS NULL ORDER BY c.id LIMIT 1) AS customer_id,
       a.customer_name, a.channel, a.status,
       JSON_EXTRACT(a.data, '$.so_numbers') AS so_numbers
  FROM accurate_latest a WHERE a.record_type = 'delivery_order';

CREATE OR REPLACE VIEW sales_receipts_accurate AS
SELECT a.accurate_id AS id, a.entity_id,
       (SELECT d.id FROM departments d WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL
           AND d.code COLLATE utf8mb4_unicode_ci = IF(a.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales') LIMIT 1) AS department_id,
       a.number AS receipt_number, a.trans_date, a.customer_no AS customer_code,
       (SELECT c.id FROM sales_customers c WHERE c.entity_id = a.entity_id AND c.customer_code COLLATE utf8mb4_unicode_ci = a.customer_no
           AND c.deleted_at IS NULL ORDER BY c.id LIMIT 1) AS customer_id,
       a.customer_name, a.channel, a.total_amount,
       JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.bank')) AS bank,
       JSON_EXTRACT(a.data, '$.invoices') AS invoices
  FROM accurate_latest a WHERE a.record_type = 'sales_receipt';

CREATE OR REPLACE VIEW sales_returns_accurate AS
SELECT a.accurate_id AS id, a.entity_id,
       (SELECT d.id FROM departments d WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL
           AND d.code COLLATE utf8mb4_unicode_ci = IF(a.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales') LIMIT 1) AS department_id,
       a.number AS return_number, a.trans_date, a.customer_no AS customer_code,
       (SELECT c.id FROM sales_customers c WHERE c.entity_id = a.entity_id AND c.customer_code COLLATE utf8mb4_unicode_ci = a.customer_no
           AND c.deleted_at IS NULL ORDER BY c.id LIMIT 1) AS customer_id,
       a.customer_name, a.channel, a.status, a.dpp_amount, a.total_amount
  FROM accurate_latest a WHERE a.record_type = 'sales_return';

CREATE OR REPLACE VIEW sales_items_accurate AS
SELECT a.accurate_id AS id, a.entity_id, a.number AS item_code, a.name, a.status,
       JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.category')) AS category,
       JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.type')) AS item_type,
       CAST(JSON_EXTRACT(a.data, '$.unit_price') AS DECIMAL(18,2)) AS unit_price
  FROM accurate_latest a WHERE a.record_type = 'item';

-- One row per product line of an approved invoice: revenue per product (before PPN).
CREATE OR REPLACE VIEW sales_invoice_lines_accurate AS
SELECT i.id AS invoice_id, i.entity_id, i.department_id, i.invoice_number, i.trans_date, i.customer_id, i.customer_name,
       i.channel, i.sales_person_name, l.item_code, l.item_name, l.qty, l.unit, l.amount
  FROM sales_invoices_accurate i
  JOIN accurate_latest a ON a.entity_id = i.entity_id AND a.record_type = 'sales_invoice' AND a.accurate_id = i.id
  JOIN JSON_TABLE(a.data, '$.lines[*]' COLUMNS (
         item_code VARCHAR(80) PATH '$.item_no',
         item_name VARCHAR(255) PATH '$.item_name',
         qty DECIMAL(18,3) PATH '$.qty',
         unit VARCHAR(40) PATH '$.unit',
         amount DECIMAL(18,2) PATH '$.amount')) l;
