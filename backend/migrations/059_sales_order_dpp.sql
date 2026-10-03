-- ============================================================
-- Migration 059 — Revenue on DPP (before PPN)
--
-- Owner's decision (2026-09-29): revenue ("omzet") is reported on DPP, the
-- amount before PPN, exactly like Accurate's "Penjualan per Pelanggan" report,
-- so the app's figures can be matched against the books.
--
-- Prices include PPN ("Total termasuk Pajak" in Accurate), so a taxable line's
-- DPP is its total / 1.11 and a non-taxable line's DPP is its total. The
-- delivery fee is billed but is not sales revenue, so it is left out.
-- total_amount keeps what the customer is billed (for invoices and payments).
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_orders' AND COLUMN_NAME = 'dpp_amount');
SET @s := IF(@c = 0, 'ALTER TABLE sales_orders ADD COLUMN dpp_amount DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER subtotal', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE sales_orders o
  JOIN (SELECT order_id, ROUND(SUM(IF(taxable = 1, line_total / 1.11, line_total)), 2) AS dpp
          FROM sales_order_lines GROUP BY order_id) l ON l.order_id = o.id
   SET o.dpp_amount = l.dpp;
