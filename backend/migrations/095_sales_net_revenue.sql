-- ============================================================
-- Migration 095 — Sales 2.3: revenue net of returns, without down-payment invoices
--
-- Owner decision: "Omzet dihitung bersih setelah retur, dan faktur uang muka
-- tidak dihitung".
--   sales_invoices_accurate  gains is_dp (a down-payment invoice: data.dp, which
--                            the pull stores only when Accurate says invoiceDp —
--                            so no other invoice gets a new version)
--   sales_revenue_accurate   one row per invoice (+DPP, down payments left out)
--                            and per return (−DPP), with the same division,
--                            customer and salesperson columns; a return's
--                            salesperson is its customer's (as the invoice fallback).
-- Views only over the insert-only mirror; nothing copied, changed or removed.
-- Idempotent (CREATE OR REPLACE).
-- ============================================================
SET NAMES utf8mb4;

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
       a.created_at AS approved_at,
       COALESCE(JSON_EXTRACT(a.data, '$.dp') = TRUE, FALSE) AS is_dp
  FROM accurate_latest a
 WHERE a.record_type = 'sales_invoice';

CREATE OR REPLACE VIEW sales_revenue_accurate AS
SELECT i.entity_id, i.department_id, 'invoice' COLLATE utf8mb4_unicode_ci AS kind, i.id AS doc_id, i.invoice_number AS number,
       i.trans_date, i.customer_code, i.customer_id, i.customer_name, i.channel, i.sales_person_name, i.dpp_amount AS amount
  FROM sales_invoices_accurate i
 WHERE NOT i.is_dp
UNION ALL
SELECT r.entity_id, r.department_id, 'return' COLLATE utf8mb4_unicode_ci, r.id, r.return_number,
       r.trans_date, r.customer_code, r.customer_id, r.customer_name, r.channel,
       (SELECT c.sales_person_name COLLATE utf8mb4_unicode_ci FROM sales_customers c
         WHERE c.entity_id = r.entity_id AND c.customer_code COLLATE utf8mb4_unicode_ci = r.customer_code AND c.deleted_at IS NULL
         ORDER BY c.id LIMIT 1),
       -r.dpp_amount
  FROM sales_returns_accurate r;
