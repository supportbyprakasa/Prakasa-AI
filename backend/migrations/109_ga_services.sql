-- ============================================================
-- Migration 109 — People & Culture wave 2, row 2.2: Layanan GA
-- (docs/rancangan-people-culture-g2.md, Bagian 3)
--
-- ga_resources            rooms and vehicles per PFN location (managed by
--                         People & Culture Supervisor/Head). Never deleted:
--                         deactivated.
-- ga_requests             Permintaan: ATK, perbaikan fasilitas, lainnya — with a
--                         time target (sla_days / due_at) stored when the clock
--                         starts, so a later rule change never rewrites history.
-- ga_request_items        ATK lines (max 20 per request, enforced by the service).
-- ga_request_attachments  photos/PDF of a repair, Shared Drive only (rule 1.0).
-- ga_bookings             Peminjaman ruang/kendaraan. Clash rule enforced by the
--                         service under a row lock on the resource.
--
-- Every relation to another record of the entity is a composite foreign key
-- (entity_id, …), so a row can never point at another entity's location,
-- resource or person. Times are DATETIME in UTC (the DB session is +00:00).
--
-- Permissions: ga.request.create (every standard role + Super Admin),
-- ga.request.process (People & Culture member+), ga.resource.manage
-- (People & Culture supervisor+). Approval matrix rules for the vehicle
-- booking and the "Lainnya" request (the approver of step 1 is set by the
-- resolver at submit, like 108).
--
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS, INSERT IGNORE, and the
-- matrix rules only when no active rule exists for the request type. No
-- existing row is changed or deleted.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS ga_resources (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  kind ENUM('room', 'vehicle') NOT NULL,
  name VARCHAR(120) NOT NULL,
  capacity SMALLINT UNSIGNED NULL,
  plate_number VARCHAR(20) NULL,
  -- "B 1234 XYZ" and "b1234xyz" are the same vehicle.
  plate_key VARCHAR(20) GENERATED ALWAYS AS (UPPER(REPLACE(plate_number, ' ', ''))) STORED,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  notes VARCHAR(255) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ga_resources_entity_id (entity_id, id),
  -- utf8mb4_0900_ai_ci: "Ruang Rapat" and "ruang rapat" are the same room.
  UNIQUE KEY uq_ga_resources_name (entity_id, kind, name),
  UNIQUE KEY uq_ga_resources_plate (entity_id, plate_key),
  KEY idx_ga_resources_kind (entity_id, kind, is_active),
  KEY idx_ga_resources_location (entity_id, location_id),
  CONSTRAINT chk_ga_resources_name CHECK (CHAR_LENGTH(TRIM(name)) > 0 AND CAST(name AS BINARY) = CAST(TRIM(name) AS BINARY)),
  CONSTRAINT chk_ga_resources_plate CHECK (kind = 'vehicle' OR plate_number IS NULL),
  CONSTRAINT chk_ga_resources_capacity CHECK (kind = 'room' OR capacity IS NULL),
  CONSTRAINT chk_ga_resources_plate_text CHECK (plate_number IS NULL OR CHAR_LENGTH(TRIM(plate_number)) > 0),
  CONSTRAINT fk_ga_resources_entity FOREIGN KEY (entity_id) REFERENCES entities (id),
  CONSTRAINT fk_ga_resources_location FOREIGN KEY (entity_id, location_id) REFERENCES org_locations (entity_id, id),
  CONSTRAINT fk_ga_resources_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_ga_resources_updated_by FOREIGN KEY (updated_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ga_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  -- The requester's division at the time of the request (management scope).
  department_id INT UNSIGNED NULL,
  request_number VARCHAR(30) NOT NULL,
  request_type ENUM('atk', 'facility_repair', 'other') NOT NULL,
  title VARCHAR(190) NOT NULL,
  description VARCHAR(2000) NULL,
  location_id INT UNSIGNED NOT NULL,
  area VARCHAR(120) NULL,
  urgency ENUM('normal', 'urgent') NOT NULL DEFAULT 'normal',
  requester_user_id INT UNSIGNED NOT NULL,
  assigned_to INT UNSIGNED NULL,
  status ENUM('pending_approval', 'open', 'in_progress', 'done', 'rejected', 'cancelled') NOT NULL,
  approval_request_id INT UNSIGNED NULL,
  approver_basis ENUM('manager', 'division_head', 'management_office') NULL,
  -- The time target, stored when the clock starts (create, or approval of "Lainnya").
  sla_days TINYINT UNSIGNED NULL,
  clock_started_at DATETIME NULL,
  due_at DATETIME NULL,
  started_at DATETIME NULL,
  done_at DATETIME NULL,
  done_by INT UNSIGNED NULL,
  resolution_note VARCHAR(500) NULL,
  rejected_reason VARCHAR(255) NULL,
  rejected_by INT UNSIGNED NULL,
  rejected_at DATETIME NULL,
  cancel_reason VARCHAR(255) NULL,
  cancelled_by INT UNSIGNED NULL,
  cancelled_at DATETIME NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ga_requests_entity_id (entity_id, id),
  UNIQUE KEY uq_ga_requests_number (entity_id, request_number),
  KEY idx_ga_requests_status_due (entity_id, status, due_at),
  KEY idx_ga_requests_requester (requester_user_id, status),
  KEY idx_ga_requests_assignee (assigned_to, status),
  KEY idx_ga_requests_department (department_id),
  KEY idx_ga_requests_approval (approval_request_id),
  CONSTRAINT chk_ga_requests_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
  CONSTRAINT chk_ga_requests_done CHECK (status <> 'done' OR (done_at IS NOT NULL AND resolution_note IS NOT NULL)),
  CONSTRAINT chk_ga_requests_rejected CHECK (status <> 'rejected' OR rejected_reason IS NOT NULL),
  CONSTRAINT chk_ga_requests_cancelled CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL),
  CONSTRAINT chk_ga_requests_clock CHECK (status NOT IN ('open', 'in_progress', 'done') OR (due_at IS NOT NULL AND sla_days IS NOT NULL AND clock_started_at IS NOT NULL)),
  CONSTRAINT fk_ga_requests_entity FOREIGN KEY (entity_id) REFERENCES entities (id),
  CONSTRAINT fk_ga_requests_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_ga_requests_location FOREIGN KEY (entity_id, location_id) REFERENCES org_locations (entity_id, id),
  CONSTRAINT fk_ga_requests_requester FOREIGN KEY (requester_user_id) REFERENCES users (id),
  CONSTRAINT fk_ga_requests_assignee FOREIGN KEY (assigned_to) REFERENCES users (id),
  CONSTRAINT fk_ga_requests_approval FOREIGN KEY (approval_request_id) REFERENCES approval_requests (id),
  CONSTRAINT fk_ga_requests_done_by FOREIGN KEY (done_by) REFERENCES users (id),
  CONSTRAINT fk_ga_requests_rejected_by FOREIGN KEY (rejected_by) REFERENCES users (id),
  CONSTRAINT fk_ga_requests_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users (id),
  CONSTRAINT fk_ga_requests_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_ga_requests_updated_by FOREIGN KEY (updated_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ga_request_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id INT UNSIGNED NOT NULL,
  item_name VARCHAR(120) NOT NULL,
  qty DECIMAL(10,2) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ga_request_items_request (request_id, sort_order),
  CONSTRAINT chk_ga_request_items_qty CHECK (qty > 0),
  CONSTRAINT chk_ga_request_items_name CHECK (CHAR_LENGTH(TRIM(item_name)) > 0),
  CONSTRAINT chk_ga_request_items_unit CHECK (CHAR_LENGTH(TRIM(unit)) > 0),
  CONSTRAINT fk_ga_request_items_request FOREIGN KEY (request_id) REFERENCES ga_requests (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ga_request_attachments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id INT UNSIGNED NOT NULL,
  drive_file_id VARCHAR(190) NOT NULL,
  web_view_link VARCHAR(500) NULL,
  name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size INT UNSIGNED NOT NULL,
  uploaded_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ga_request_attachments_request (request_id),
  CONSTRAINT chk_ga_request_attachments_size CHECK (size <= 10485760),
  CONSTRAINT fk_ga_request_attachments_request FOREIGN KEY (request_id) REFERENCES ga_requests (id),
  CONSTRAINT fk_ga_request_attachments_uploader FOREIGN KEY (uploaded_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ga_bookings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  -- The borrower's division (management scope; the masked agenda shows it).
  department_id INT UNSIGNED NULL,
  booking_number VARCHAR(30) NOT NULL,
  resource_id INT UNSIGNED NOT NULL,
  resource_kind ENUM('room', 'vehicle') NOT NULL,
  requester_user_id INT UNSIGNED NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  purpose VARCHAR(255) NOT NULL,
  destination VARCHAR(190) NULL,
  needs_driver TINYINT(1) NOT NULL DEFAULT 0,
  driver_person_id INT UNSIGNED NULL,
  status ENUM('pending_approval', 'confirmed', 'in_use', 'returned', 'rejected', 'cancelled', 'expired') NOT NULL,
  approval_request_id INT UNSIGNED NULL,
  approver_basis ENUM('manager', 'division_head', 'management_office') NULL,
  -- Approver's rejection note, or why the booking expired.
  decision_note VARCHAR(500) NULL,
  checked_out_at DATETIME NULL,
  checked_out_by INT UNSIGNED NULL,
  returned_at DATETIME NULL,
  returned_by INT UNSIGNED NULL,
  return_note VARCHAR(255) NULL,
  cancel_reason VARCHAR(255) NULL,
  cancelled_by INT UNSIGNED NULL,
  cancelled_at DATETIME NULL,
  late_notified_on DATE NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ga_bookings_entity_id (entity_id, id),
  UNIQUE KEY uq_ga_bookings_number (entity_id, booking_number),
  KEY idx_ga_bookings_resource_time (resource_id, starts_at, ends_at),
  KEY idx_ga_bookings_status_start (entity_id, status, starts_at),
  KEY idx_ga_bookings_requester (requester_user_id, status),
  KEY idx_ga_bookings_driver (entity_id, driver_person_id),
  KEY idx_ga_bookings_department (department_id),
  KEY idx_ga_bookings_approval (approval_request_id),
  CONSTRAINT chk_ga_bookings_time CHECK (ends_at > starts_at),
  CONSTRAINT chk_ga_bookings_purpose CHECK (CHAR_LENGTH(TRIM(purpose)) > 0),
  CONSTRAINT chk_ga_bookings_driver CHECK (resource_kind = 'vehicle' OR (needs_driver = 0 AND driver_person_id IS NULL AND destination IS NULL)),
  CONSTRAINT chk_ga_bookings_checkout CHECK (status NOT IN ('in_use', 'returned') OR checked_out_at IS NOT NULL),
  CONSTRAINT chk_ga_bookings_returned CHECK (status <> 'returned' OR returned_at IS NOT NULL),
  CONSTRAINT chk_ga_bookings_cancelled CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL),
  CONSTRAINT fk_ga_bookings_entity FOREIGN KEY (entity_id) REFERENCES entities (id),
  CONSTRAINT fk_ga_bookings_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_ga_bookings_resource FOREIGN KEY (entity_id, resource_id) REFERENCES ga_resources (entity_id, id),
  CONSTRAINT fk_ga_bookings_driver FOREIGN KEY (entity_id, driver_person_id) REFERENCES people_directory (entity_id, id),
  CONSTRAINT fk_ga_bookings_requester FOREIGN KEY (requester_user_id) REFERENCES users (id),
  CONSTRAINT fk_ga_bookings_approval FOREIGN KEY (approval_request_id) REFERENCES approval_requests (id),
  CONSTRAINT fk_ga_bookings_checked_out_by FOREIGN KEY (checked_out_by) REFERENCES users (id),
  CONSTRAINT fk_ga_bookings_returned_by FOREIGN KEY (returned_by) REFERENCES users (id),
  CONSTRAINT fk_ga_bookings_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES users (id),
  CONSTRAINT fk_ga_bookings_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_ga_bookings_updated_by FOREIGN KEY (updated_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------- permissions

INSERT IGNORE INTO permissions (code, description) VALUES
('ga.request.create', 'Ajukan permintaan GA dan pinjam ruang/kendaraan (milik sendiri)'),
('ga.request.process', 'Proses semua permintaan dan peminjaman GA (People & Culture)'),
('ga.resource.manage', 'Kelola ruang dan kendaraan per lokasi (People & Culture Supervisor/Head)');

-- Every standard role (all nine divisions, every level) requests GA services.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN departments d ON d.id = r.department_id
JOIN permissions p ON p.code = 'ga.request.create'
WHERE r.is_system_template = 1 AND r.deleted_at IS NULL
  AND r.role_level IN ('member', 'supervisor', 'head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN departments d ON d.id = r.department_id
JOIN permissions p ON p.code = 'ga.request.process'
WHERE r.is_system_template = 1 AND r.deleted_at IS NULL AND d.code = 'people_culture'
  AND r.role_level IN ('member', 'supervisor', 'head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN departments d ON d.id = r.department_id
JOIN permissions p ON p.code = 'ga.resource.manage'
WHERE r.is_system_template = 1 AND r.deleted_at IS NULL AND d.code = 'people_culture'
  AND r.role_level IN ('supervisor', 'head');

-- Super Admin keeps every permission.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('ga.request.create', 'ga.request.process', 'ga.resource.manage')
 WHERE (r.role_key = 'system.super_admin' OR LOWER(r.name) IN ('super admin', 'superadmin')) AND r.deleted_at IS NULL;

-- ---------------------------------------------------------------- approval matrix

-- Same shape as 108: one required step; its approver is set at submit by the
-- resolver (manager → division Head → Management Office Head); the rule stays
-- attached so the 24 h reminder / 48 h escalation to the Management Office Head
-- keeps working. ATK and facility repairs have no approval (decision 17).
INSERT INTO approval_matrix
  (matrix_key, matrix_name, entity_id, department_id, request_type, level, order_index,
   approver_role_id, escalation_role_id, is_required, currency, flow_type, is_optional,
   priority, reminder_after_hours, escalate_after_hours, is_active)
SELECT seed.matrix_key, seed.matrix_name, e.id, NULL, seed.request_type, 1, 1,
       head.id, head.id, 1, 'IDR', 'sequential', 0,
       50, 24, 48, 1
FROM (
  SELECT 'ga_vehicle_booking:default' AS matrix_key, 'Layanan GA — Peminjaman kendaraan' AS matrix_name,
         'ga_vehicle_booking' AS request_type
  UNION ALL SELECT 'ga_request_other:default', 'Layanan GA — Permintaan lainnya', 'ga_request_other'
) seed
JOIN entities e ON e.id = 1 AND e.deleted_at IS NULL
JOIN roles head ON head.entity_id = e.id AND head.role_key = 'management_office.head' AND head.deleted_at IS NULL
LEFT JOIN approval_matrix existing
  ON existing.entity_id = e.id
 AND existing.request_type = seed.request_type
 AND existing.is_active = 1
 AND existing.deleted_at IS NULL
WHERE existing.id IS NULL;
