-- ============================================================
-- Migration 068 — reminder log for late Accurate invoices (Tahap B)
--
-- sales_invoice_reminders points at the app's own orders; Accurate invoices
-- live in the read views, so their "already reminded" marks get their own
-- log. Insert-only, like the rest of the Accurate side. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS accurate_invoice_reminders (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id    INT UNSIGNED NOT NULL,
  accurate_id  BIGINT NOT NULL,
  kind         VARCHAR(20) NOT NULL,
  recipients   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_accurate_invoice_reminders (entity_id, accurate_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
