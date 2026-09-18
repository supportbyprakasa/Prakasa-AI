SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- TASK BOARD
-- ============================================================

CREATE TABLE IF NOT EXISTS boards (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  name VARCHAR(190) NOT NULL,
  description VARCHAR(500) NULL,
  is_archived TINYINT(1) DEFAULT 0,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_boards_entity_dept (entity_id, department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS board_columns (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  board_id INT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  position INT DEFAULT 0,
  wip_limit INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
  INDEX idx_columns_board (board_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  board_id INT UNSIGNED NULL,
  column_id INT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status VARCHAR(50) DEFAULT 'open',
  priority ENUM('low','normal','high','urgent') DEFAULT 'normal',
  assignee_id INT UNSIGNED NULL,
  reporter_id INT UNSIGNED NULL,
  due_date DATE NULL,
  position INT DEFAULT 0,
  completed_at TIMESTAMP NULL,
  source_type VARCHAR(50) NULL,       -- 'chat' kalau dibuat dari chat
  source_id INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (board_id) REFERENCES boards(id),
  FOREIGN KEY (column_id) REFERENCES board_columns(id),
  FOREIGN KEY (assignee_id) REFERENCES users(id),
  FOREIGN KEY (reporter_id) REFERENCES users(id),
  INDEX idx_tasks_board_col (board_id, column_id, position),
  INDEX idx_tasks_assignee (assignee_id, status),
  INDEX idx_tasks_due (due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS task_comments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_task_comments (task_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS task_attachments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id INT UNSIGNED NOT NULL,
  drive_file_id VARCHAR(190) NOT NULL,
  name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NULL,
  web_view_link VARCHAR(500) NULL,
  uploaded_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id),
  INDEX idx_task_attach (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- CHAT INTERNAL
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_rooms (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  name VARCHAR(190) NOT NULL,
  room_type ENUM('division','project','direct') DEFAULT 'division',
  is_archived TINYINT(1) DEFAULT 0,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_chat_rooms_entity (entity_id, department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_room_members (
  room_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  room_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  message_type ENUM('text','system','attachment') DEFAULT 'text',
  converted_task_id INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_chat_messages (room_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- NOTIFICATION CENTER
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  title VARCHAR(190) NOT NULL,
  body VARCHAR(500) NULL,
  event VARCHAR(80) NOT NULL,
  subject_type VARCHAR(80) NULL,
  subject_id INT UNSIGNED NULL,
  action_url VARCHAR(500) NULL,
  is_read TINYINT(1) DEFAULT 0,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  INDEX idx_notif_user (user_id, is_read, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notification_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  event VARCHAR(80) NOT NULL,
  channel ENUM('in_app','google_chat','email') DEFAULT 'in_app',
  template VARCHAR(500) NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  INDEX idx_notif_rules (entity_id, event)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- APPROVAL & SIGNATURE
-- ============================================================

CREATE TABLE IF NOT EXISTS approval_matrix (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  document_type VARCHAR(80) NOT NULL,
  level INT UNSIGNED NOT NULL,
  approver_role_id INT UNSIGNED NULL,       -- role yang berhak approve di level ini
  approver_user_id INT UNSIGNED NULL,       -- atau user spesifik
  is_required TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (approver_role_id) REFERENCES roles(id),
  FOREIGN KEY (approver_user_id) REFERENCES users(id),
  INDEX idx_matrix_lookup (entity_id, department_id, document_type, level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS approval_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  document_id INT UNSIGNED NULL,
  subject_type VARCHAR(80) NOT NULL,         -- 'document','payment','sample','leave'
  subject_id INT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  approval_type ENUM('level_1','level_2') DEFAULT 'level_1',  -- sesuai SOW
  current_level INT UNSIGNED DEFAULT 1,
  status ENUM('pending','approved','rejected','revision_requested','cancelled') DEFAULT 'pending',
  requested_by INT UNSIGNED NOT NULL,
  decided_by INT UNSIGNED NULL,
  decided_at TIMESTAMP NULL,
  decision_note VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (decided_by) REFERENCES users(id),
  INDEX idx_approval_status (status, current_level),
  INDEX idx_approval_subject (subject_type, subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS approval_steps (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  approval_request_id INT UNSIGNED NOT NULL,
  level INT UNSIGNED NOT NULL,
  approver_user_id INT UNSIGNED NULL,
  approver_role_id INT UNSIGNED NULL,
  status ENUM('pending','approved','rejected','skipped') DEFAULT 'pending',
  decided_by INT UNSIGNED NULL,
  decided_at TIMESTAMP NULL,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (approver_user_id) REFERENCES users(id),
  FOREIGN KEY (approver_role_id) REFERENCES roles(id),
  FOREIGN KEY (decided_by) REFERENCES users(id),
  INDEX idx_steps_request_level (approval_request_id, level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS signature_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  document_id INT UNSIGNED NOT NULL,
  approval_request_id INT UNSIGNED NULL,     -- wajib ada sebelum tanda tangan
  signature_type ENUM('level_1','level_2') DEFAULT 'level_1',
  status ENUM('pending','approved','rejected','signed','cancelled') DEFAULT 'pending',
  requested_by INT UNSIGNED NOT NULL,
  signed_by INT UNSIGNED NULL,
  signed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (signed_by) REFERENCES users(id),
  INDEX idx_sig_status (status),
  INDEX idx_sig_document (document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS signature_placeholders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id INT UNSIGNED NOT NULL,
  page INT UNSIGNED NOT NULL,
  x DECIMAL(8,2) NOT NULL,
  y DECIMAL(8,2) NOT NULL,
  width DECIMAL(8,2) NOT NULL DEFAULT 150,
  height DECIMAL(8,2) NOT NULL DEFAULT 60,
  signer_user_id INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (signer_user_id) REFERENCES users(id),
  INDEX idx_ph_doc (document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS signature_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  signature_request_id INT UNSIGNED NOT NULL,
  action ENUM('requested','approved','rejected','signed','cancelled') NOT NULL,
  actor_user_id INT UNSIGNED NOT NULL,
  ip_address VARCHAR(45) NULL,
  document_id INT UNSIGNED NULL,
  document_hash VARCHAR(128) NULL,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (signature_request_id) REFERENCES signature_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id),
  INDEX idx_siglog_request (signature_request_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS signed_documents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  signature_request_id INT UNSIGNED NOT NULL,
  document_id INT UNSIGNED NOT NULL,
  drive_file_id VARCHAR(190) NOT NULL,
  drive_folder_id VARCHAR(190) NULL,
  web_view_link VARCHAR(500) NULL,
  document_hash VARCHAR(128) NOT NULL,
  signed_by INT UNSIGNED NOT NULL,
  signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (signature_request_id) REFERENCES signature_requests(id),
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (signed_by) REFERENCES users(id),
  INDEX idx_signed_doc (document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS document_verifications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id INT UNSIGNED NOT NULL,
  verification_code VARCHAR(64) NOT NULL UNIQUE,   -- kode QR
  document_hash VARCHAR(128) NOT NULL,
  signed_document_id INT UNSIGNED NULL,
  valid_until TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (signed_document_id) REFERENCES signed_documents(id),
  INDEX idx_verif_code (verification_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabel signature_assets menyimpan gambar tanda tangan user secara terenkripsi
CREATE TABLE IF NOT EXISTS signature_assets (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL UNIQUE,
  encrypted_blob MEDIUMBLOB NOT NULL,
  iv VARCHAR(64) NOT NULL,
  auth_tag VARCHAR(64) NOT NULL,
  mime_type VARCHAR(80) DEFAULT 'image/png',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
