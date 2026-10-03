-- ============================================================
-- Migration 115 — Template dokumen, kop & footer per divisi, dan dokumen yang
-- dibuat dari template (owner, 1 Oct 2026): BAST serah terima / pengembalian
-- perangkat dan nomor HP (kolaborasi IT dan GA) and any other document, made
-- as a Google Doc in the division's Shared Drive folder.
--
--   doc_kops             the kop (header) and footer of a division, or of the
--                        whole company (department_id NULL, used when a
--                        division has none). The settings the app renders,
--                        plus the Google Doc made from them (users may refine
--                        that doc in Google Docs).
--   document_templates   + template_key (built-in templates: bast_device_handover,
--                        bast_device_return, bast_phone_handover, bast_phone_return),
--                        + document_prefix (number prefix), + placeholders_json
--                        (keys found in the template), + checked_at.
--   generated_documents  every document made from a template: number, title,
--                        the Google Doc, the division, what it is about
--                        (subject_type/subject_id, e.g. device_assignment) and
--                        the values used (never a password or a cost).
--
-- New tables and columns only; no existing row changes.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS doc_kops (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  department_key INT UNSIGNED GENERATED ALWAYS AS (COALESCE(department_id, 0)) STORED,
  layout ENUM('logo_left', 'centered', 'letterhead_image') NOT NULL DEFAULT 'logo_left',
  company_name VARCHAR(150) NOT NULL,
  header_lines VARCHAR(600) NULL,
  footer_text VARCHAR(600) NULL,
  show_page_number TINYINT(1) NOT NULL DEFAULT 1,
  accent_color CHAR(7) NOT NULL DEFAULT '#1A73E8',
  logo_blob MEDIUMBLOB NULL,
  logo_mime VARCHAR(40) NULL,
  drive_file_id VARCHAR(128) NULL,
  web_view_link VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_doc_kops_scope (entity_id, department_key),
  CONSTRAINT chk_doc_kops_company CHECK (CHAR_LENGTH(TRIM(company_name)) > 0),
  CONSTRAINT chk_doc_kops_color CHECK (accent_color REGEXP '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT chk_doc_kops_logo CHECK ((logo_blob IS NULL) = (logo_mime IS NULL)),
  CONSTRAINT fk_doc_kops_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_doc_kops_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_doc_kops_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_doc_kops_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET @need := (SELECT COUNT(*) = 0 FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'document_templates' AND column_name = 'template_key');
SET @sql := IF(@need, "ALTER TABLE document_templates
  ADD COLUMN template_key VARCHAR(60) NULL AFTER name,
  ADD COLUMN document_prefix VARCHAR(12) NOT NULL DEFAULT 'DOK' AFTER document_type,
  ADD COLUMN placeholders_json JSON NULL AFTER drive_template_mime,
  ADD COLUMN checked_at DATETIME NULL AFTER placeholders_json,
  ADD COLUMN web_view_link VARCHAR(500) NULL AFTER drive_template_mime,
  ADD UNIQUE KEY uq_document_templates_key (entity_id, template_key)", 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS generated_documents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  template_id INT UNSIGNED NULL,
  template_key VARCHAR(60) NULL,
  doc_number VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  drive_file_id VARCHAR(128) NOT NULL,
  web_view_link VARCHAR(500) NULL,
  folder_id VARCHAR(128) NULL,
  subject_type VARCHAR(40) NULL,
  subject_id INT UNSIGNED NULL,
  field_values JSON NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_generated_documents_number (doc_number),
  KEY idx_generated_documents_entity (entity_id, department_id, created_at),
  KEY idx_generated_documents_subject (entity_id, subject_type, subject_id),
  CONSTRAINT fk_generated_documents_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_generated_documents_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_generated_documents_template FOREIGN KEY (template_id) REFERENCES document_templates(id),
  CONSTRAINT fk_generated_documents_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
