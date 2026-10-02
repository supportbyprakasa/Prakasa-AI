-- ============================================================
-- Migration 097 — Sales 2.3: a return is deducted from the right salesperson
--
-- In 095 a return took its customer's mapped salesperson, while an invoice
-- takes Accurate's salesman first — so a return could come off someone who
-- never sold to that customer. Now a return takes the salesperson of the
-- customer's latest invoice on or before the return date, then the customer's
-- mapped salesperson. Views only; nothing copied or changed. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW sales_revenue_accurate AS
SELECT i.entity_id, i.department_id, 'invoice' COLLATE utf8mb4_unicode_ci AS kind, i.id AS doc_id, i.invoice_number AS number,
       i.trans_date, i.customer_code, i.customer_id, i.customer_name, i.channel, i.sales_person_name, i.dpp_amount AS amount
  FROM sales_invoices_accurate i
 WHERE NOT i.is_dp
UNION ALL
SELECT r.entity_id, r.department_id, 'return' COLLATE utf8mb4_unicode_ci, r.id, r.return_number,
       r.trans_date, r.customer_code, r.customer_id, r.customer_name, r.channel,
       COALESCE(
         (SELECT i.sales_person_name FROM sales_invoices_accurate i
           WHERE i.entity_id = r.entity_id AND i.customer_code = r.customer_code AND i.trans_date <= r.trans_date
           ORDER BY i.trans_date DESC, i.id DESC LIMIT 1),
         (SELECT c.sales_person_name COLLATE utf8mb4_unicode_ci FROM sales_customers c
           WHERE c.entity_id = r.entity_id AND c.customer_code COLLATE utf8mb4_unicode_ci = r.customer_code AND c.deleted_at IS NULL
           ORDER BY c.id LIMIT 1)),
       -r.dpp_amount
  FROM sales_returns_accurate r;
