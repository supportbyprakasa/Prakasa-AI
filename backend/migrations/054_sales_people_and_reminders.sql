-- ============================================================
-- Migration 054 — Salespeople: who owns which customer, lead and order
--
-- The Sales Data Tracker names the salesperson as text ("Fajar",
-- "Liani / Windy"). sales_person_accounts maps each single name to an app
-- account; sales_owner_links is the resulting ownership of every synced record,
-- recomputed on each sync and each mapping change.
--
-- sales.data.view_all: see every Sales record. Without it (Sales members) a
-- user sees only the records they own. Granted to Sales/Retail Commerce
-- supervisors and heads, every Retail Commerce and Marketing role that can see
-- customers, and Super Admin.
--
-- sales_reminders: one row per reminder sent, so a dormant customer is not
-- reminded about twice for the same last order.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS sales_person_accounts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  sales_person_name VARCHAR(120) NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (updated_by) REFERENCES users(id),
  UNIQUE KEY uq_sales_person_name (entity_id, sales_person_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_owner_links (
  entity_id INT UNSIGNED NOT NULL,
  record_type ENUM('customer','order','lead') NOT NULL,
  record_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (record_type, record_id, user_id),
  INDEX idx_sales_owner_user (user_id, record_type),
  INDEX idx_sales_owner_entity (entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_reminders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  last_order_date DATE NOT NULL,
  kind ENUM('dormant','near_lost') NOT NULL,
  recipients INT NOT NULL DEFAULT 0,
  notified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (customer_id) REFERENCES sales_customers(id),
  UNIQUE KEY uq_sales_reminder (customer_id, last_order_date, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO permissions (code, description)
SELECT 'sales.data.view_all', 'Lihat semua data Sales (bukan hanya milik sendiri)'
 WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'sales.data.view_all');

INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
  LEFT JOIN departments d ON d.id = r.department_id
 WHERE p.code = 'sales.data.view_all'
   AND r.deleted_at IS NULL
   AND (
     r.role_key = 'system.super_admin'
     OR EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions ps ON ps.id = rp.permission_id
                 WHERE rp.role_id = r.id AND ps.code = 'sales.sync.manage')
     OR (d.code IN ('retail_commerce', 'marketing')
         AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions pc ON pc.id = rp.permission_id
                      WHERE rp.role_id = r.id AND pc.code = 'sales.customer.view'))
   )
   AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.permission_id = p.id);
