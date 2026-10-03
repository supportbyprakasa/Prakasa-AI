-- ============================================================
-- Migration 058 — Sales: invoice due dates, targets per salesperson
--
--   * sales_orders.due_date: when an invoice must be paid. Set when the
--     invoice is made (invoice date + payment terms, or chosen by hand), so
--     later changes to the terms do not move old invoices.
--   * sales_invoice_reminders: one row per reminder sent about a late invoice
--     (when it becomes overdue, and again at 30 days), never twice.
--   * sales_person_targets: monthly revenue and new-customer (NOO) targets per
--     salesperson account, set by Sales supervisors.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_orders' AND COLUMN_NAME = 'due_date');
SET @s := IF(@c = 0, 'ALTER TABLE sales_orders ADD COLUMN due_date DATE NULL, ADD INDEX idx_sales_order_due (entity_id, due_date)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS sales_invoice_reminders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  order_id INT UNSIGNED NOT NULL,
  kind ENUM('overdue', 'overdue_30') NOT NULL,
  recipients INT NOT NULL DEFAULT 0,
  notified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (order_id) REFERENCES sales_orders(id),
  UNIQUE KEY uq_sales_invoice_reminder (order_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_person_targets (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  month DATE NOT NULL,
  revenue_target DECIMAL(18,2) NULL,
  noo_target INT NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id),
  UNIQUE KEY uq_sales_person_target (entity_id, user_id, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
