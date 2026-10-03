-- ============================================================
-- Migration 057 — Company details printed on Sales documents
--
-- Sales Order, Surat Jalan, Invoice and Kwitansi are printed (or saved as
-- PDF) from the app. What they show about the company — address, NPWP, bank
-- accounts, payment terms, standard notes — is kept here, one row per entity,
-- and filled in by whoever holds sales.master.manage. Empty fields are simply
-- left off the documents. The header image is the division's letterhead
-- (letterhead_assets) when one was uploaded.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS sales_document_settings (
  entity_id INT UNSIGNED NOT NULL PRIMARY KEY,
  company_name VARCHAR(190) NULL,
  address VARCHAR(500) NULL,
  phone VARCHAR(60) NULL,
  email VARCHAR(190) NULL,
  npwp VARCHAR(40) NULL,
  bank_accounts TEXT NULL,
  payment_terms_days INT NULL,
  invoice_note TEXT NULL,
  delivery_note TEXT NULL,
  updated_by INT UNSIGNED NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
