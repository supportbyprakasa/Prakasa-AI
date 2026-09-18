SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- SALES
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_customers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  name VARCHAR(190) NOT NULL,
  contact_person VARCHAR(150) NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(190) NULL,
  address VARCHAR(500) NULL,
  city VARCHAR(100) NULL,
  segment VARCHAR(80) NULL,          -- retail/horeca/distributor/dll
  notes TEXT NULL,
  owner_user_id INT UNSIGNED NULL,   -- sales PIC
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (owner_user_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_sales_cust_entity (entity_id, department_id),
  INDEX idx_sales_cust_owner (owner_user_id),
  INDEX idx_sales_cust_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_inquiries (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  customer_id INT UNSIGNED NULL,
  product_interest VARCHAR(255) NULL,
  quantity VARCHAR(80) NULL,
  channel ENUM('whatsapp','email','call','walk_in','field_visit','other') DEFAULT 'other',
  inquiry_text TEXT NULL,
  status ENUM('new','contacted','converted','dropped') DEFAULT 'new',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (customer_id) REFERENCES sales_customers(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_inquiries_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_pipeline (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  customer_id INT UNSIGNED NOT NULL,
  inquiry_id INT UNSIGNED NULL,
  deal_title VARCHAR(190) NOT NULL,
  stage ENUM(
    'new_inquiry','contacted','need_follow_up','sample_requested',
    'quotation_sent','negotiation','won','lost','on_hold'
  ) DEFAULT 'new_inquiry',
  estimated_value DECIMAL(15,2) NULL,
  currency VARCHAR(8) DEFAULT 'IDR',
  probability INT DEFAULT 0,          -- 0..100
  expected_close_date DATE NULL,
  owner_user_id INT UNSIGNED NULL,
  notes TEXT NULL,
  stage_changed_at TIMESTAMP NULL,
  closed_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (customer_id) REFERENCES sales_customers(id),
  FOREIGN KEY (inquiry_id) REFERENCES sales_inquiries(id),
  FOREIGN KEY (owner_user_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_pipeline_stage (entity_id, stage),
  INDEX idx_pipeline_owner (owner_user_id, stage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_pipeline_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pipeline_id INT UNSIGNED NOT NULL,
  from_stage VARCHAR(40) NULL,
  to_stage VARCHAR(40) NOT NULL,
  changed_by INT UNSIGNED NULL,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pipeline_id) REFERENCES sales_pipeline(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id),
  INDEX idx_pipeline_hist (pipeline_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_visit_reports (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  customer_id INT UNSIGNED NULL,
  pipeline_id INT UNSIGNED NULL,
  visit_date DATE NOT NULL,
  location VARCHAR(255) NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  summary TEXT NULL,
  raw_input TEXT NULL,               -- input asli dari bot
  photos JSON NULL,                  -- array drive file IDs
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (customer_id) REFERENCES sales_customers(id),
  FOREIGN KEY (pipeline_id) REFERENCES sales_pipeline(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_visit_customer (customer_id, visit_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_followups (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  customer_id INT UNSIGNED NOT NULL,
  pipeline_id INT UNSIGNED NULL,
  assigned_to INT UNSIGNED NULL,
  due_date DATE NOT NULL,
  title VARCHAR(190) NOT NULL,
  description TEXT NULL,
  status ENUM('open','done','cancelled','overdue') DEFAULT 'open',
  completed_at TIMESTAMP NULL,
  source VARCHAR(40) NULL,           -- 'manual','delivery_proof','sample_ready','ai'
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (customer_id) REFERENCES sales_customers(id),
  FOREIGN KEY (pipeline_id) REFERENCES sales_pipeline(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_followup_due (status, due_date),
  INDEX idx_followup_pipeline (pipeline_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_sample_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  customer_id INT UNSIGNED NOT NULL,
  pipeline_id INT UNSIGNED NULL,
  product_name VARCHAR(190) NOT NULL,
  product_sku VARCHAR(80) NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  unit VARCHAR(40) DEFAULT 'pcs',
  purpose VARCHAR(500) NULL,
  delivery_address VARCHAR(500) NULL,
  requested_delivery_date DATE NULL,
  priority ENUM('low','normal','high','urgent') DEFAULT 'normal',
  status ENUM('requested','approved','preparing','ready','delivered','rejected','cancelled') DEFAULT 'requested',
  rejection_reason VARCHAR(500) NULL,
  requested_by INT UNSIGNED NOT NULL,
  approved_by INT UNSIGNED NULL,
  approved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (customer_id) REFERENCES sales_customers(id),
  FOREIGN KEY (pipeline_id) REFERENCES sales_pipeline(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  INDEX idx_sample_status (status, created_at),
  INDEX idx_sample_pipeline (pipeline_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales_quotations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  customer_id INT UNSIGNED NOT NULL,
  pipeline_id INT UNSIGNED NULL,
  document_id INT UNSIGNED NULL,     -- link ke documents (template quotation)
  quotation_number VARCHAR(80) NOT NULL UNIQUE,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  currency VARCHAR(8) DEFAULT 'IDR',
  validity_date DATE NULL,
  status ENUM('draft','sent','accepted','rejected','expired') DEFAULT 'draft',
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (customer_id) REFERENCES sales_customers(id),
  FOREIGN KEY (pipeline_id) REFERENCES sales_pipeline(id),
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_quote_customer (customer_id),
  INDEX idx_quote_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS field_sales_bot_sessions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NOT NULL,
  session_token VARCHAR(64) NOT NULL UNIQUE,
  quick_action VARCHAR(80) NULL,     -- new_visit_report, follow_up, request_sample, dll
  context JSON NULL,                 -- customer_id, pipeline_id, dsb
  is_closed TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_bot_user (user_id, is_closed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS field_sales_bot_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id INT UNSIGNED NOT NULL,
  role ENUM('user','assistant','system') NOT NULL,
  content MEDIUMTEXT NOT NULL,
  ai_summary_id BIGINT UNSIGNED NULL,   -- link ke ai_summaries kalau role=assistant
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES field_sales_bot_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (ai_summary_id) REFERENCES ai_summaries(id),
  INDEX idx_bot_msg (session_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- WAREHOUSE
-- ============================================================

CREATE TABLE IF NOT EXISTS warehouse_checklists (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  checklist_date DATE NOT NULL,
  title VARCHAR(190) NOT NULL,
  items JSON NOT NULL,               -- [{label, checked, note}]
  completed TINYINT(1) DEFAULT 0,
  completed_by INT UNSIGNED NULL,
  completed_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (completed_by) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_wc_date (entity_id, checklist_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS warehouse_inbound (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  inbound_date DATE NOT NULL,
  reference_no VARCHAR(80) NULL,
  supplier VARCHAR(190) NULL,
  items JSON NOT NULL,               -- [{product, qty, unit, note}]
  notes TEXT NULL,
  received_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (received_by) REFERENCES users(id),
  INDEX idx_inbound_date (entity_id, inbound_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS warehouse_outbound (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  outbound_date DATE NOT NULL,
  reference_no VARCHAR(80) NULL,
  destination VARCHAR(255) NULL,
  items JSON NOT NULL,
  notes TEXT NULL,
  released_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (released_by) REFERENCES users(id),
  INDEX idx_outbound_date (entity_id, outbound_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS warehouse_sample_tasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  sample_request_id INT UNSIGNED NOT NULL UNIQUE,   -- 1:1 dengan sales_sample_requests
  assigned_to INT UNSIGNED NULL,
  status ENUM('queued','preparing','ready','delivered','cancelled') DEFAULT 'queued',
  prepared_at TIMESTAMP NULL,
  ready_at TIMESTAMP NULL,
  delivered_at TIMESTAMP NULL,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (sample_request_id) REFERENCES sales_sample_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(id),
  INDEX idx_wst_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS warehouse_incidents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  incident_date DATE NOT NULL,
  category VARCHAR(80) NOT NULL,     -- damage/lost/delay/dll
  severity ENUM('low','medium','high','critical') DEFAULT 'low',
  description TEXT NOT NULL,
  sample_task_id INT UNSIGNED NULL,
  photos JSON NULL,
  status ENUM('open','investigating','resolved','closed') DEFAULT 'open',
  resolution TEXT NULL,
  reported_by INT UNSIGNED NOT NULL,
  resolved_by INT UNSIGNED NULL,
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (sample_task_id) REFERENCES warehouse_sample_tasks(id),
  FOREIGN KEY (reported_by) REFERENCES users(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id),
  INDEX idx_incident_status (status, severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS warehouse_delivery_proofs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  sample_task_id INT UNSIGNED NULL,
  sample_request_id INT UNSIGNED NULL,
  outbound_id INT UNSIGNED NULL,
  recipient_name VARCHAR(190) NULL,
  recipient_phone VARCHAR(40) NULL,
  delivered_at TIMESTAMP NOT NULL,
  address VARCHAR(500) NULL,
  photo_drive_file_id VARCHAR(190) NULL,
  photo_web_view_link VARCHAR(500) NULL,
  signature_drive_file_id VARCHAR(190) NULL,
  notes TEXT NULL,
  delivered_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (sample_task_id) REFERENCES warehouse_sample_tasks(id),
  FOREIGN KEY (sample_request_id) REFERENCES sales_sample_requests(id),
  FOREIGN KEY (outbound_id) REFERENCES warehouse_outbound(id),
  FOREIGN KEY (delivered_by) REFERENCES users(id),
  INDEX idx_proof_sample (sample_request_id),
  INDEX idx_proof_date (entity_id, delivered_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
