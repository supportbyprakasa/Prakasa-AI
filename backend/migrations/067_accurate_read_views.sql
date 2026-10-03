-- ============================================================
-- Migration 067 — Tahap B: Sales numbers read approved Accurate data
--
-- Views only: nothing is copied, changed or removed (owner, "TEGAS"). They
-- present the latest approved, still-existing version of each Accurate record
-- (accurate_records) in the shapes the Sales screens need:
--   accurate_latest            latest non-missing version per record
--   sales_invoices_accurate    invoices (Faktur): revenue = DPP, receivables, due dates
--   sales_so_accurate          sales orders, with how much has been shipped
--   sales_customers_accurate   the app's customers, with first/last order dates
--                              taken from Accurate invoices instead of the recap
-- Division follows the customer number's channel (Shopee/TokoPedia → Retail
-- Commerce), the same rule as the approval batches.
-- The app's older tables use utf8mb4_0900_ai_ci and the Accurate tables
-- utf8mb4_unicode_ci, so text comparisons name the collation explicitly.
-- Idempotent (CREATE OR REPLACE).
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW accurate_latest AS
SELECT r.*
  FROM accurate_records r
  JOIN (SELECT entity_id, record_type, accurate_id, MAX(version) AS v
          FROM accurate_records GROUP BY entity_id, record_type, accurate_id) m
    ON m.entity_id = r.entity_id AND m.record_type = r.record_type AND m.accurate_id = r.accurate_id AND m.v = r.version
 WHERE r.missing = 0;

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
       a.salesman AS sales_person_name,
       a.status,
       a.dpp_amount,
       a.total_amount,
       a.outstanding_amount,
       JSON_EXTRACT(a.data, '$.so_numbers') AS so_numbers,
       a.batch_id,
       a.created_at AS approved_at
  FROM accurate_latest a
 WHERE a.record_type = 'sales_invoice';

CREATE OR REPLACE VIEW sales_so_accurate AS
SELECT a.accurate_id AS id,
       a.entity_id,
       (SELECT d.id FROM departments d
         WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL
           AND d.code COLLATE utf8mb4_unicode_ci = IF(a.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales')
         LIMIT 1) AS department_id,
       a.number AS order_number,
       a.trans_date,
       a.customer_no AS customer_code,
       (SELECT c.id FROM sales_customers c
         WHERE c.entity_id = a.entity_id AND c.customer_code COLLATE utf8mb4_unicode_ci = a.customer_no AND c.deleted_at IS NULL
         ORDER BY c.id LIMIT 1) AS customer_id,
       a.customer_name,
       a.channel,
       a.status,
       a.dpp_amount,
       a.total_amount,
       CAST(JSON_EXTRACT(a.data, '$.percent_shipped') AS DECIMAL(6,2)) AS percent_shipped
  FROM accurate_latest a
 WHERE a.record_type = 'sales_order';

-- The app's own customers (leads, visits, PIC stay theirs), with their order
-- dates read from approved Accurate invoices. Same columns as sales_customers.
CREATE OR REPLACE VIEW sales_customers_accurate AS
SELECT c.id, c.entity_id, c.department_id, c.name, c.contact_person, c.phone, c.email, c.address, c.city,
       c.segment, c.notes, c.owner_user_id, c.created_by, c.created_at, c.updated_at, c.deleted_at,
       c.customer_code, c.channel, c.legal_form, c.business_phone, c.sales_person_name,
       ai.first_at AS noo_date,
       ai.last_at AS last_order_date,
       c.source, c.synced_at, c.last_order_import, c.noo_import
  FROM sales_customers c
  LEFT JOIN (SELECT entity_id, customer_code, MIN(trans_date) AS first_at, MAX(trans_date) AS last_at
               FROM sales_invoices_accurate GROUP BY entity_id, customer_code) ai
    ON ai.entity_id = c.entity_id AND ai.customer_code = c.customer_code COLLATE utf8mb4_unicode_ci;
