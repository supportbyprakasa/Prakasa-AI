SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- DRIVE & DOCUMENT METADATA
-- ============================================================

CREATE TABLE IF NOT EXISTS drive_folders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  name VARCHAR(190) NOT NULL,
  drive_folder_id VARCHAR(190) NOT NULL UNIQUE,        -- ID folder di Google Drive
  parent_drive_folder_id VARCHAR(190) NULL,
  path VARCHAR(500) NULL,                              -- cache path "/Prakasa/Docs/Sales"
  is_shared_drive TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  INDEX idx_drive_folders_entity_dept (entity_id, department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS drive_files_metadata (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  drive_file_id VARCHAR(190) NOT NULL UNIQUE,
  drive_folder_id VARCHAR(190) NULL,
  name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NOT NULL,
  size BIGINT UNSIGNED NULL,
  web_view_link VARCHAR(500) NULL,
  owner_email VARCHAR(190) NULL,
  checksum VARCHAR(128) NULL,                          -- sha256 untuk audit
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  INDEX idx_drive_files_entity (entity_id),
  INDEX idx_drive_files_folder (drive_folder_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- DOCUMENTS & TEMPLATES
-- ============================================================

CREATE TABLE IF NOT EXISTS document_templates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  name VARCHAR(190) NOT NULL,
  document_type VARCHAR(80) NOT NULL,                  -- proposal/quotation/sop/memo/dll
  description VARCHAR(500) NULL,
  drive_template_file_id VARCHAR(190) NOT NULL,        -- file template di Drive
  drive_template_mime VARCHAR(150) NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_templates_entity_type (entity_id, document_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS template_placeholders (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  template_id INT UNSIGNED NOT NULL,
  `key` VARCHAR(80) NOT NULL,                          -- {{customer_name}}
  label VARCHAR(190) NOT NULL,
  field_type ENUM('text','number','date','currency','long_text') DEFAULT 'text',
  default_value VARCHAR(500) NULL,
  required TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_template_key (template_id, `key`),
  FOREIGN KEY (template_id) REFERENCES document_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS documents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  document_type VARCHAR(80) NOT NULL,
  status ENUM('draft','final','archived') DEFAULT 'draft',
  drive_file_id VARCHAR(190) NULL,
  drive_folder_id VARCHAR(190) NULL,
  template_id INT UNSIGNED NULL,
  current_version_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (template_id) REFERENCES document_templates(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_documents_entity_dept (entity_id, department_id),
  INDEX idx_documents_type_status (document_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS document_versions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id INT UNSIGNED NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  drive_file_id VARCHAR(190) NOT NULL,
  drive_file_mime VARCHAR(150) NULL,
  size BIGINT UNSIGNED NULL,
  checksum VARCHAR(128) NULL,
  notes VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_doc_version (document_id, version_no),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS folder_mapping_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  document_type VARCHAR(80) NOT NULL,
  drive_folder_id VARCHAR(190) NOT NULL,               -- tujuan folder Drive
  priority INT DEFAULT 100,                            -- makin kecil makin prioritas
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  INDEX idx_rules_match (entity_id, department_id, document_type, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- AI CORE (dipakai semua fase selanjutnya)
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_module_contexts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  module VARCHAR(80) NOT NULL UNIQUE,                  -- 'document_assistant', 'sales_bot', dll
  provider ENUM('openai','gemini','claude') NOT NULL,
  model VARCHAR(120) NOT NULL,
  system_prompt TEXT NULL,
  params JSON NULL,                                    -- temperature, max_tokens, dll
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_summaries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  module VARCHAR(80) NOT NULL,
  subject_type VARCHAR(80) NOT NULL,
  subject_id INT UNSIGNED NULL,
  provider VARCHAR(40) NOT NULL,
  model VARCHAR(120) NOT NULL,
  prompt_hash VARCHAR(128) NULL,
  content MEDIUMTEXT NOT NULL,
  tokens_in INT UNSIGNED NULL,
  tokens_out INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_ai_summaries_subject (subject_type, subject_id),
  INDEX idx_ai_summaries_module (module, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_actions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ai_summary_id BIGINT UNSIGNED NULL,
  entity_id INT UNSIGNED NOT NULL,
  action_type VARCHAR(80) NOT NULL,                    -- 'create_task','send_notification'
  payload JSON NULL,
  status ENUM('pending','approved','rejected','executed') DEFAULT 'pending',
  decided_by INT UNSIGNED NULL,
  decided_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ai_summary_id) REFERENCES ai_summaries(id) ON DELETE SET NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (decided_by) REFERENCES users(id),
  INDEX idx_ai_actions_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- CROSS-DIVISION LINKING (fondasi fase berikutnya)
-- ============================================================

CREATE TABLE IF NOT EXISTS context_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  context_type VARCHAR(80) NOT NULL,                   -- 'customer','project','employee','vendor'
  context_id INT UNSIGNED NULL,                        -- referensi ke tabel modul terkait
  label VARCHAR(190) NOT NULL,
  metadata JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  INDEX idx_context_type_id (context_type, context_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS related_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  context_record_id BIGINT UNSIGNED NOT NULL,
  related_type VARCHAR(80) NOT NULL,                   -- 'document','task','meeting','invoice'
  related_id INT UNSIGNED NOT NULL,
  relation VARCHAR(50) DEFAULT 'linked',               -- 'linked','attachment','reference'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_relation (context_record_id, related_type, related_id),
  FOREIGN KEY (context_record_id) REFERENCES context_records(id) ON DELETE CASCADE,
  INDEX idx_related_lookup (related_type, related_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed: konfigurasi AI default untuk document assistant
INSERT IGNORE INTO ai_module_contexts (module, provider, model, system_prompt, params)
VALUES (
  'document_assistant',
  'openai',
  'gpt-4o-mini',
  'Kamu adalah asisten dokumen internal Prakasa Group. Tugas: meringkas, memeriksa kelengkapan, dan memeriksa konsistensi angka pada dokumen. JANGAN mengubah isi dokumen secara final. Selalu jawab dalam Bahasa Indonesia.',
  JSON_OBJECT('temperature', 0.2, 'max_tokens', 800)
);

SET FOREIGN_KEY_CHECKS = 1;
