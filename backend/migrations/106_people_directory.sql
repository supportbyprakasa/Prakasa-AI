-- ============================================================
-- Migration 106 — People & Culture wave 1, row 1.1: directory & locations
--
-- org_locations     per-entity work locations (PFN Office, Alsut Office …),
--                   shared by the directory, devices and (later) network/CCTV.
-- people_directory  one row per person of the entity: app users (the row only
--                   holds what the account does not — kind, position, manager,
--                   work phone, location, resign, notes; name/email/division are
--                   read from users, never copied) and people without an app
--                   account (their name, work email and division live here).
--                   No personal data: no salary, bank, NIK/KTP, NPWP, BPJS,
--                   address, birth date, password or account name.
--
-- Same-entity integrity is enforced by the database: UNIQUE (entity_id, id) on
-- both tables and composite foreign keys (entity_id, manager_id) and
-- (entity_id, location_id), so a manager or location of another entity cannot
-- be stored. "Manager is not the person themself" cannot be a CHECK in MySQL
-- (error 3818: a CHECK may not refer to an AUTO_INCREMENT column); the service
-- refuses it together with every longer cycle, inside a transaction that locks
-- the entity's directory rows.
--
-- Permissions (mirrors backend/src/config/standardOrganization.js):
--   people.directory.view    every standard role + Super Admin (work contacts only)
--   people.directory.manage  People & Culture Supervisor/Head + Super Admin
--
-- New tables only; no existing data is changed. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS org_locations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  kind ENUM('office', 'store', 'warehouse', 'other') NOT NULL DEFAULT 'office',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  notes VARCHAR(255) NULL,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_org_locations_entity_id (entity_id, id),
  -- utf8mb4_0900_ai_ci: "PFN Office" and "pfn office" are the same location.
  UNIQUE KEY uq_org_locations_entity_name (entity_id, name),
  CONSTRAINT chk_org_locations_name CHECK (CHAR_LENGTH(TRIM(name)) > 0 AND CAST(name AS BINARY) = CAST(TRIM(name) AS BINARY)),
  CONSTRAINT fk_org_locations_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_org_locations_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_org_locations_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS people_directory (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  kind ENUM('employee', 'group_staff', 'excluded') NOT NULL DEFAULT 'employee',
  excluded_reason VARCHAR(160) NULL,
  -- Only for a person without an app account (an account's name lives in users).
  full_name VARCHAR(150) NULL,
  name_key VARCHAR(150) GENERATED ALWAYS AS (LOWER(TRIM(full_name))) STORED,
  position VARCHAR(150) NULL,
  department_id INT UNSIGNED NULL,
  manager_id INT UNSIGNED NULL,
  work_email VARCHAR(190) NULL,
  work_phone VARCHAR(40) NULL,
  location_id INT UNSIGNED NULL,
  status ENUM('active', 'resigned') NOT NULL DEFAULT 'active',
  resigned_on DATE NULL,
  resigned_on_source ENUM('entered', 'import', 'account') NULL,
  notes VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_people_directory_entity_id (entity_id, id),
  UNIQUE KEY uq_people_directory_entity_user (entity_id, user_id),
  UNIQUE KEY uq_people_directory_entity_email (entity_id, work_email),
  KEY idx_people_directory_entity_name (entity_id, name_key),
  KEY idx_people_directory_entity_manager (entity_id, manager_id),
  KEY idx_people_directory_entity_location (entity_id, location_id),
  KEY idx_people_directory_department (department_id),
  CONSTRAINT chk_people_directory_excluded CHECK (kind <> 'excluded' OR CHAR_LENGTH(TRIM(COALESCE(excluded_reason, ''))) > 0),
  -- An account's name, email and division are read from users, never a second copy.
  CONSTRAINT chk_people_directory_account CHECK (
    (user_id IS NOT NULL AND full_name IS NULL AND work_email IS NULL AND department_id IS NULL)
    OR (user_id IS NULL AND full_name IS NOT NULL AND CHAR_LENGTH(TRIM(full_name)) > 0)),
  CONSTRAINT chk_people_directory_name_trim CHECK (full_name IS NULL OR CAST(full_name AS BINARY) = CAST(TRIM(full_name) AS BINARY)),
  CONSTRAINT chk_people_directory_email_lower CHECK (work_email IS NULL OR CAST(work_email AS BINARY) = CAST(LOWER(TRIM(work_email)) AS BINARY)),
  -- A resigned person always has a resign date and where it came from.
  CONSTRAINT chk_people_directory_resign CHECK (
    (status = 'resigned' AND resigned_on IS NOT NULL AND resigned_on_source IS NOT NULL)
    OR (status = 'active' AND resigned_on IS NULL AND resigned_on_source IS NULL)),
  CONSTRAINT fk_people_directory_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_people_directory_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_people_directory_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_people_directory_manager FOREIGN KEY (entity_id, manager_id) REFERENCES people_directory(entity_id, id),
  CONSTRAINT fk_people_directory_location FOREIGN KEY (entity_id, location_id) REFERENCES org_locations(entity_id, id),
  CONSTRAINT fk_people_directory_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_people_directory_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO permissions (code, description) VALUES
('people.directory.view', 'Lihat direktori karyawan (kontak kerja: nama, jabatan, divisi, atasan, email/telepon kerja, lokasi)'),
('people.directory.manage', 'Kelola direktori karyawan dan struktur organisasi (People & Culture)');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'people.directory.view'
 WHERE r.deleted_at IS NULL
   AND r.role_key IN (
     'operations.member', 'operations.supervisor', 'operations.head',
     'finance.member', 'finance.supervisor', 'finance.head',
     'procurement.member', 'procurement.supervisor', 'procurement.head',
     'sales.member', 'sales.supervisor', 'sales.head',
     'people_culture.member', 'people_culture.supervisor', 'people_culture.head',
     'management_office.member', 'management_office.supervisor', 'management_office.head',
     'retail_commerce.member', 'retail_commerce.supervisor', 'retail_commerce.head',
     'warehouse.member', 'warehouse.supervisor', 'warehouse.head',
     'marketing.member', 'marketing.supervisor', 'marketing.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'people.directory.manage'
 WHERE r.deleted_at IS NULL AND r.role_key IN ('people_culture.supervisor', 'people_culture.head');

-- Super Admin keeps every permission.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('people.directory.view', 'people.directory.manage')
 WHERE (r.role_key = 'system.super_admin' OR LOWER(r.name) IN ('super admin', 'superadmin')) AND r.deleted_at IS NULL;
