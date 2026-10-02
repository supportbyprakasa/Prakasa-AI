-- ============================================================
-- Migration 125 — one set of sales figures on every page (data-consistency audit)
--
-- Decisions (product/finance lead, delegated by the owner):
--
--   Opening balance  Accurate's opening balance is 71 invoices SI.2025.12.*
--                    dated 2025-12-31 with no product line, no sales order,
--                    no PPN and due on the invoice date. They are money owed
--                    (they stay in receivables) but not sales of that month:
--                    they are left out of revenue (sales_revenue_accurate) and
--                    a customer carried in by them is an existing customer,
--                    never a new one (NOO). Rule — is_opening:
--                      invoice date on or before 2025-12-31 (the opening
--                      balance date, OPENING_BALANCE_DATE in
--                      src/services/invoiceRules.js — kept in step by a test)
--                      AND no product line AND no sales order.
--                    A real invoice always has lines, so it can never match.
--   Channel          An invoice's channel is read from its customer number
--                    (salesPull.channelFromCustomerCode). When that gives none,
--                    the app's customer master channel (sales_customers.channel)
--                    is used, so revenue per channel is the same everywhere.
--                    The division still follows the invoice's own channel, as
--                    in every other mirror view. Intercompany customers stay
--                    in (an owner decision); they only get their channel.
--   NOO              Counted per Accurate customer (customer number) from the
--                    invoices — sales_customer_orders_accurate — so a customer
--                    missing from the app's master still counts.
--   Product revenue  sales_invoice_lines_accurate now carries each line's share
--                    of its invoice DPP (revenue, as mg_invoice_lines_accurate)
--                    and is_dp, so "per produk (sebelum PPN)" adds up to DPP.
--
-- Views only over the insert-only mirror: nothing copied, changed or removed.
-- Definitions copied from 095/097 (invoices, revenue), 070 (returns),
-- 067 (customers), 101 (lines) and 071 (invoice lines). Idempotent.
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
       COALESCE(NULLIF(a.channel, ''),
         (SELECT c.channel COLLATE utf8mb4_unicode_ci FROM sales_customers c
           WHERE c.entity_id = a.entity_id AND c.customer_code COLLATE utf8mb4_unicode_ci = a.customer_no
             AND c.deleted_at IS NULL AND NULLIF(c.channel, '') IS NOT NULL
           ORDER BY c.id LIMIT 1)) AS channel,
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
       COALESCE(JSON_EXTRACT(a.data, '$.dp') = TRUE, FALSE) AS is_dp,
       (a.trans_date <= '2025-12-31'
         AND COALESCE(JSON_LENGTH(a.data, '$.lines'), 0) = 0
         AND COALESCE(JSON_LENGTH(a.data, '$.so_numbers'), 0) = 0) AS is_opening
  FROM accurate_latest a
 WHERE a.record_type = 'sales_invoice';

CREATE OR REPLACE VIEW sales_returns_accurate AS
SELECT a.accurate_id AS id,
       a.entity_id,
       (SELECT d.id FROM departments d
         WHERE d.entity_id = a.entity_id AND d.deleted_at IS NULL
           AND d.code COLLATE utf8mb4_unicode_ci = IF(a.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales')
         LIMIT 1) AS department_id,
       a.number AS return_number,
       a.trans_date,
       a.customer_no AS customer_code,
       (SELECT c.id FROM sales_customers c
         WHERE c.entity_id = a.entity_id AND c.customer_code COLLATE utf8mb4_unicode_ci = a.customer_no AND c.deleted_at IS NULL
         ORDER BY c.id LIMIT 1) AS customer_id,
       a.customer_name,
       COALESCE(NULLIF(a.channel, ''),
         (SELECT c.channel COLLATE utf8mb4_unicode_ci FROM sales_customers c
           WHERE c.entity_id = a.entity_id AND c.customer_code COLLATE utf8mb4_unicode_ci = a.customer_no
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
           WHERE c.entity_id = r.entity_id AND c.customer_code COLLATE utf8mb4_unicode_ci = r.customer_code AND c.deleted_at IS NULL
           ORDER BY c.id LIMIT 1)),
       -r.dpp_amount
  FROM sales_returns_accurate r;

-- One row per Accurate customer (customer number) that has an invoice: first
-- and last invoice, the first real order (opening balance left out) and the
-- NOO date — none for a customer the opening balance carried in (an existing
-- customer). Channel and division are those of its first real order.
CREATE OR REPLACE VIEW sales_customer_orders_accurate AS
SELECT y.entity_id, y.customer_code, y.customer_id, y.customer_name, y.channel, y.department_id,
       y.first_at, y.last_at, y.first_order_at,
       IF(y.opening_invoices > 0, NULL, y.first_order_at) AS noo_date,
       y.opening_invoices
  FROM (SELECT i.entity_id, i.customer_code, i.customer_id, i.customer_name, i.channel, i.department_id,
               ROW_NUMBER() OVER (PARTITION BY i.entity_id, i.customer_code ORDER BY i.is_opening, i.trans_date, i.id) AS rn,
               MIN(i.trans_date) OVER w AS first_at,
               MAX(i.trans_date) OVER w AS last_at,
               MIN(CASE WHEN NOT i.is_opening THEN i.trans_date END) OVER w AS first_order_at,
               SUM(i.is_opening) OVER w AS opening_invoices
          FROM sales_invoices_accurate i
        WINDOW w AS (PARTITION BY i.entity_id, i.customer_code)) y
 WHERE y.rn = 1;

-- The app's own customers with their order dates from Accurate (067): the NOO
-- date now follows sales_customer_orders_accurate (opening balance is no order).
CREATE OR REPLACE VIEW sales_customers_accurate AS
SELECT c.id, c.entity_id, c.department_id, c.name, c.contact_person, c.phone, c.email, c.address, c.city,
       c.segment, c.notes, c.owner_user_id, c.created_by, c.created_at, c.updated_at, c.deleted_at,
       c.customer_code, c.channel, c.legal_form, c.business_phone, c.sales_person_name,
       ai.noo_date AS noo_date,
       ai.last_at AS last_order_date,
       c.source, c.synced_at, c.last_order_import, c.noo_import
  FROM sales_customers c
  LEFT JOIN sales_customer_orders_accurate ai
    ON ai.entity_id = c.entity_id AND ai.customer_code = c.customer_code COLLATE utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW mg_invoice_lines_accurate AS
SELECT y.invoice_id, y.entity_id, y.department_id, y.invoice_number, y.trans_date, y.customer_code, y.channel, y.is_dp,
       y.line_no, y.item_code, y.item_name, y.qty, y.unit, y.amount, y.invoice_dpp,
       y.amount * y.invoice_dpp / NULLIF(y.lines_amount, 0) AS revenue
  FROM (SELECT r.accurate_id AS invoice_id, r.entity_id,
               (SELECT d.id FROM departments d
                 WHERE d.entity_id = r.entity_id AND d.deleted_at IS NULL
                   AND d.code COLLATE utf8mb4_unicode_ci = IF(r.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales')
                 LIMIT 1) AS department_id,
               r.number AS invoice_number, r.trans_date, r.customer_no AS customer_code,
               COALESCE(NULLIF(r.channel, ''),
                 (SELECT c.channel COLLATE utf8mb4_unicode_ci FROM sales_customers c
                   WHERE c.entity_id = r.entity_id AND c.customer_code COLLATE utf8mb4_unicode_ci = r.customer_no
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

-- Invoice lines with the invoice's customer and salesperson (071), now on the
-- lines view above: `revenue` is the line's share of the invoice DPP — the same
-- figure Marketing and the margin estimate read — and is_dp marks down payments.
CREATE OR REPLACE VIEW sales_invoice_lines_accurate AS
SELECT l.invoice_id, l.entity_id, l.department_id, l.invoice_number, l.trans_date, i.customer_id, i.customer_name,
       l.channel, i.sales_person_name, l.item_code, l.item_name, l.qty, l.unit, l.amount,
       l.revenue, l.is_dp, l.customer_code
  FROM mg_invoice_lines_accurate l
  JOIN sales_invoices_accurate i ON i.entity_id = l.entity_id AND i.id = l.invoice_id;
