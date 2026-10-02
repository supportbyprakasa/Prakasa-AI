-- ============================================================
-- Migration 107 — People & Culture wave 1, row 1.2: IT assets of the entity
--
-- devices
--   status             + 'damaged' (Rusak: broken, not at a vendor) — distinct
--                      from 'repair' (Perbaikan: at a vendor).
--   status_changed_at  set by the app on every status change (never ON UPDATE),
--                      so "Rusak lebih dari 14 hari" and "tertahan di servis"
--                      count from the change, not from any later edit.
--   holder_person_id / holder_label
--                      caches of the active assignment's holder, next to the
--                      existing current_assignee_id (app users); at most one
--                      is set. The holder itself is always a device_assignments row.
--   ram_gb, storage_gb, os_version, purchase_year, location_id (org_locations
--                      of the same entity — composite foreign key).
--   asset_code         optional and NOT unique any more: the real PFN report reuses
--                      3 asset numbers for 2 different laptops each. A normal
--                      (entity_id, asset_code) index replaces the global unique one.
--   serial_key         the serial number trimmed and uppercased, for a live
--                      (not soft-deleted) device: UNIQUE (entity_id, serial_key),
--                      so a serial is unique per entity when present.
--   device_type        + telephone, label_printer, fingerprint.
-- device_assignments
--   assigned_to NULL-able; + person_id (people_directory of the same entity)
--   and holder_label (a team, e.g. "Ops Team"); exactly one of the three.
--
-- Checked before writing: devices and device_assignments hold 0 rows, the old
-- unique index is named `asset_code`, and every ENUM change only appends values.
-- Schema only; no data is changed. Idempotent (guarded by status_changed_at /
-- person_id already existing).
-- ============================================================
SET NAMES utf8mb4;

SET @need_devices := (SELECT COUNT(*) = 0 FROM information_schema.columns
                       WHERE table_schema = DATABASE() AND table_name = 'devices' AND column_name = 'status_changed_at');

SET @sql := IF(@need_devices, "ALTER TABLE devices
  MODIFY device_type ENUM('laptop','pc','macbook','smartphone','tablet','printer','router','switch','access_point','cctv_nvr','monitor','external_hdd','peripheral','other','telephone','label_printer','fingerprint') NOT NULL,
  MODIFY status ENUM('available','assigned','maintenance','repair','damaged','retired','lost','disposed') DEFAULT 'available',
  MODIFY asset_code VARCHAR(80) NULL,
  ADD COLUMN status_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER status,
  ADD COLUMN holder_person_id INT UNSIGNED NULL AFTER current_assignee_id,
  ADD COLUMN holder_label VARCHAR(120) NULL AFTER holder_person_id,
  ADD COLUMN location_id INT UNSIGNED NULL AFTER current_location,
  ADD COLUMN purchase_year SMALLINT UNSIGNED NULL AFTER purchase_date,
  ADD COLUMN ram_gb SMALLINT UNSIGNED NULL AFTER serial_number,
  ADD COLUMN storage_gb INT UNSIGNED NULL AFTER ram_gb,
  ADD COLUMN os_version VARCHAR(80) NULL AFTER storage_gb,
  ADD COLUMN serial_key VARCHAR(150) GENERATED ALWAYS AS (IF(deleted_at IS NULL, NULLIF(UPPER(TRIM(serial_number)), ''), NULL)) STORED,
  DROP INDEX asset_code,
  ADD KEY idx_devices_entity_asset (entity_id, asset_code),
  ADD UNIQUE KEY uq_devices_entity_serial (entity_id, serial_key),
  ADD KEY idx_devices_entity_status (entity_id, status),
  ADD KEY idx_devices_entity_location (entity_id, location_id),
  ADD KEY idx_devices_entity_holder_person (entity_id, holder_person_id),
  ADD CONSTRAINT fk_devices_location FOREIGN KEY (entity_id, location_id) REFERENCES org_locations (entity_id, id),
  ADD CONSTRAINT fk_devices_holder_person FOREIGN KEY (entity_id, holder_person_id) REFERENCES people_directory (entity_id, id),
  ADD CONSTRAINT chk_devices_one_holder CHECK ((current_assignee_id IS NOT NULL) + (holder_person_id IS NOT NULL) + (holder_label IS NOT NULL) <= 1),
  ADD CONSTRAINT chk_devices_holder_label CHECK (holder_label IS NULL OR CHAR_LENGTH(TRIM(holder_label)) > 0),
  ADD CONSTRAINT chk_devices_purchase_year CHECK (purchase_year IS NULL OR purchase_year BETWEEN 1990 AND 2100),
  ADD CONSTRAINT chk_devices_ram CHECK (ram_gb IS NULL OR ram_gb BETWEEN 1 AND 4096),
  ADD CONSTRAINT chk_devices_storage CHECK (storage_gb IS NULL OR storage_gb BETWEEN 1 AND 1048576)", 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- A device that existed before this migration changed status at its last edit at the latest.
SET @sql := IF(@need_devices, 'UPDATE devices SET status_changed_at = COALESCE(updated_at, created_at, status_changed_at), updated_at = updated_at', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @need_assignments := (SELECT COUNT(*) = 0 FROM information_schema.columns
                           WHERE table_schema = DATABASE() AND table_name = 'device_assignments' AND column_name = 'person_id');

SET @sql := IF(@need_assignments, "ALTER TABLE device_assignments
  MODIFY assigned_to INT UNSIGNED NULL,
  ADD COLUMN person_id INT UNSIGNED NULL AFTER assigned_to,
  ADD COLUMN holder_label VARCHAR(120) NULL AFTER person_id,
  ADD KEY idx_assign_entity_person (entity_id, person_id),
  ADD CONSTRAINT fk_device_assignments_person FOREIGN KEY (entity_id, person_id) REFERENCES people_directory (entity_id, id),
  ADD CONSTRAINT chk_device_assignments_one_holder CHECK ((assigned_to IS NOT NULL) + (person_id IS NOT NULL) + (holder_label IS NOT NULL) = 1),
  ADD CONSTRAINT chk_device_assignments_label CHECK (holder_label IS NULL OR CHAR_LENGTH(TRIM(holder_label)) > 0)", 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
