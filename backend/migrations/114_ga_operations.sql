-- ============================================================
-- Migration 114 — Operasional GA (owner, 1 Oct 2026): office operations run
-- by GA inside People & Culture, now that Operations is not a division
-- (migration 113). Three registers per entity, owned by the entity's People &
-- Culture division (department_id, set by the service) and placed at a
-- location of the same entity (composite foreign key to org_locations):
--   ga_maintenance_items  scheduled upkeep: AC service, APAR refill, genset,
--                         pest control … with an interval and the next due date
--   ga_maintenance_logs   append-only history of upkeep done on an item
--   ga_contracts          service and lease contracts: building lease,
--                         cleaning, security, pest control, waste …
--   ga_utility_bills      monthly electricity / water / gas bills per location
--
-- Payments stay in Finance (pengajuan pembayaran); a bill here only records
-- the amount, the due date and the day it was paid.
--
-- No delete: an item or contract ends in a status; logs are append-only.
-- Every editable row carries `version` (optimistic lock, 409 VERSION_CONFLICT).
--
-- Permissions (mirrors backend/src/config/standardOrganization.js):
--   ga.ops.view    People & Culture member/supervisor/head + Super Admin
--   ga.ops.manage  People & Culture supervisor/head + Super Admin
-- Recording upkeep done (a log) needs ga.ops.view + ga.request.process: the
-- GA staff who do the work record it.
--
-- New tables and permissions only; no existing data is changed.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS ga_maintenance_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  category ENUM('ac', 'apar', 'genset', 'lift', 'pest_control', 'water', 'electrical', 'building', 'other') NOT NULL,
  name VARCHAR(150) NOT NULL,
  vendor_name VARCHAR(150) NULL,
  interval_days SMALLINT UNSIGNED NOT NULL,
  last_done_on DATE NULL,
  next_due_on DATE NOT NULL,
  status ENUM('active', 'retired') NOT NULL DEFAULT 'active',
  status_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ga_maintenance_items_entity_id (entity_id, id),
  KEY idx_ga_maintenance_items_due (entity_id, status, next_due_on),
  KEY idx_ga_maintenance_items_location (entity_id, location_id),
  KEY idx_ga_maintenance_items_department (department_id),
  CONSTRAINT chk_ga_maintenance_items_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
  CONSTRAINT chk_ga_maintenance_items_interval CHECK (interval_days BETWEEN 1 AND 1830),
  CONSTRAINT fk_ga_maintenance_items_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_ga_maintenance_items_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_ga_maintenance_items_location FOREIGN KEY (entity_id, location_id) REFERENCES org_locations (entity_id, id),
  CONSTRAINT fk_ga_maintenance_items_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_ga_maintenance_items_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- due_on: the item's next_due_on when this was recorded, so "on time" never
-- changes when the schedule is edited later.
CREATE TABLE IF NOT EXISTS ga_maintenance_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  item_id INT UNSIGNED NOT NULL,
  done_on DATE NOT NULL,
  due_on DATE NULL,
  result ENUM('ok', 'follow_up') NOT NULL DEFAULT 'ok',
  cost DECIMAL(15,2) NULL,
  note VARCHAR(500) NULL,
  done_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ga_maintenance_logs_item (entity_id, item_id, done_on),
  KEY idx_ga_maintenance_logs_done (entity_id, done_on),
  CONSTRAINT chk_ga_maintenance_logs_cost CHECK (cost IS NULL OR cost >= 0),
  CONSTRAINT fk_ga_maintenance_logs_item FOREIGN KEY (entity_id, item_id) REFERENCES ga_maintenance_items (entity_id, id),
  CONSTRAINT fk_ga_maintenance_logs_done_by FOREIGN KEY (done_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ga_contracts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  location_id INT UNSIGNED NULL,
  kind ENUM('building_lease', 'cleaning', 'security', 'pest_control', 'waste', 'maintenance', 'other') NOT NULL,
  vendor_name VARCHAR(150) NOT NULL,
  description VARCHAR(190) NULL,
  start_on DATE NULL,
  end_on DATE NULL,
  notice_days SMALLINT UNSIGNED NOT NULL DEFAULT 60,
  monthly_cost DECIMAL(15,2) NULL,
  status ENUM('active', 'ended') NOT NULL DEFAULT 'active',
  status_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ga_contracts_entity_id (entity_id, id),
  KEY idx_ga_contracts_end (entity_id, status, end_on),
  KEY idx_ga_contracts_department (department_id),
  CONSTRAINT chk_ga_contracts_vendor CHECK (CHAR_LENGTH(TRIM(vendor_name)) > 0),
  CONSTRAINT chk_ga_contracts_dates CHECK (start_on IS NULL OR end_on IS NULL OR end_on >= start_on),
  CONSTRAINT chk_ga_contracts_notice CHECK (notice_days <= 365),
  CONSTRAINT chk_ga_contracts_cost CHECK (monthly_cost IS NULL OR monthly_cost >= 0),
  CONSTRAINT fk_ga_contracts_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_ga_contracts_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_ga_contracts_location FOREIGN KEY (entity_id, location_id) REFERENCES org_locations (entity_id, id),
  CONSTRAINT fk_ga_contracts_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_ga_contracts_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One bill per location, utility, meter (customer number) and month.
CREATE TABLE IF NOT EXISTS ga_utility_bills (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  utility ENUM('electricity', 'water', 'gas', 'other') NOT NULL,
  customer_number VARCHAR(60) NULL,
  customer_key VARCHAR(60) GENERATED ALWAYS AS (COALESCE(UPPER(TRIM(customer_number)), '')) STORED,
  period CHAR(7) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  usage_amount DECIMAL(15,2) NULL,
  due_on DATE NULL,
  paid_on DATE NULL,
  notes VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ga_utility_bills_entity_id (entity_id, id),
  UNIQUE KEY uq_ga_utility_bills_period (entity_id, location_id, utility, customer_key, period),
  KEY idx_ga_utility_bills_due (entity_id, paid_on, due_on),
  KEY idx_ga_utility_bills_period (entity_id, period),
  KEY idx_ga_utility_bills_department (department_id),
  CONSTRAINT chk_ga_utility_bills_period CHECK (period REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT chk_ga_utility_bills_amount CHECK (amount >= 0),
  CONSTRAINT chk_ga_utility_bills_usage CHECK (usage_amount IS NULL OR usage_amount >= 0),
  CONSTRAINT fk_ga_utility_bills_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_ga_utility_bills_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_ga_utility_bills_location FOREIGN KEY (entity_id, location_id) REFERENCES org_locations (entity_id, id),
  CONSTRAINT fk_ga_utility_bills_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_ga_utility_bills_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------ permissions
INSERT IGNORE INTO permissions (code, description) VALUES
('ga.ops.view', 'Lihat Operasional GA: perawatan berkala, kontrak & sewa, dan tagihan utilitas (termasuk biaya)'),
('ga.ops.manage', 'Kelola Operasional GA: jadwal perawatan, kontrak & sewa, dan tagihan utilitas (People & Culture)');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'ga.ops.view'
 WHERE r.deleted_at IS NULL AND r.role_key IN ('people_culture.member', 'people_culture.supervisor', 'people_culture.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'ga.ops.manage'
 WHERE r.deleted_at IS NULL AND r.role_key IN ('people_culture.supervisor', 'people_culture.head');

-- Super Admin keeps every permission.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('ga.ops.view', 'ga.ops.manage')
 WHERE r.role_key = 'system.super_admin' AND r.deleted_at IS NULL;
