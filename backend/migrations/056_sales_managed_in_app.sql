-- ============================================================
-- Migration 056 — Sales data is managed in the app, not synced from Excel
--
-- Owner's decision (2026-09-29): Sales no longer depends on the Sales Data
-- Tracker sheet or the visit export. What was imported stays as the starting
-- data (source 'import') and is edited freely; everything new is entered here:
-- customers, leads and visits, sales orders with surat jalan, invoice and
-- payments, and the SKU list.
--
--   * source 'sheet' / 'visit_file' → 'import' (provenance only, no lock)
--   * sales_customers keeps the imported order dates as a baseline, so the
--     status stays right when app orders are added or cancelled
--   * sales_orders: who created it, surat jalan / invoice dates, notes
--   * sales_order_payments: every payment recorded, for the audit trail
--   * sales_products: unit, selling price, active flag
--   * permissions: sales.order.manage (enter and process orders) and
--     sales.master.manage (SKU list and salesperson mapping) replace
--     sales.sync.manage, which goes with the sync.
-- sales_sync_runs is kept untouched as history.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

UPDATE sales_customers SET source = 'import' WHERE source = 'sheet';
UPDATE sales_orders SET source = 'import' WHERE source = 'sheet';
UPDATE sales_products SET source = 'import' WHERE source = 'sheet';
UPDATE sales_leads SET source = 'import' WHERE source = 'visit_file';
UPDATE sales_visit_reports SET source = 'import' WHERE source = 'visit_file';

-- ------------------------------------------------------------ customers
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_customers' AND COLUMN_NAME = 'last_order_import');
SET @s := IF(@c = 0, 'ALTER TABLE sales_customers ADD COLUMN last_order_import DATE NULL, ADD COLUMN noo_import DATE NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE sales_customers
   SET last_order_import = last_order_date, noo_import = noo_date
 WHERE source = 'import' AND last_order_import IS NULL AND noo_import IS NULL;

-- ------------------------------------------------------------ orders
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_orders' AND COLUMN_NAME = 'created_by');
SET @s := IF(@c = 0, 'ALTER TABLE sales_orders
  ADD COLUMN do_date DATE NULL,
  ADD COLUMN invoice_date DATE NULL,
  ADD COLUMN notes TEXT NULL,
  ADD COLUMN created_by INT UNSIGNED NULL,
  ADD CONSTRAINT fk_sales_orders_created_by FOREIGN KEY (created_by) REFERENCES users(id)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS sales_order_payments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  paid_at DATE NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  method VARCHAR(40) NULL,
  note VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES sales_orders(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_sales_payment_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------ products
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_products' AND COLUMN_NAME = 'unit');
SET @s := IF(@c = 0, 'ALTER TABLE sales_products
  ADD COLUMN unit VARCHAR(20) NULL,
  ADD COLUMN price DECIMAL(18,2) NULL,
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The last price each SKU was sold at is a sensible default selling price.
UPDATE sales_products p
  JOIN (SELECT z.entity_id, z.sku_code, z.unit_price AS last_price
          FROM (SELECT o.entity_id, l.sku_code, l.unit_price,
                       ROW_NUMBER() OVER (PARTITION BY o.entity_id, l.sku_code ORDER BY o.transaction_date DESC, l.id DESC) AS rn
                  FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
                 WHERE o.deleted_at IS NULL AND l.sku_code IS NOT NULL) z
         WHERE z.rn = 1) x ON x.entity_id = p.entity_id AND x.sku_code = p.sku_code
   SET p.price = x.last_price
 WHERE p.price IS NULL;

-- ------------------------------------------------------------ permissions
INSERT INTO permissions (code, description)
SELECT 'sales.order.manage', 'Input sales order, surat jalan, invoice dan pembayaran'
 WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'sales.order.manage');
INSERT INTO permissions (code, description)
SELECT 'sales.master.manage', 'Kelola daftar produk (SKU) dan pemetaan nama sales'
 WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'sales.master.manage');

-- Whoever manages customers enters their orders.
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, p.id
  FROM role_permissions rp
  JOIN permissions pc ON pc.id = rp.permission_id AND pc.code = 'sales.customer.manage'
  JOIN roles r ON r.id = rp.role_id AND r.deleted_at IS NULL
  CROSS JOIN permissions p
 WHERE p.code = 'sales.order.manage'
   AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = p.id);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE p.code = 'sales.order.manage' AND r.role_key = 'system.super_admin' AND r.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.permission_id = p.id);

-- Master data goes to whoever ran the sync: Sales / Retail Commerce supervisors and heads, Super Admin.
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, p.id
  FROM roles r CROSS JOIN permissions p
 WHERE p.code = 'sales.master.manage' AND r.deleted_at IS NULL
   AND (r.role_key = 'system.super_admin'
        OR EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions ps ON ps.id = rp.permission_id
                    WHERE rp.role_id = r.id AND ps.code = 'sales.sync.manage'))
   AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.permission_id = p.id);

DELETE rp FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.code = 'sales.sync.manage';
DELETE FROM permissions WHERE code = 'sales.sync.manage';
