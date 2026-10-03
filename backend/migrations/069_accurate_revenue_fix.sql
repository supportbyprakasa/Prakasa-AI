-- ============================================================
-- Migration 069 — Accurate batches can be withdrawn; salesperson fallback
--
-- 1. A batch the submitter takes back before anyone decides (e.g. a mapping
--    mistake) is kept and marked 'withdrawn' — never deleted.
-- 2. Most Accurate invoices carry no salesperson; the view then shows the
--    salesperson the app already has for that customer (read only).
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

ALTER TABLE sales_accurate_batches MODIFY status ENUM('pending','applied','rejected','withdrawn') NOT NULL DEFAULT 'pending';

CREATE OR REPLACE VIEW sales_invoices_accurate AS
SELECT a.accurate_id AS id,
       a.entity_id,
       (SELECT d.id FROM departments d
         WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL
           AND d.code COLLATE utf8mb4_unicode_ci = IF(a.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales')
         LIMIT 1) AS department_id,
       a.number AS invoice_number,
       a.trans_date,
       a.due_date,
       a.customer_no AS customer_code,
       (SELECT c.id FROM sales_customers c
         WHERE c.entity_id = a.entity_id AND c.customer_code COLLATE utf8mb4_unicode_ci = a.customer_no AND c.deleted_at IS NULL
         ORDER BY c.id LIMIT 1) AS customer_id,
       a.customer_name,
       a.channel,
       COALESCE(NULLIF(a.salesman, ''),
         (SELECT c.sales_person_name COLLATE utf8mb4_unicode_ci FROM sales_customers c
           WHERE c.entity_id = a.entity_id AND c.customer_code COLLATE utf8mb4_unicode_ci = a.customer_no AND c.deleted_at IS NULL
           ORDER BY c.id LIMIT 1)) AS sales_person_name,
       a.status,
       a.dpp_amount,
       a.total_amount,
       a.outstanding_amount,
       JSON_EXTRACT(a.data, '$.so_numbers') AS so_numbers,
       a.batch_id,
       a.created_at AS approved_at
  FROM accurate_latest a
 WHERE a.record_type = 'sales_invoice';
