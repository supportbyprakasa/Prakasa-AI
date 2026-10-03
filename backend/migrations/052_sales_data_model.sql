-- ============================================================
-- Migration 052 — Sales data model mirrored from the Sales Data Tracker
--
-- The Sales team already runs its business in a Google Sheet ("Sales Data
-- Tracker": Customer List, Data Master, SKU) and in visit exports from the
-- field app ("DailyVisits (Leads)"). Instead of retyping that data one record
-- at a time, the app now MIRRORS it:
--   * sales_customers gains the tracker's customer code, channel and order
--     dates, so Aktif / Dormant / Lost is derived, never typed;
--   * sales_leads holds visited outlets that are not customers yet;
--   * sales_orders + sales_order_lines hold every sales order with its
--     surat jalan (DO) and invoice numbers, per line as in the sheet;
--   * sales_products is the SKU master;
--   * sales_sync_runs records every read of the sheet or upload of a visit file.
-- The sheet is only ever READ. Nothing here writes back to Google.
-- Idempotent. Additive only.
-- ============================================================
SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- A. sales_customers — tracker fields. Status is derived from last_order_date:
--    < 30 days Aktif, 30-59 Dormant, >= 60 or never ordered Lost.
-- ------------------------------------------------------------

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_customers' AND COLUMN_NAME = 'customer_code');
SET @s := IF(@c = 0, 'ALTER TABLE sales_customers ADD COLUMN customer_code VARCHAR(60) NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_customers' AND COLUMN_NAME = 'channel');
SET @s := IF(@c = 0, 'ALTER TABLE sales_customers ADD COLUMN channel VARCHAR(40) NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_customers' AND COLUMN_NAME = 'legal_form');
SET @s := IF(@c = 0, 'ALTER TABLE sales_customers ADD COLUMN legal_form VARCHAR(10) NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_customers' AND COLUMN_NAME = 'business_phone');
SET @s := IF(@c = 0, 'ALTER TABLE sales_customers ADD COLUMN business_phone VARCHAR(40) NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_customers' AND COLUMN_NAME = 'sales_person_name');
SET @s := IF(@c = 0, 'ALTER TABLE sales_customers ADD COLUMN sales_person_name VARCHAR(120) NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_customers' AND COLUMN_NAME = 'noo_date');
SET @s := IF(@c = 0, 'ALTER TABLE sales_customers ADD COLUMN noo_date DATE NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_customers' AND COLUMN_NAME = 'last_order_date');
SET @s := IF(@c = 0, 'ALTER TABLE sales_customers ADD COLUMN last_order_date DATE NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_customers' AND COLUMN_NAME = 'source');
SET @s := IF(@c = 0, 'ALTER TABLE sales_customers ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT ''manual''', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_customers' AND COLUMN_NAME = 'synced_at');
SET @s := IF(@c = 0, 'ALTER TABLE sales_customers ADD COLUMN synced_at TIMESTAMP NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_customers' AND INDEX_NAME = 'uq_sales_cust_code');
SET @s := IF(@c = 0, 'ALTER TABLE sales_customers ADD UNIQUE KEY uq_sales_cust_code (entity_id, customer_code)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_customers' AND INDEX_NAME = 'idx_sales_cust_last_order');
SET @s := IF(@c = 0, 'ALTER TABLE sales_customers ADD INDEX idx_sales_cust_last_order (entity_id, last_order_date)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ------------------------------------------------------------
-- B. sales_leads — outlets the field team visited that are not customers yet.
--    customer_id is filled once the outlet is linked to a customer.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_leads (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  outlet_code VARCHAR(60) NOT NULL,
  name VARCHAR(190) NOT NULL,
  address VARCHAR(500) NULL,
  area VARCHAR(120) NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  sales_person_name VARCHAR(120) NULL,
  owner_user_id INT UNSIGNED NULL,
  customer_id INT UNSIGNED NULL,
  first_visit_date DATE NULL,
  last_visit_date DATE NULL,
  visit_count INT NOT NULL DEFAULT 0,
  last_note VARCHAR(500) NULL,
  status ENUM('open','dropped') NOT NULL DEFAULT 'open',
  source VARCHAR(20) NOT NULL DEFAULT 'visit_file',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (owner_user_id) REFERENCES users(id),
  FOREIGN KEY (customer_id) REFERENCES sales_customers(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uq_sales_lead_code (entity_id, outlet_code),
  INDEX idx_sales_lead_last_visit (entity_id, last_visit_date),
  INDEX idx_sales_lead_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- C. sales_visit_reports — room for visits imported from the field app.
--    external_key makes a re-upload of the same file update, not duplicate.
-- ------------------------------------------------------------

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'lead_id');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD COLUMN lead_id INT UNSIGNED NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'outlet_code');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD COLUMN outlet_code VARCHAR(60) NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'outlet_name');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD COLUMN outlet_name VARCHAR(190) NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'area');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD COLUMN area VARCHAR(120) NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'sales_person_name');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD COLUMN sales_person_name VARCHAR(120) NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'check_in_at');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD COLUMN check_in_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'check_out_at');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD COLUMN check_out_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'duration_minutes');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD COLUMN duration_minutes INT NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'is_planned');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD COLUMN is_planned TINYINT(1) NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'is_visited');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD COLUMN is_visited TINYINT(1) NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'geo_mismatch');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD COLUMN geo_mismatch TINYINT(1) NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'distance_m');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD COLUMN distance_m INT NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'total_sales');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD COLUMN total_sales DECIMAL(18,2) NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'source');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT ''manual''', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND COLUMN_NAME = 'external_key');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD COLUMN external_key VARCHAR(160) NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND INDEX_NAME = 'uq_sales_visit_external');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD UNIQUE KEY uq_sales_visit_external (entity_id, external_key)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_visit_reports' AND INDEX_NAME = 'idx_sales_visit_lead');
SET @s := IF(@c = 0, 'ALTER TABLE sales_visit_reports ADD INDEX idx_sales_visit_lead (lead_id, visit_date)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ------------------------------------------------------------
-- D. sales_products — SKU master (tracker sheet "SKU").
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  sku_code VARCHAR(60) NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(20) NULL,
  cost_price DECIMAL(18,2) NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'sheet',
  synced_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  UNIQUE KEY uq_sales_product_sku (entity_id, sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- E. sales_orders — one row per sales order (tracker "Data Master" grouped).
--    An SO number alone is not unique in the sheet (the same number was used
--    for two customers three times), so the key is (SO number, customer code).
--    transaction_date follows ETD, exactly like the sheet's Month/Week columns.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_orders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  order_number VARCHAR(80) NOT NULL,
  customer_code VARCHAR(60) NOT NULL DEFAULT '',
  customer_id INT UNSIGNED NULL,
  customer_name VARCHAR(190) NULL,
  channel VARCHAR(40) NULL,
  sales_person_name VARCHAR(120) NULL,
  owner_user_id INT UNSIGNED NULL,
  order_date DATE NULL,
  delivery_date DATE NULL,
  transaction_date DATE NOT NULL,
  do_numbers VARCHAR(500) NULL,
  invoice_numbers VARCHAR(500) NULL,
  line_count INT NOT NULL DEFAULT 0,
  subtotal DECIMAL(18,2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  delivery_fee DECIMAL(18,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  outstanding_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  settled_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  source VARCHAR(20) NOT NULL DEFAULT 'sheet',
  synced_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (customer_id) REFERENCES sales_customers(id),
  FOREIGN KEY (owner_user_id) REFERENCES users(id),
  UNIQUE KEY uq_sales_order_key (entity_id, order_number, customer_code),
  INDEX idx_sales_order_date (entity_id, transaction_date),
  INDEX idx_sales_order_customer (customer_id, transaction_date),
  INDEX idx_sales_order_dept (entity_id, department_id, transaction_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  line_no INT NOT NULL,
  sku_code VARCHAR(60) NULL,
  product_name VARCHAR(255) NULL,
  qty DECIMAL(14,3) NOT NULL DEFAULT 0,
  unit_price DECIMAL(18,2) NOT NULL DEFAULT 0,
  line_total DECIMAL(18,2) NOT NULL DEFAULT 0,
  taxable TINYINT(1) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  delivery_fee DECIMAL(18,2) NOT NULL DEFAULT 0,
  outstanding_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  settled_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  do_number VARCHAR(80) NULL,
  invoice_number VARCHAR(80) NULL,
  FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
  UNIQUE KEY uq_sales_order_line (order_id, line_no),
  INDEX idx_sales_line_do (do_number),
  INDEX idx_sales_line_invoice (invoice_number),
  INDEX idx_sales_line_sku (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- F. sales_sync_runs — every read of the sheet / upload of a visit file.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_sync_runs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  source ENUM('sheet','visit_file') NOT NULL,
  status ENUM('running','success','failed','skipped') NOT NULL DEFAULT 'running',
  file_name VARCHAR(255) NULL,
  file_modified_at DATETIME NULL,
  stats JSON NULL,
  error_message VARCHAR(1000) NULL,
  triggered_by INT UNSIGNED NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (triggered_by) REFERENCES users(id),
  INDEX idx_sales_sync_recent (entity_id, source, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- G. Permissions
--    sales.order.view  — see sales orders, surat jalan and invoices
--    sales.sync.manage — run the sheet sync and upload visit files
-- ------------------------------------------------------------
INSERT INTO permissions (code, description)
SELECT 'sales.order.view', 'Lihat data sales: sales order, surat jalan, invoice'
 WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'sales.order.view');
INSERT INTO permissions (code, description)
SELECT 'sales.sync.manage', 'Jalankan sinkron Sales Data Tracker dan unggah file kunjungan'
 WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'sales.sync.manage');

-- Everyone who can see customers can see their orders.
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, p.id
  FROM role_permissions rp
  JOIN permissions pv ON pv.id = rp.permission_id AND pv.code = 'sales.customer.view'
  JOIN roles r ON r.id = rp.role_id AND r.deleted_at IS NULL
  CROSS JOIN permissions p
 WHERE p.code = 'sales.order.view'
   AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = p.id);

-- Sales supervisors and heads (they approve samples) and Super Admin run the sync.
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
 WHERE p.code = 'sales.sync.manage'
   AND r.deleted_at IS NULL
   AND (r.role_key = 'system.super_admin'
        OR EXISTS (SELECT 1 FROM role_permissions rp
                     JOIN permissions pa ON pa.id = rp.permission_id
                    WHERE rp.role_id = r.id AND pa.code = 'sales.sample.approve'))
   AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.permission_id = p.id);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
 WHERE p.code = 'sales.order.view'
   AND r.deleted_at IS NULL
   AND r.role_key = 'system.super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.permission_id = p.id);
