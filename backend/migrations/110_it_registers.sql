-- ============================================================
-- Migration 110 — People & Culture wave 2, row 2.3: IT infrastructure
-- registers and company phone/mobile numbers
-- (docs/rancangan-people-culture-g2.md §4.1 and Bagian 5).
--
-- New registers, each per entity, owned by the entity's People & Culture
-- division (department_id, set by the service — wave-1 rule 17) and placed at
-- a location of the same entity (composite foreign key to org_locations):
--   it_isp_links        internet links per location (04_ISP_Info)
--   it_network_devices  routers, switches, access points, NVR/DVR … (03 - Network
--                       Devices) — kept apart from devices, so the user-device
--                       count stays equal to the owner's device report
--   it_cctv_systems     CCTV systems per location (08_CCTV_System)
--   it_backup_jobs      backup jobs (07_Backup_System); location optional (cloud)
--   it_backup_checks    append-only check history of a backup job
--   it_gws_reviews      append-only Google Workspace security reviews (06_Google_Workspace)
--   it_phone_lines      company mobile numbers and IP-phone extensions
--
-- Never stored, on purpose (keputusan 3, temuan S8): usernames and passwords
-- of routers/NVR/DVR, WiFi passwords, customer-portal logins, NVR/remote-app
-- accounts, verification codes, cloud/P2P IDs, encryption keys, admin account
-- names, recovery codes, PIN/PUK, SIM ICCID and personal numbers.
--
-- No delete: a register row ends in a status. Every editable register carries
-- `version` (optimistic lock, 409 VERSION_CONFLICT) and the status registers
-- carry `status_changed_at`, set by the app on every status change.
--
-- Supporting changes (additive only):
--   devices           + UNIQUE (entity_id, id)  (target of it_phone_lines.device_id)
--   software_vendors  + UNIQUE (entity_id, id), + vendor_kind (existing rows: software)
--   hrga_workflow_tasks.linked_phone_line_id → it_phone_lines (column from 108;
--                     the constraint is added only once that column exists)
--
-- Permissions (mirrors backend/src/config/standardOrganization.js):
--   it.infra.view    People & Culture member/supervisor/head + Super Admin
--   it.infra.manage  People & Culture supervisor/head + Super Admin
--
-- New tables, columns, keys and permissions only; no existing data is changed.
-- Idempotent: CREATE TABLE IF NOT EXISTS, ALTERs guarded by information_schema.
-- ============================================================
SET NAMES utf8mb4;

-- ------------------------------------------------------------ supporting keys
SET @need := (SELECT COUNT(*) = 0 FROM information_schema.statistics
               WHERE table_schema = DATABASE() AND table_name = 'devices' AND index_name = 'uq_devices_entity_id');
SET @sql := IF(@need, 'ALTER TABLE devices ADD UNIQUE KEY uq_devices_entity_id (entity_id, id)', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @need := (SELECT COUNT(*) = 0 FROM information_schema.statistics
               WHERE table_schema = DATABASE() AND table_name = 'software_vendors' AND index_name = 'uq_software_vendors_entity_id');
SET @sql := IF(@need, 'ALTER TABLE software_vendors ADD UNIQUE KEY uq_software_vendors_entity_id (entity_id, id)', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @need := (SELECT COUNT(*) = 0 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'software_vendors' AND column_name = 'vendor_kind');
SET @sql := IF(@need, "ALTER TABLE software_vendors
  ADD COLUMN vendor_kind ENUM('software','isp','cctv','network','hardware','service','other') NOT NULL DEFAULT 'software' AFTER name,
  ADD KEY idx_software_vendors_entity_kind (entity_id, vendor_kind)", 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------ ISP links
CREATE TABLE IF NOT EXISTS it_isp_links (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  vendor_id INT UNSIGNED NULL,
  provider_name VARCHAR(120) NOT NULL,
  customer_number VARCHAR(60) NULL,
  bandwidth_mbps INT UNSIGNED NULL,
  public_ip_dedicated TINYINT(1) NOT NULL DEFAULT 0,
  is_backup TINYINT(1) NOT NULL DEFAULT 0,
  contract_start DATE NULL,
  contract_end DATE NULL,
  monthly_cost DECIMAL(15,2) NULL,
  status ENUM('active', 'terminated') NOT NULL DEFAULT 'active',
  status_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_it_isp_links_entity_id (entity_id, id),
  KEY idx_it_isp_links_entity_location (entity_id, location_id),
  KEY idx_it_isp_links_entity_status (entity_id, status),
  KEY idx_it_isp_links_department (department_id),
  KEY idx_it_isp_links_entity_vendor (entity_id, vendor_id),
  CONSTRAINT chk_it_isp_links_provider CHECK (CHAR_LENGTH(TRIM(provider_name)) > 0),
  CONSTRAINT chk_it_isp_links_cost CHECK (monthly_cost IS NULL OR monthly_cost >= 0),
  CONSTRAINT chk_it_isp_links_contract CHECK (contract_start IS NULL OR contract_end IS NULL OR contract_end >= contract_start),
  CONSTRAINT fk_it_isp_links_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_it_isp_links_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_it_isp_links_location FOREIGN KEY (entity_id, location_id) REFERENCES org_locations (entity_id, id),
  CONSTRAINT fk_it_isp_links_vendor FOREIGN KEY (entity_id, vendor_id) REFERENCES software_vendors (entity_id, id),
  CONSTRAINT fk_it_isp_links_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_it_isp_links_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------ network devices
CREATE TABLE IF NOT EXISTS it_network_devices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  device_type ENUM('router', 'switch', 'access_point', 'nvr', 'dvr', 'firewall', 'modem', 'other') NOT NULL,
  brand_model VARCHAR(150) NOT NULL,
  serial_number VARCHAR(150) NULL,
  -- Compared trimmed and uppercased, like devices.serial_key; NULL when empty.
  serial_key VARCHAR(150) GENERATED ALWAYS AS (NULLIF(UPPER(TRIM(serial_number)), '')) STORED,
  ip_address VARCHAR(45) NULL,
  installed_year SMALLINT UNSIGNED NULL,
  isp_link_id INT UNSIGNED NULL,
  firmware_updated_on DATE NULL,
  status ENUM('active', 'spare', 'damaged', 'retired') NOT NULL DEFAULT 'active',
  status_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_it_network_devices_entity_id (entity_id, id),
  UNIQUE KEY uq_it_network_devices_entity_serial (entity_id, serial_key),
  KEY idx_it_network_devices_entity_location (entity_id, location_id),
  KEY idx_it_network_devices_entity_status (entity_id, status),
  KEY idx_it_network_devices_department (department_id),
  KEY idx_it_network_devices_entity_isp (entity_id, isp_link_id),
  CONSTRAINT chk_it_network_devices_brand CHECK (CHAR_LENGTH(TRIM(brand_model)) > 0),
  CONSTRAINT chk_it_network_devices_year CHECK (installed_year IS NULL OR installed_year BETWEEN 1990 AND 2100),
  CONSTRAINT fk_it_network_devices_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_it_network_devices_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_it_network_devices_location FOREIGN KEY (entity_id, location_id) REFERENCES org_locations (entity_id, id),
  CONSTRAINT fk_it_network_devices_isp FOREIGN KEY (entity_id, isp_link_id) REFERENCES it_isp_links (entity_id, id),
  CONSTRAINT fk_it_network_devices_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_it_network_devices_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------ CCTV systems
CREATE TABLE IF NOT EXISTS it_cctv_systems (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  camera_count SMALLINT UNSIGNED NOT NULL,
  camera_model VARCHAR(150) NULL,
  recorder_type ENUM('nvr', 'dvr', 'cloud', 'none') NOT NULL,
  recorder_device_id INT UNSIGNED NULL,
  serial_number VARCHAR(150) NULL,
  remote_access TINYINT(1) NOT NULL DEFAULT 0,
  -- Risk flag; NULL = not confirmed yet ("Need to reconfirm" in the report).
  same_network_as_pc TINYINT(1) NULL,
  status ENUM('online', 'partial', 'offline', 'retired') NOT NULL DEFAULT 'online',
  cameras_offline SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  status_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_it_cctv_systems_entity_id (entity_id, id),
  KEY idx_it_cctv_systems_entity_location (entity_id, location_id),
  KEY idx_it_cctv_systems_entity_status (entity_id, status),
  KEY idx_it_cctv_systems_department (department_id),
  KEY idx_it_cctv_systems_entity_recorder (entity_id, recorder_device_id),
  CONSTRAINT chk_it_cctv_systems_offline CHECK (cameras_offline <= camera_count),
  CONSTRAINT fk_it_cctv_systems_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_it_cctv_systems_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_it_cctv_systems_location FOREIGN KEY (entity_id, location_id) REFERENCES org_locations (entity_id, id),
  CONSTRAINT fk_it_cctv_systems_recorder FOREIGN KEY (entity_id, recorder_device_id) REFERENCES it_network_devices (entity_id, id),
  CONSTRAINT fk_it_cctv_systems_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_it_cctv_systems_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------ backup jobs and checks
CREATE TABLE IF NOT EXISTS it_backup_jobs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  -- NULL allowed: a cloud backup has no office.
  location_id INT UNSIGNED NULL,
  data_scope VARCHAR(190) NOT NULL,
  method VARCHAR(120) NOT NULL,
  frequency ENUM('daily', 'weekly', 'monthly', 'other') NOT NULL,
  storage_location ENUM('onsite', 'offsite', 'cloud') NOT NULL,
  retention VARCHAR(60) NULL,
  restore_tested_on DATE NULL,
  last_checked_on DATE NULL,
  last_result ENUM('ok', 'failed', 'unknown') NOT NULL DEFAULT 'unknown',
  status ENUM('active', 'retired') NOT NULL DEFAULT 'active',
  status_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_it_backup_jobs_entity_id (entity_id, id),
  KEY idx_it_backup_jobs_entity_location (entity_id, location_id),
  KEY idx_it_backup_jobs_entity_status (entity_id, status),
  KEY idx_it_backup_jobs_department (department_id),
  CONSTRAINT chk_it_backup_jobs_scope CHECK (CHAR_LENGTH(TRIM(data_scope)) > 0 AND CHAR_LENGTH(TRIM(method)) > 0),
  CONSTRAINT fk_it_backup_jobs_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_it_backup_jobs_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_it_backup_jobs_location FOREIGN KEY (entity_id, location_id) REFERENCES org_locations (entity_id, id),
  CONSTRAINT fk_it_backup_jobs_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_it_backup_jobs_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Append-only: a check is never edited; the job's last_* and restore_tested_on
-- are updated in the same transaction as the insert.
CREATE TABLE IF NOT EXISTS it_backup_checks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  backup_job_id INT UNSIGNED NOT NULL,
  checked_on DATE NOT NULL,
  result ENUM('ok', 'failed') NOT NULL,
  restore_tested TINYINT(1) NOT NULL DEFAULT 0,
  note VARCHAR(255) NULL,
  checked_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_it_backup_checks_entity_id (entity_id, id),
  KEY idx_it_backup_checks_job (entity_id, backup_job_id, checked_on),
  KEY idx_it_backup_checks_entity_checked (entity_id, checked_on),
  CONSTRAINT fk_it_backup_checks_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_it_backup_checks_job FOREIGN KEY (entity_id, backup_job_id) REFERENCES it_backup_jobs (entity_id, id),
  CONSTRAINT fk_it_backup_checks_checked_by FOREIGN KEY (checked_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------ Google Workspace reviews
-- Append-only snapshots: a correction is a new review. No location.
CREATE TABLE IF NOT EXISTS it_gws_reviews (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  reviewed_on DATE NOT NULL,
  active_users SMALLINT UNSIGNED NOT NULL,
  super_admins SMALLINT UNSIGNED NOT NULL,
  mfa_enforced TINYINT(1) NOT NULL,
  external_sharing_restricted TINYINT(1) NOT NULL,
  shared_accounts_used TINYINT(1) NOT NULL,
  ex_users_active SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  reviewed_by INT UNSIGNED NOT NULL,
  notes VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_it_gws_reviews_entity_id (entity_id, id),
  KEY idx_it_gws_reviews_entity_reviewed (entity_id, reviewed_on),
  KEY idx_it_gws_reviews_department (department_id),
  CONSTRAINT fk_it_gws_reviews_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_it_gws_reviews_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_it_gws_reviews_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id),
  CONSTRAINT fk_it_gws_reviews_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_it_gws_reviews_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------ company phone lines
-- Company numbers only (never a personal number). number is normalised to
-- +62… by the app; a number or extension is unique among lines not terminated.
CREATE TABLE IF NOT EXISTS it_phone_lines (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  kind ENUM('mobile', 'ip_phone') NOT NULL,
  number VARCHAR(30) NULL,
  extension VARCHAR(10) NULL,
  status ENUM('active', 'spare', 'terminated') NOT NULL DEFAULT 'spare',
  active_number_key VARCHAR(30) GENERATED ALWAYS AS (IF(status <> 'terminated', number, NULL)) STORED,
  active_extension_key VARCHAR(10) GENERATED ALWAYS AS (IF(status <> 'terminated', extension, NULL)) STORED,
  person_id INT UNSIGNED NULL,
  holder_label VARCHAR(120) NULL,
  device_id INT UNSIGNED NULL,
  provider VARCHAR(80) NULL,
  plan_name VARCHAR(120) NULL,
  started_on DATE NULL,
  monthly_cost DECIMAL(15,2) NULL,
  status_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_it_phone_lines_entity_id (entity_id, id),
  UNIQUE KEY uq_it_phone_lines_entity_number (entity_id, active_number_key),
  UNIQUE KEY uq_it_phone_lines_entity_extension (entity_id, active_extension_key),
  KEY idx_it_phone_lines_entity_person (entity_id, person_id),
  KEY idx_it_phone_lines_entity_status (entity_id, status),
  KEY idx_it_phone_lines_entity_location (entity_id, location_id),
  KEY idx_it_phone_lines_entity_device (entity_id, device_id),
  KEY idx_it_phone_lines_department (department_id),
  CONSTRAINT chk_it_phone_lines_identity CHECK (number IS NOT NULL OR extension IS NOT NULL),
  CONSTRAINT chk_it_phone_lines_one_holder CHECK (person_id IS NULL OR holder_label IS NULL),
  CONSTRAINT chk_it_phone_lines_active_holder CHECK (status <> 'active' OR person_id IS NOT NULL OR holder_label IS NOT NULL),
  CONSTRAINT chk_it_phone_lines_label CHECK (holder_label IS NULL OR CHAR_LENGTH(TRIM(holder_label)) > 0),
  CONSTRAINT chk_it_phone_lines_number CHECK (number IS NULL OR number REGEXP '^\\+[0-9]{8,15}$'),
  CONSTRAINT chk_it_phone_lines_cost CHECK (monthly_cost IS NULL OR monthly_cost >= 0),
  CONSTRAINT fk_it_phone_lines_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_it_phone_lines_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_it_phone_lines_location FOREIGN KEY (entity_id, location_id) REFERENCES org_locations (entity_id, id),
  CONSTRAINT fk_it_phone_lines_person FOREIGN KEY (entity_id, person_id) REFERENCES people_directory (entity_id, id),
  CONSTRAINT fk_it_phone_lines_device FOREIGN KEY (entity_id, device_id) REFERENCES devices (entity_id, id),
  CONSTRAINT fk_it_phone_lines_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_it_phone_lines_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------ onboarding/offboarding link (needs 108)
-- hrga_workflow_tasks.linked_phone_line_id comes from migration 108; the
-- constraint is added once that column exists and the constraint does not.
SET @need := (SELECT COUNT(*) = 1 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'hrga_workflow_tasks' AND column_name = 'linked_phone_line_id')
         AND (SELECT COUNT(*) = 0 FROM information_schema.table_constraints
               WHERE constraint_schema = DATABASE() AND table_name = 'hrga_workflow_tasks' AND constraint_name = 'fk_hrga_task_phone');
SET @sql := IF(@need, 'ALTER TABLE hrga_workflow_tasks ADD CONSTRAINT fk_hrga_task_phone FOREIGN KEY (linked_phone_line_id) REFERENCES it_phone_lines(id)', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------ permissions
INSERT IGNORE INTO permissions (code, description) VALUES
('it.infra.view', 'Lihat register infrastruktur IT (jaringan, ISP, CCTV, backup, Google Workspace, nomor perusahaan), termasuk alamat IP dan biaya'),
('it.infra.manage', 'Kelola register infrastruktur IT dan impor dari laporan IT (People & Culture)');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'it.infra.view'
 WHERE r.deleted_at IS NULL AND r.role_key IN ('people_culture.member', 'people_culture.supervisor', 'people_culture.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'it.infra.manage'
 WHERE r.deleted_at IS NULL AND r.role_key IN ('people_culture.supervisor', 'people_culture.head');

-- Super Admin keeps every permission.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('it.infra.view', 'it.infra.manage')
 WHERE (r.role_key = 'system.super_admin' OR LOWER(r.name) IN ('super admin', 'superadmin')) AND r.deleted_at IS NULL;
