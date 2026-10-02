-- ============================================================
-- Migration 132 — performance: one collation for the join keys, and the latest
-- mirror version without a GROUP BY (load test, 1 Oct 2026)
--
-- The load test found MySQL CPU-bound on the Sales mirror views:
--
--   Collation   sales_customers.customer_code and departments.code were
--               utf8mb4_0900_ai_ci (the server default when 001 ran) while the
--               Accurate mirror is utf8mb4_unicode_ci (066). The views
--               therefore compared `c.customer_code COLLATE utf8mb4_unicode_ci
--               = a.customer_no`: the cast is on the indexed side, so
--               uq_sales_cust_code could not be used and every invoice row
--               scanned the customer table (rows=185, loops=730 per view
--               read, three times per invoice). Both columns now ARE
--               utf8mb4_unicode_ci, so the comparisons drop the cast and use
--               the unique index. Results are identical: the views already
--               compared under utf8mb4_unicode_ci; only where the conversion
--               happens changes. Literal comparisons elsewhere in the app
--               (d.code = 'sales', ? parameters) are unaffected; no column of
--               another collation is compared with these two columns.
--               sales_customers.channel and sales_person_name stay as they
--               are (they are compared with other app tables); the views keep
--               naming the collation of those output values, as before.
--   Latest      accurate_latest picked the newest version with a
--               GROUP BY over the WHOLE mirror (all record types), which
--               MySQL materialises on every read. It is now "no newer version
--               exists" (NOT EXISTS over the unique key uq_accurate_records_
--               version): the same rows, mergeable into the caller's query, so
--               a WHERE on record_type / entity_id / trans_date reaches the
--               indexes.
--
-- Mirror tables are not touched (accurate_records stays insert-only); views
-- are recreated with the definitions of 067 (sales_so), 070 (sales_do,
-- sales_receipts) and 125 (invoices, returns, revenue, customers, invoice
-- lines), changed only as described. Idempotent: MODIFY to the same type and
-- collation is a no-op on a second run, CREATE OR REPLACE VIEW.
-- ============================================================
SET NAMES utf8mb4;

ALTER TABLE sales_customers
  MODIFY customer_code VARCHAR(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL;

ALTER TABLE departments
  MODIFY code VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL;

CREATE OR REPLACE VIEW accurate_latest AS
SELECT r.*
  FROM accurate_records r
 WHERE r.missing = 0
   AND NOT EXISTS (SELECT 1 FROM accurate_records n
                    WHERE n.entity_id = r.entity_id AND n.record_type = r.record_type
                      AND n.accurate_id = r.accurate_id AND n.version > r.version);

CREATE OR REPLACE VIEW sales_invoices_accurate AS
SELECT a.accurate_id AS id,
       a.entity_id,
       (SELECT d.id FROM departments d
         WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL
           AND d.code = IF(a.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales')
         LIMIT 1) AS department_id,
       a.number AS invoice_number,
       a.trans_date,
       a.due_date,
       a.customer_no AS customer_code,
       (SELECT c.id FROM sales_customers c
         WHERE c.entity_id = a.entity_id AND c.customer_code = a.customer_no AND c.deleted_at IS NULL
         ORDER BY c.id LIMIT 1) AS customer_id,
       a.customer_name,
       COALESCE(NULLIF(a.channel, ''),
         (SELECT c.channel COLLATE utf8mb4_unicode_ci FROM sales_customers c
           WHERE c.entity_id = a.entity_id AND c.customer_code = a.customer_no
             AND c.deleted_at IS NULL AND NULLIF(c.channel, '') IS NOT NULL
           ORDER BY c.id LIMIT 1)) AS channel,
       COALESCE(NULLIF(a.salesman, ''),
         (SELECT c.sales_person_name COLLATE utf8mb4_unicode_ci FROM sales_customers c
           WHERE c.entity_id = a.entity_id AND c.customer_code = a.customer_no AND c.deleted_at IS NULL
           ORDER BY c.id LIMIT 1)) AS sales_person_name,
       a.status,
       a.dpp_amount,
       a.total_amount,
       a.outstanding_amount,
       JSON_EXTRACT(a.data, '$.so_numbers') AS so_numbers,
       a.batch_id,
       a.created_at AS approved_at,
       COALESCE(JSON_EXTRACT(a.data, '$.dp') = TRUE, FALSE) AS is_dp,
       (a.trans_date <= '2025-12-31'
         AND COALESCE(JSON_LENGTH(a.data, '$.lines'), 0) = 0
         AND COALESCE(JSON_LENGTH(a.data, '$.so_numbers'), 0) = 0) AS is_opening
  FROM accurate_latest a
 WHERE a.record_type = 'sales_invoice';

CREATE OR REPLACE VIEW sales_so_accurate AS
SELECT a.accurate_id AS id,
       a.entity_id,
       (SELECT d.id FROM departments d
         WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL
           AND d.code = IF(a.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales')
         LIMIT 1) AS department_id,
       a.number AS order_number,
       a.trans_date,
       a.customer_no AS customer_code,
       (SELECT c.id FROM sales_customers c
         WHERE c.entity_id = a.entity_id AND c.customer_code = a.customer_no AND c.deleted_at IS NULL
         ORDER BY c.id LIMIT 1) AS customer_id,
       a.customer_name,
       a.channel,
       a.status,
       a.dpp_amount,
       a.total_amount,
       CAST(JSON_EXTRACT(a.data, '$.percent_shipped') AS DECIMAL(6,2)) AS percent_shipped
  FROM accurate_latest a
 WHERE a.record_type = 'sales_order';

CREATE OR REPLACE VIEW sales_do_accurate AS
SELECT a.accurate_id AS id, a.entity_id,
       (SELECT d.id FROM departments d WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL
           AND d.code = IF(a.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales') LIMIT 1) AS department_id,
       a.number AS do_number, a.trans_date, a.customer_no AS customer_code,
       (SELECT c.id FROM sales_customers c WHERE c.entity_id = a.entity_id AND c.customer_code = a.customer_no
           AND c.deleted_at IS NULL ORDER BY c.id LIMIT 1) AS customer_id,
       a.customer_name, a.channel, a.status,
       JSON_EXTRACT(a.data, '$.so_numbers') AS so_numbers
  FROM accurate_latest a WHERE a.record_type = 'delivery_order';

CREATE OR REPLACE VIEW sales_receipts_accurate AS
SELECT a.accurate_id AS id, a.entity_id,
       (SELECT d.id FROM departments d WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL
           AND d.code = IF(a.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales') LIMIT 1) AS department_id,
       a.number AS receipt_number, a.trans_date, a.customer_no AS customer_code,
       (SELECT c.id FROM sales_customers c WHERE c.entity_id = a.entity_id AND c.customer_code = a.customer_no
           AND c.deleted_at IS NULL ORDER BY c.id LIMIT 1) AS customer_id,
       a.customer_name, a.channel, a.total_amount,
       JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.bank')) AS bank,
       JSON_EXTRACT(a.data, '$.invoices') AS invoices
  FROM accurate_latest a WHERE a.record_type = 'sales_receipt';

CREATE OR REPLACE VIEW sales_returns_accurate AS
SELECT a.accurate_id AS id,
       a.entity_id,
       (SELECT d.id FROM departments d
         WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL
           AND d.code = IF(a.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales')
         LIMIT 1) AS department_id,
       a.number AS return_number,
       a.trans_date,
       a.customer_no AS customer_code,
       (SELECT c.id FROM sales_customers c
         WHERE c.entity_id = a.entity_id AND c.customer_code = a.customer_no AND c.deleted_at IS NULL
         ORDER BY c.id LIMIT 1) AS customer_id,
       a.customer_name,
       COALESCE(NULLIF(a.channel, ''),
         (SELECT c.channel COLLATE utf8mb4_unicode_ci FROM sales_customers c
           WHERE c.entity_id = a.entity_id AND c.customer_code = a.customer_no
             AND c.deleted_at IS NULL AND NULLIF(c.channel, '') IS NOT NULL
           ORDER BY c.id LIMIT 1)) AS channel,
       a.status,
       a.dpp_amount,
       a.total_amount
  FROM accurate_latest a
 WHERE a.record_type = 'sales_return';

CREATE OR REPLACE VIEW sales_revenue_accurate AS
SELECT i.entity_id, i.department_id, 'invoice' COLLATE utf8mb4_unicode_ci AS kind, i.id AS doc_id, i.invoice_number AS number,
       i.trans_date, i.customer_code, i.customer_id, i.customer_name, i.channel, i.sales_person_name, i.dpp_amount AS amount
  FROM sales_invoices_accurate i
 WHERE NOT i.is_dp AND NOT i.is_opening
UNION ALL
SELECT r.entity_id, r.department_id, 'return' COLLATE utf8mb4_unicode_ci, r.id, r.return_number,
       r.trans_date, r.customer_code, r.customer_id, r.customer_name, r.channel,
       COALESCE(
         (SELECT i.sales_person_name FROM sales_invoices_accurate i
           WHERE i.entity_id = r.entity_id AND i.customer_code = r.customer_code AND i.trans_date <= r.trans_date
           ORDER BY i.trans_date DESC, i.id DESC LIMIT 1),
         (SELECT c.sales_person_name COLLATE utf8mb4_unicode_ci FROM sales_customers c
           WHERE c.entity_id = r.entity_id AND c.customer_code = r.customer_code AND c.deleted_at IS NULL
           ORDER BY c.id LIMIT 1)),
       -r.dpp_amount
  FROM sales_returns_accurate r;

CREATE OR REPLACE VIEW sales_customers_accurate AS
SELECT c.id, c.entity_id, c.department_id, c.name, c.contact_person, c.phone, c.email, c.address, c.city,
       c.segment, c.notes, c.owner_user_id, c.created_by, c.created_at, c.updated_at, c.deleted_at,
       c.customer_code, c.channel, c.legal_form, c.business_phone, c.sales_person_name,
       ai.noo_date AS noo_date,
       ai.last_at AS last_order_date,
       c.source, c.synced_at, c.last_order_import, c.noo_import
  FROM sales_customers c
  LEFT JOIN sales_customer_orders_accurate ai
    ON ai.entity_id = c.entity_id AND ai.customer_code = c.customer_code;

CREATE OR REPLACE VIEW mg_invoice_lines_accurate AS
SELECT y.invoice_id, y.entity_id, y.department_id, y.invoice_number, y.trans_date, y.customer_code, y.channel, y.is_dp,
       y.line_no, y.item_code, y.item_name, y.qty, y.unit, y.amount, y.invoice_dpp,
       y.amount * y.invoice_dpp / NULLIF(y.lines_amount, 0) AS revenue
  FROM (SELECT r.accurate_id AS invoice_id, r.entity_id,
               (SELECT d.id FROM departments d
                 WHERE d.entity_id = r.entity_id AND d.deleted_at IS NULL
                   AND d.code = IF(r.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales')
                 LIMIT 1) AS department_id,
               r.number AS invoice_number, r.trans_date, r.customer_no AS customer_code,
               COALESCE(NULLIF(r.channel, ''),
                 (SELECT c.channel COLLATE utf8mb4_unicode_ci FROM sales_customers c
                   WHERE c.entity_id = r.entity_id AND c.customer_code = r.customer_no
                     AND c.deleted_at IS NULL AND NULLIF(c.channel, '') IS NOT NULL
                   ORDER BY c.id LIMIT 1)) AS channel,
               COALESCE(JSON_EXTRACT(r.data, '$.dp') = TRUE, FALSE) AS is_dp,
               l.line_no, l.item_code, l.item_name, l.qty, l.unit, l.amount,
               r.dpp_amount AS invoice_dpp,
               SUM(l.amount) OVER (PARTITION BY r.id) AS lines_amount
          FROM accurate_records r
          JOIN (SELECT entity_id, accurate_id, MAX(version) AS v FROM accurate_records
                 WHERE record_type = 'sales_invoice' GROUP BY entity_id, accurate_id) m
            ON m.entity_id = r.entity_id AND m.accurate_id = r.accurate_id AND m.v = r.version
          JOIN JSON_TABLE(JSON_EXTRACT(r.data, '$.lines'), '$[*]' COLUMNS (
                 line_no FOR ORDINALITY,
                 item_code VARCHAR(80) COLLATE utf8mb4_unicode_ci PATH '$.item_no',
                 item_name VARCHAR(255) COLLATE utf8mb4_unicode_ci PATH '$.item_name',
                 qty DECIMAL(18,4) PATH '$.qty',
                 unit VARCHAR(40) COLLATE utf8mb4_unicode_ci PATH '$.unit',
                 amount DECIMAL(18,2) PATH '$.amount')) l
         WHERE r.record_type = 'sales_invoice' AND r.missing = 0) y;
