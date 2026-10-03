-- ============================================================
-- Migration 101 — Management 3.3: what the "Perkiraan margin (harga PO)" reads
--
--   mg_invoice_lines_accurate    one row per product line of an approved faktur,
--                                with its share of the faktur's revenue: Accurate's
--                                line amount (salesAmount, before PPN) scaled so the
--                                lines add up to the faktur's DPP (total − PPN, the
--                                revenue of sales_revenue_accurate). Header discounts
--                                (marketplace vouchers) and charges land on the
--                                products pro rata. Down payments are marked is_dp.
--                                Quantities and selling amounts only.
--   pc_po_price_costs_accurate   PRICES (P1) — one row per approved PO line with
--                                its cost per base unit before PPN: the line total ×
--                                (PO DPP ÷ the PO's line totals) ÷ (qty × unit ratio),
--                                so PPN-inclusive prices and header discounts come
--                                out. Built on the existing price views with the
--                                same net-price rule as saran pesan ulang (3.1): only
--                                POs that count as spend (not cancelled) in rupiah.
--                                Read only by services/procurementPrices.service.js.
--
-- An estimate, not Accurate's accounting HPP (Accurate costs by average and its
-- cost endpoint needs write access, which stays closed). It leaves out principal
-- rebates and programmes that never appear on a PO.
-- Views only over the insert-only mirror; nothing copied, changed or removed
-- ("TEGAS"). JSON_TABLE reads accurate_records itself (lesson of 071), with
-- JSON_EXTRACT for the array (as in 099). Idempotent (CREATE OR REPLACE).
-- ============================================================
SET NAMES utf8mb4;

CREATE OR REPLACE VIEW mg_invoice_lines_accurate AS
SELECT y.invoice_id, y.entity_id, y.department_id, y.invoice_number, y.trans_date, y.customer_code, y.channel, y.is_dp,
       y.line_no, y.item_code, y.item_name, y.qty, y.unit, y.amount, y.invoice_dpp,
       y.amount * y.invoice_dpp / NULLIF(y.lines_amount, 0) AS revenue
  FROM (SELECT r.accurate_id AS invoice_id, r.entity_id,
               (SELECT d.id FROM departments d
                 WHERE d.entity_id = r.entity_id AND d.deleted_at IS NULL
                   AND d.code COLLATE utf8mb4_unicode_ci = IF(r.channel IN ('Shopee', 'TokoPedia'), 'retail_commerce', 'sales')
                 LIMIT 1) AS department_id,
               r.number AS invoice_number, r.trans_date, r.customer_no AS customer_code, r.channel,
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

CREATE OR REPLACE VIEW pc_po_price_costs_accurate AS
SELECT pl.po_id, pl.entity_id, pl.po_number, pl.trans_date, pl.vendor_no, pl.line_no, pl.item_no, pl.unit, pl.unit_ratio,
       q.qty_base, pl.unit_price, pl.line_total,
       v.dpp_amount / t.lines_total AS dpp_factor,
       pl.line_total * v.dpp_amount / t.lines_total / q.qty_base AS cost_per_base
  FROM pc_po_price_lines_accurate pl
  JOIN pc_po_lines_accurate q ON q.entity_id = pl.entity_id AND q.po_id = pl.po_id AND q.line_no = pl.line_no
  JOIN pc_po_prices_accurate v ON v.entity_id = pl.entity_id AND v.po_id = pl.po_id
  JOIN (SELECT s.entity_id, s.po_id, SUM(s.line_total) AS lines_total
          FROM pc_po_price_lines_accurate s GROUP BY s.entity_id, s.po_id) t
    ON t.entity_id = pl.entity_id AND t.po_id = pl.po_id
 WHERE v.counts_as_spend = 1 AND v.currency = 'IDR'
   AND q.qty_base > 0 AND pl.line_total > 0 AND v.dpp_amount > 0 AND t.lines_total > 0;
