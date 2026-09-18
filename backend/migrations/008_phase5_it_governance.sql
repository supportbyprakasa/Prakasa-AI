SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- DEVICE MANAGEMENT
-- ============================================================

CREATE TABLE IF NOT EXISTS devices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  asset_code VARCHAR(80) NOT NULL UNIQUE,     -- kode inventaris internal
  device_type ENUM(
    'laptop','pc','macbook','smartphone','tablet','printer',
    'router','switch','access_point','cctv_nvr','monitor',
    'external_hdd','peripheral','other'
  ) NOT NULL,
  brand VARCHAR(100) NULL,
  model VARCHAR(150) NULL,
  serial_number VARCHAR(150) NULL,
  imei VARCHAR(40) NULL,                      -- untuk smartphone/tablet
  mac_address VARCHAR(40) NULL,               -- untuk network device
  purchase_date DATE NULL,
  purchase_price DECIMAL(15,2) NULL,
  currency VARCHAR(8) DEFAULT 'IDR',
  supplier VARCHAR(190) NULL,
  invoice_document_id INT UNSIGNED NULL,      -- link ke documents Fase 2
  warranty_start DATE NULL,
  warranty_end DATE NULL,
  warranty_type ENUM('none','manufacturer','extended','accidental') DEFAULT 'manufacturer',
  status ENUM('available','assigned','maintenance','repair','retired','lost','disposed') DEFAULT 'available',
  condition_state ENUM('excellent','good','fair','poor','broken') DEFAULT 'good',
  current_assignee_id INT UNSIGNED NULL,      -- user yang sedang pegang
  current_location VARCHAR(190) NULL,
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (invoice_document_id) REFERENCES documents(id),
  FOREIGN KEY (current_assignee_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_devices_entity_type (entity_id, device_type),
  INDEX idx_devices_status (status),
  INDEX idx_devices_warranty (warranty_end),
  INDEX idx_devices_assignee (current_assignee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_assignments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  device_id INT UNSIGNED NOT NULL,
  assigned_to INT UNSIGNED NOT NULL,
  assigned_by INT UNSIGNED NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expected_return_date DATE NULL,
  actual_return_date DATE NULL,
  location VARCHAR(190) NULL,
  purpose VARCHAR(500) NULL,
  handover_document_id INT UNSIGNED NULL,     -- link ke device_handover_documents
  return_document_id INT UNSIGNED NULL,       -- link ke device_return_documents
  status ENUM('active','returned','lost','transferred') DEFAULT 'active',
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(id),
  FOREIGN KEY (assigned_by) REFERENCES users(id),
  INDEX idx_assign_device_status (device_id, status),
  INDEX idx_assign_user_status (assigned_to, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_handover_documents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id INT UNSIGNED NOT NULL,
  document_id INT UNSIGNED NULL,              -- link ke documents (signed PDF)
  drive_file_id VARCHAR(190) NULL,
  web_view_link VARCHAR(500) NULL,
  signed_by_user INT UNSIGNED NULL,
  signed_by_it INT UNSIGNED NULL,
  signed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assignment_id) REFERENCES device_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (signed_by_user) REFERENCES users(id),
  FOREIGN KEY (signed_by_it) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_return_documents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id INT UNSIGNED NOT NULL,
  document_id INT UNSIGNED NULL,
  drive_file_id VARCHAR(190) NULL,
  web_view_link VARCHAR(500) NULL,
  condition_on_return ENUM('excellent','good','fair','poor','broken') NULL,
  accessories_returned JSON NULL,             -- [{name, returned}]
  signed_by_user INT UNSIGNED NULL,
  signed_by_it INT UNSIGNED NULL,
  signed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assignment_id) REFERENCES device_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (signed_by_user) REFERENCES users(id),
  FOREIGN KEY (signed_by_it) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_maintenance_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  device_id INT UNSIGNED NOT NULL,
  maintenance_date DATE NOT NULL,
  maintenance_type VARCHAR(80) NOT NULL,      -- routine/cleaning/update/checkup
  description TEXT NULL,
  performed_by VARCHAR(190) NULL,             -- internal atau vendor
  cost DECIMAL(15,2) NULL,
  next_maintenance_date DATE NULL,
  document_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_maint_device (device_id, maintenance_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_repair_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  device_id INT UNSIGNED NOT NULL,
  reported_date DATE NOT NULL,
  reported_by INT UNSIGNED NULL,
  issue_description TEXT NOT NULL,
  severity ENUM('low','medium','high','critical') DEFAULT 'medium',
  vendor_name VARCHAR(190) NULL,
  sent_date DATE NULL,
  returned_date DATE NULL,
  cost DECIMAL(15,2) NULL,
  status ENUM('reported','in_repair','completed','unrepairable','cancelled') DEFAULT 'reported',
  resolution TEXT NULL,
  document_id INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (reported_by) REFERENCES users(id),
  FOREIGN KEY (document_id) REFERENCES documents(id),
  INDEX idx_repair_status (status, reported_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_warranty_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_id INT UNSIGNED NOT NULL,
  warranty_type ENUM('manufacturer','extended','accidental') NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  provider VARCHAR(190) NULL,
  claim_number VARCHAR(80) NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  INDEX idx_warranty_device (device_id, end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SOFTWARE SUBSCRIPTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS software_vendors (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  name VARCHAR(190) NOT NULL,
  contact_person VARCHAR(150) NULL,
  email VARCHAR(190) NULL,
  phone VARCHAR(40) NULL,
  portal_url VARCHAR(500) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  INDEX idx_vendor_entity (entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS software_subscriptions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  vendor_id INT UNSIGNED NULL,
  product_name VARCHAR(190) NOT NULL,
  plan_name VARCHAR(150) NULL,
  license_type ENUM('per_user','per_device','per_company','usage_based') DEFAULT 'per_user',
  billing_cycle ENUM('monthly','quarterly','yearly','multi_year','one_time') DEFAULT 'monthly',
  total_seats INT UNSIGNED DEFAULT 1,
  unit_price DECIMAL(15,2) NULL,
  currency VARCHAR(8) DEFAULT 'IDR',
  start_date DATE NULL,
  renewal_date DATE NOT NULL,
  auto_renew TINYINT(1) DEFAULT 0,
  status ENUM('active','expiring','expired','cancelled','paused') DEFAULT 'active',
  pic_user_id INT UNSIGNED NULL,               -- internal PIC
  jurnal_reference_id VARCHAR(190) NULL,       -- referensi/link ke Jurnal.id
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (vendor_id) REFERENCES software_vendors(id),
  FOREIGN KEY (pic_user_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_sub_entity (entity_id),
  INDEX idx_sub_renewal (renewal_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscription_licenses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subscription_id INT UNSIGNED NOT NULL,
  license_key VARCHAR(255) NULL,
  seat_label VARCHAR(150) NULL,                -- mis. "seat #1", username
  assigned_to INT UNSIGNED NULL,
  assigned_at TIMESTAMP NULL,
  last_used_at TIMESTAMP NULL,
  status ENUM('available','assigned','idle','revoked') DEFAULT 'available',
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (subscription_id) REFERENCES software_subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(id),
  INDEX idx_license_sub_status (subscription_id, status),
  INDEX idx_license_assigned (assigned_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subscription_id INT UNSIGNED NOT NULL,
  invoice_number VARCHAR(120) NOT NULL,
  invoice_date DATE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(8) DEFAULT 'IDR',
  tax_amount DECIMAL(15,2) DEFAULT 0,
  total_amount DECIMAL(15,2) NOT NULL,
  status ENUM('pending_upload','uploaded','verified','paid','void') DEFAULT 'pending_upload',
  document_id INT UNSIGNED NULL,               -- link ke documents (PDF invoice)
  jurnal_reference_id VARCHAR(190) NULL,       -- referensi ke Jurnal.id
  uploaded_by INT UNSIGNED NULL,
  uploaded_at TIMESTAMP NULL,
  verified_by INT UNSIGNED NULL,
  verified_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_invoice (subscription_id, invoice_number),
  FOREIGN KEY (subscription_id) REFERENCES software_subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (uploaded_by) REFERENCES users(id),
  FOREIGN KEY (verified_by) REFERENCES users(id),
  INDEX idx_invoice_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscription_renewals (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subscription_id INT UNSIGNED NOT NULL,
  requested_by INT UNSIGNED NULL,
  request_date DATE NOT NULL,
  current_renewal_date DATE NOT NULL,
  proposed_renewal_date DATE NOT NULL,
  proposed_seats INT UNSIGNED NULL,
  proposed_amount DECIMAL(15,2) NULL,
  currency VARCHAR(8) DEFAULT 'IDR',
  approval_request_id INT UNSIGNED NULL,       -- link ke approval_requests Fase 3
  status ENUM('pending','approved','rejected','cancelled','completed') DEFAULT 'pending',
  decided_by INT UNSIGNED NULL,
  decided_at TIMESTAMP NULL,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (subscription_id) REFERENCES software_subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id),
  FOREIGN KEY (decided_by) REFERENCES users(id),
  INDEX idx_renewal_status (status, request_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscription_payments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subscription_id INT UNSIGNED NOT NULL,
  invoice_id INT UNSIGNED NULL,
  paid_at TIMESTAMP NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(8) DEFAULT 'IDR',
  payment_method VARCHAR(80) NULL,
  reference_no VARCHAR(120) NULL,
  status ENUM('pending','processed','failed') DEFAULT 'pending',
  jurnal_reference_id VARCHAR(190) NULL,
  notes TEXT NULL,
  processed_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (subscription_id) REFERENCES software_subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (invoice_id) REFERENCES subscription_invoices(id),
  FOREIGN KEY (processed_by) REFERENCES users(id),
  INDEX idx_payment_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS software_assignments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subscription_id INT UNSIGNED NOT NULL,
  license_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NOT NULL,
  assigned_by INT UNSIGNED NULL,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP NULL,
  status ENUM('active','revoked') DEFAULT 'active',
  notes VARCHAR(500) NULL,
  FOREIGN KEY (subscription_id) REFERENCES software_subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (license_id) REFERENCES subscription_licenses(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (assigned_by) REFERENCES users(id),
  INDEX idx_sw_assign_user (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_software_relations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_id INT UNSIGNED NOT NULL,
  subscription_id INT UNSIGNED NOT NULL,
  installed_at DATE NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_dev_sub (device_id, subscription_id),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES software_subscriptions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
