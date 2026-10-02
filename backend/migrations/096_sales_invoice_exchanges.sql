-- ============================================================
-- Migration 096 — Sales 2.3: tukar faktur
--
-- Accurate holds no tukar faktur (0 exchange-invoice documents), so Sales
-- records it here, per Accurate invoice number: when the invoice was handed
-- over, the receipt (tanda terima) number, and the date the customer promised
-- to pay. A record is never deleted: cancelling keeps it with cancelled_at.
-- New table only; no existing data is changed. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS sales_invoice_exchanges (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  invoice_number VARCHAR(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  customer_code VARCHAR(80) COLLATE utf8mb4_unicode_ci NULL,
  exchanged_on DATE NOT NULL,
  receipt_no VARCHAR(80) NULL,
  promised_pay_date DATE NULL,
  note VARCHAR(255) NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by INT UNSIGNED NULL,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMP NULL,
  cancelled_by INT UNSIGNED NULL,
  -- One live record per invoice: a cancelled one frees the slot (NULL is not unique).
  live_invoice VARCHAR(80) COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS (IF(cancelled_at IS NULL, invoice_number, NULL)) STORED,
  UNIQUE KEY uq_sales_invoice_exchanges_live (entity_id, live_invoice),
  KEY idx_sales_invoice_exchanges_invoice (entity_id, invoice_number),
  CONSTRAINT fk_sales_invoice_exchanges_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_sales_invoice_exchanges_created FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_sales_invoice_exchanges_updated FOREIGN KEY (updated_by) REFERENCES users(id),
  CONSTRAINT fk_sales_invoice_exchanges_cancelled FOREIGN KEY (cancelled_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
