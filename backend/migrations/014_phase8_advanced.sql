SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- CROSS-DIVISION LINKS (pelengkap context_records/related_records Fase 2)
-- ============================================================

CREATE TABLE IF NOT EXISTS cross_division_links (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  from_type VARCHAR(80) NOT NULL,
  from_id INT UNSIGNED NOT NULL,
  to_type VARCHAR(80) NOT NULL,
  to_id INT UNSIGNED NOT NULL,
  relation VARCHAR(50) DEFAULT 'related',    -- 'related','depends_on','blocks','derived_from'
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_cross_link (from_type, from_id, to_type, to_id, relation),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_cross_from (from_type, from_id),
  INDEX idx_cross_to (to_type, to_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS external_references (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  ref_type VARCHAR(80) NOT NULL,             -- 'jurnal_id','kantorku','google_drive','vendor_portal'
  ref_id VARCHAR(190) NOT NULL,
  ref_url VARCHAR(500) NULL,
  subject_type VARCHAR(80) NOT NULL,
  subject_id INT UNSIGNED NOT NULL,
  label VARCHAR(190) NULL,
  metadata JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  UNIQUE KEY unique_external_ref (ref_type, ref_id, subject_type, subject_id),
  INDEX idx_ext_subject (subject_type, subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- DECISION LOG (keputusan manajemen tercatat)
-- ============================================================

CREATE TABLE IF NOT EXISTS decision_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  decision TEXT NOT NULL,
  rationale TEXT NULL,
  impact TEXT NULL,
  category VARCHAR(80) NULL,                 -- 'operational','finance','hr','it','sales','strategy'
  status ENUM('proposed','approved','implemented','rejected','archived') DEFAULT 'proposed',
  decided_by_user_id INT UNSIGNED NULL,
  decided_at TIMESTAMP NULL,
  effective_date DATE NULL,
  -- relasi ke entitas lain
  subject_type VARCHAR(80) NULL,             -- 'customer','sales_pipeline','finance_workflow','hrga_workflow','project'
  subject_id INT UNSIGNED NULL,
  context_record_id BIGINT UNSIGNED NULL,
  attachment_document_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (decided_by_user_id) REFERENCES users(id),
  FOREIGN KEY (context_record_id) REFERENCES context_records(id),
  FOREIGN KEY (attachment_document_id) REFERENCES documents(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_decision_entity (entity_id, category, status),
  INDEX idx_decision_subject (subject_type, subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- AI KNOWLEDGE BASE / SOP CENTER
-- ============================================================

CREATE TABLE IF NOT EXISTS kb_documents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(80) NULL,                 -- 'sop','policy','guideline','faq','manual'
  source_document_id INT UNSIGNED NULL,      -- link ke documents Fase 2
  drive_file_id VARCHAR(190) NULL,
  extracted_text MEDIUMTEXT NULL,            -- teks hasil ekstraksi (chunk dasar)
  visibility ENUM('entity','department','role','private') DEFAULT 'entity',
  allowed_role_ids JSON NULL,                -- daftar role_id yang boleh akses (kalau visibility='role')
  is_active TINYINT(1) DEFAULT 1,
  uploaded_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (source_document_id) REFERENCES documents(id),
  FOREIGN KEY (uploaded_by) REFERENCES users(id),
  INDEX idx_kb_doc_entity (entity_id, category, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS kb_query_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kb_document_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  ai_summary_id BIGINT UNSIGNED NULL,
  provider VARCHAR(40) NULL,
  model VARCHAR(120) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (kb_document_id) REFERENCES kb_documents(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (ai_summary_id) REFERENCES ai_summaries(id),
  INDEX idx_kb_query_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- AUTOMATION BUILDER (rule-based, dijalankan cron)
-- ============================================================

CREATE TABLE IF NOT EXISTS automation_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  name VARCHAR(190) NOT NULL,
  description VARCHAR(500) NULL,
  trigger_type ENUM(
    'schedule',          -- dijalankan tiap kali cron
    'entity_event'       -- dipicu event (di cek di cron)
  ) DEFAULT 'schedule',
  trigger_config JSON NOT NULL,               -- mis. { "scan": "tasks_overdue_by_days", "days": 3 }
  condition_config JSON NULL,                 -- filter lanjutan (opsional)
  action_type ENUM(
    'create_task','create_notification','update_status',
    'send_google_chat','link_records','create_approval','escalate'
  ) NOT NULL,
  action_config JSON NOT NULL,                -- mis. { "task_title": "...", "assignee_role_id": 5 }
  schedule_cron VARCHAR(80) NULL,             -- untuk referensi saja (actual cron di cPanel)
  is_active TINYINT(1) DEFAULT 1,
  last_run_at TIMESTAMP NULL,
  last_run_status ENUM('success','failed','skipped') NULL,
  last_run_message VARCHAR(500) NULL,
  run_count INT UNSIGNED DEFAULT 0,
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_automation_entity (entity_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS automation_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  automation_rule_id INT UNSIGNED NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  subject_type VARCHAR(80) NULL,
  subject_id INT UNSIGNED NULL,
  status ENUM('success','failed','skipped') NOT NULL,
  message VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (automation_rule_id) REFERENCES automation_rules(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  INDEX idx_automation_log_rule (automation_rule_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- AI DAILY / WEEKLY BRIEF
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_briefs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  brief_type ENUM('daily','weekly') NOT NULL,
  brief_date DATE NOT NULL,
  audience_user_id INT UNSIGNED NULL,        -- null = semua manager/executive
  content MEDIUMTEXT NOT NULL,
  ai_summary_id BIGINT UNSIGNED NULL,
  provider VARCHAR(40) NULL,
  model VARCHAR(120) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (audience_user_id) REFERENCES users(id),
  FOREIGN KEY (ai_summary_id) REFERENCES ai_summaries(id),
  UNIQUE KEY unique_brief (entity_id, department_id, brief_type, brief_date, audience_user_id),
  INDEX idx_brief_lookup (entity_id, brief_type, brief_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- DATA CLASSIFICATION (tag level sensitivitas dokumen/data)
-- ============================================================

CREATE TABLE IF NOT EXISTS data_classifications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  subject_type VARCHAR(80) NOT NULL,         -- 'document','customer','finance_workflow','hrga_workflow'
  subject_id INT UNSIGNED NOT NULL,
  classification ENUM('public','internal','confidential','restricted') DEFAULT 'internal',
  tags JSON NULL,                            -- ['pii','financial','hr','legal']
  classified_by INT UNSIGNED NULL,
  classified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes VARCHAR(500) NULL,
  UNIQUE KEY unique_classification (subject_type, subject_id),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (classified_by) REFERENCES users(id),
  INDEX idx_class_lookup (subject_type, subject_id, classification)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
