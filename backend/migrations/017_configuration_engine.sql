-- ============================================================
-- Migration 017 — Configuration Engine Foundation
-- Additive only. Preserves existing migrations 001-016.
-- ============================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- WORKFLOW DEFINITIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  name VARCHAR(190) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  description TEXT NULL,
  applies_to VARCHAR(80) NULL,
  reference_id INT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  UNIQUE KEY uq_wf_entity_slug (entity_id, slug),
  INDEX idx_wf_entity_active (entity_id, is_active),
  CONSTRAINT fk_wf_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_wf_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS workflow_statuses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_definition_id INT UNSIGNED NOT NULL,
  code VARCHAR(80) NOT NULL,
  label VARCHAR(120) NOT NULL,
  color VARCHAR(20) DEFAULT '#64748b',
  is_initial TINYINT(1) NOT NULL DEFAULT 0,
  is_final TINYINT(1) NOT NULL DEFAULT 0,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wf_status_code (workflow_definition_id, code),
  INDEX idx_wf_status_order (workflow_definition_id, order_index),
  CONSTRAINT fk_wf_status_wf FOREIGN KEY (workflow_definition_id)
    REFERENCES workflow_definitions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS workflow_transitions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_definition_id INT UNSIGNED NOT NULL,
  from_status_id INT UNSIGNED NOT NULL,
  to_status_id INT UNSIGNED NOT NULL,
  action_label VARCHAR(120) NOT NULL,
  required_permission_code VARCHAR(100) NULL,
  requires_approval TINYINT(1) NOT NULL DEFAULT 0,
  requires_signature TINYINT(1) NOT NULL DEFAULT 0,
  requires_comment TINYINT(1) NOT NULL DEFAULT 0,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wf_transition (workflow_definition_id, from_status_id, to_status_id),
  INDEX idx_wf_trans_wf (workflow_definition_id, order_index),
  CONSTRAINT fk_wf_trans_wf FOREIGN KEY (workflow_definition_id)
    REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  CONSTRAINT fk_wf_trans_from FOREIGN KEY (from_status_id)
    REFERENCES workflow_statuses(id) ON DELETE CASCADE,
  CONSTRAINT fk_wf_trans_to FOREIGN KEY (to_status_id)
    REFERENCES workflow_statuses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS workflow_instances (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_definition_id INT UNSIGNED NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  subject_type VARCHAR(80) NOT NULL,
  subject_id INT UNSIGNED NOT NULL,
  current_status_id INT UNSIGNED NOT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL,
  UNIQUE KEY uq_wf_instance_subject (entity_id, subject_type, subject_id),
  INDEX idx_wf_instance_wf (workflow_definition_id, current_status_id),
  INDEX idx_wf_instance_entity (entity_id, created_at),
  CONSTRAINT fk_wf_instance_wf FOREIGN KEY (workflow_definition_id)
    REFERENCES workflow_definitions(id),
  CONSTRAINT fk_wf_instance_entity FOREIGN KEY (entity_id)
    REFERENCES entities(id),
  CONSTRAINT fk_wf_instance_department FOREIGN KEY (department_id)
    REFERENCES departments(id),
  CONSTRAINT fk_wf_instance_status FOREIGN KEY (current_status_id)
    REFERENCES workflow_statuses(id),
  CONSTRAINT fk_wf_instance_created_by FOREIGN KEY (created_by)
    REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS workflow_instance_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_instance_id INT UNSIGNED NOT NULL,
  from_status_id INT UNSIGNED NULL,
  to_status_id INT UNSIGNED NOT NULL,
  transition_id INT UNSIGNED NULL,
  actor_user_id INT UNSIGNED NULL,
  comment TEXT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wf_hist_instance (workflow_instance_id, created_at),
  CONSTRAINT fk_wf_hist_instance FOREIGN KEY (workflow_instance_id)
    REFERENCES workflow_instances(id) ON DELETE CASCADE,
  CONSTRAINT fk_wf_hist_from FOREIGN KEY (from_status_id)
    REFERENCES workflow_statuses(id) ON DELETE SET NULL,
  CONSTRAINT fk_wf_hist_to FOREIGN KEY (to_status_id)
    REFERENCES workflow_statuses(id),
  CONSTRAINT fk_wf_hist_trans FOREIGN KEY (transition_id)
    REFERENCES workflow_transitions(id) ON DELETE SET NULL,
  CONSTRAINT fk_wf_hist_actor FOREIGN KEY (actor_user_id)
    REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- CONFIGURABLE DOCUMENT TYPES
-- Existing documents.document_type remains intact for compatibility.
-- ============================================================
CREATE TABLE IF NOT EXISTS document_types (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(190) NOT NULL,
  category VARCHAR(80) NULL,
  default_workflow_id INT UNSIGNED NULL,
  default_approval_matrix_id INT UNSIGNED NULL,
  default_folder_id VARCHAR(190) NULL,
  requires_signature TINYINT(1) NOT NULL DEFAULT 0,
  requires_ai_precheck TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  UNIQUE KEY uq_doctype_entity_code (entity_id, code),
  INDEX idx_doctype_entity_active (entity_id, is_active),
  CONSTRAINT fk_doctype_entity FOREIGN KEY (entity_id)
    REFERENCES entities(id),
  CONSTRAINT fk_doctype_wf FOREIGN KEY (default_workflow_id)
    REFERENCES workflow_definitions(id) ON DELETE SET NULL,
  CONSTRAINT fk_doctype_approval FOREIGN KEY (default_approval_matrix_id)
    REFERENCES approval_matrix(id) ON DELETE SET NULL,
  CONSTRAINT fk_doctype_created_by FOREIGN KEY (created_by)
    REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- FORMS
-- ============================================================
CREATE TABLE IF NOT EXISTS forms (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  name VARCHAR(190) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  description TEXT NULL,
  category VARCHAR(80) NULL,
  icon VARCHAR(40) NULL,
  color VARCHAR(20) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  submit_permission_code VARCHAR(100) NULL,
  view_permission_code VARCHAR(100) NULL,
  workflow_definition_id INT UNSIGNED NULL,
  approval_matrix_id INT UNSIGNED NULL,
  document_type_id INT UNSIGNED NULL,
  folder_mapping_rule_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  UNIQUE KEY uq_forms_entity_slug (entity_id, slug),
  INDEX idx_forms_entity_active (entity_id, is_active),
  CONSTRAINT fk_forms_entity FOREIGN KEY (entity_id)
    REFERENCES entities(id),
  CONSTRAINT fk_forms_department FOREIGN KEY (department_id)
    REFERENCES departments(id),
  CONSTRAINT fk_forms_workflow FOREIGN KEY (workflow_definition_id)
    REFERENCES workflow_definitions(id) ON DELETE SET NULL,
  CONSTRAINT fk_forms_approval FOREIGN KEY (approval_matrix_id)
    REFERENCES approval_matrix(id) ON DELETE SET NULL,
  CONSTRAINT fk_forms_doctype FOREIGN KEY (document_type_id)
    REFERENCES document_types(id) ON DELETE SET NULL,
  CONSTRAINT fk_forms_folder_rule FOREIGN KEY (folder_mapping_rule_id)
    REFERENCES folder_mapping_rules(id) ON DELETE SET NULL,
  CONSTRAINT fk_forms_created_by FOREIGN KEY (created_by)
    REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS form_fields (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  form_id INT UNSIGNED NOT NULL,
  field_key VARCHAR(80) NOT NULL,
  label VARCHAR(190) NOT NULL,
  field_type VARCHAR(40) NOT NULL,
  placeholder VARCHAR(255) NULL,
  help_text VARCHAR(500) NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 0,
  default_value VARCHAR(500) NULL,
  options_json JSON NULL,
  validation_json JSON NULL,
  section_name VARCHAR(120) NULL,
  order_index INT NOT NULL DEFAULT 0,
  reference_type VARCHAR(80) NULL,
  depends_on_field_key VARCHAR(80) NULL,
  depends_on_value VARCHAR(190) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  UNIQUE KEY uq_form_field_key (form_id, field_key),
  INDEX idx_form_fields_order (form_id, order_index),
  CONSTRAINT fk_form_fields_form FOREIGN KEY (form_id)
    REFERENCES forms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS form_submissions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  form_id INT UNSIGNED NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  submission_number VARCHAR(80) NOT NULL UNIQUE,
  status VARCHAR(40) NOT NULL DEFAULT 'draft',
  title VARCHAR(255) NULL,
  notes TEXT NULL,
  submitted_by INT UNSIGNED NOT NULL,
  submitted_at TIMESTAMP NULL,
  workflow_instance_id INT UNSIGNED NULL,
  approval_request_id INT UNSIGNED NULL,
  context_type VARCHAR(80) NULL,
  context_id INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  INDEX idx_fs_form_status (form_id, status),
  INDEX idx_fs_entity_status (entity_id, status, created_at),
  INDEX idx_fs_context (context_type, context_id),
  INDEX idx_fs_submitted_by (submitted_by, created_at),
  CONSTRAINT fk_fs_form FOREIGN KEY (form_id)
    REFERENCES forms(id),
  CONSTRAINT fk_fs_entity FOREIGN KEY (entity_id)
    REFERENCES entities(id),
  CONSTRAINT fk_fs_department FOREIGN KEY (department_id)
    REFERENCES departments(id),
  CONSTRAINT fk_fs_submitted_by FOREIGN KEY (submitted_by)
    REFERENCES users(id),
  CONSTRAINT fk_fs_workflow_instance FOREIGN KEY (workflow_instance_id)
    REFERENCES workflow_instances(id) ON DELETE SET NULL,
  CONSTRAINT fk_fs_approval_request FOREIGN KEY (approval_request_id)
    REFERENCES approval_requests(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS form_submission_values (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  submission_id INT UNSIGNED NOT NULL,
  field_id INT UNSIGNED NOT NULL,
  field_key VARCHAR(80) NOT NULL,
  value_text TEXT NULL,
  value_number DECIMAL(20,4) NULL,
  value_date DATETIME NULL,
  value_json JSON NULL,
  value_user_id INT UNSIGNED NULL,
  value_document_id INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fsv_submission_field (submission_id, field_id),
  INDEX idx_fsv_field_key (field_key),
  INDEX idx_fsv_value_text (value_text(128)),
  INDEX idx_fsv_value_number (value_number),
  CONSTRAINT fk_fsv_submission FOREIGN KEY (submission_id)
    REFERENCES form_submissions(id) ON DELETE CASCADE,
  CONSTRAINT fk_fsv_field FOREIGN KEY (field_id)
    REFERENCES form_fields(id) ON DELETE CASCADE,
  CONSTRAINT fk_fsv_user FOREIGN KEY (value_user_id)
    REFERENCES users(id),
  CONSTRAINT fk_fsv_document FOREIGN KEY (value_document_id)
    REFERENCES documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS form_submission_attachments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  submission_id INT UNSIGNED NOT NULL,
  field_id INT UNSIGNED NULL,
  field_key VARCHAR(80) NULL,
  document_id INT UNSIGNED NULL,
  drive_file_id VARCHAR(190) NOT NULL,
  drive_folder_id VARCHAR(190) NULL,
  web_view_link VARCHAR(500) NULL,
  name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NULL,
  size BIGINT UNSIGNED NULL,
  checksum VARCHAR(128) NULL,
  uploaded_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  INDEX idx_fsa_submission (submission_id),
  INDEX idx_fsa_field (field_id),
  CONSTRAINT fk_fsa_submission FOREIGN KEY (submission_id)
    REFERENCES form_submissions(id) ON DELETE CASCADE,
  CONSTRAINT fk_fsa_field FOREIGN KEY (field_id)
    REFERENCES form_fields(id) ON DELETE SET NULL,
  CONSTRAINT fk_fsa_document FOREIGN KEY (document_id)
    REFERENCES documents(id) ON DELETE SET NULL,
  CONSTRAINT fk_fsa_uploaded_by FOREIGN KEY (uploaded_by)
    REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SIGNATURE RULES
-- ============================================================
CREATE TABLE IF NOT EXISTS signature_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  document_type_id INT UNSIGNED NULL,
  applies_to_form_id INT UNSIGNED NULL,
  min_approval_level INT UNSIGNED NOT NULL DEFAULT 1,
  required_signer_role_id INT UNSIGNED NULL,
  required_signer_user_id INT UNSIGNED NULL,
  requires_ai_precheck TINYINT(1) NOT NULL DEFAULT 1,
  allow_delegation TINYINT(1) NOT NULL DEFAULT 1,
  auto_generate_verification_code TINYINT(1) NOT NULL DEFAULT 1,
  archive_folder_drive_id VARCHAR(190) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  INDEX idx_sigrule_entity_active (entity_id, is_active),
  CONSTRAINT fk_sigrule_entity FOREIGN KEY (entity_id)
    REFERENCES entities(id),
  CONSTRAINT fk_sigrule_doctype FOREIGN KEY (document_type_id)
    REFERENCES document_types(id) ON DELETE SET NULL,
  CONSTRAINT fk_sigrule_form FOREIGN KEY (applies_to_form_id)
    REFERENCES forms(id) ON DELETE SET NULL,
  CONSTRAINT fk_sigrule_role FOREIGN KEY (required_signer_role_id)
    REFERENCES roles(id) ON DELETE SET NULL,
  CONSTRAINT fk_sigrule_user FOREIGN KEY (required_signer_user_id)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_sigrule_created_by FOREIGN KEY (created_by)
    REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- DASHBOARD CONFIG
-- ============================================================
CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(190) NOT NULL,
  description VARCHAR(500) NULL,
  category VARCHAR(80) NULL,
  default_size VARCHAR(20) NOT NULL DEFAULT 'medium',
  config_schema JSON NULL,
  permission_code VARCHAR(100) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dashboard_role_layouts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  role_id INT UNSIGNED NOT NULL,
  name VARCHAR(120) NULL,
  layout_json JSON NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_role_layout (entity_id, role_id),
  CONSTRAINT fk_drl_entity FOREIGN KEY (entity_id)
    REFERENCES entities(id),
  CONSTRAINT fk_drl_role FOREIGN KEY (role_id)
    REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_drl_created_by FOREIGN KEY (created_by)
    REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- INTEGRATION LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS integration_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NULL,
  provider VARCHAR(40) NOT NULL,
  operation VARCHAR(120) NOT NULL,
  subject_type VARCHAR(80) NULL,
  subject_id INT UNSIGNED NULL,
  status VARCHAR(20) NOT NULL,
  error_message VARCHAR(500) NULL,
  request_meta JSON NULL,
  response_meta JSON NULL,
  duration_ms INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_intlog_provider_time (provider, created_at),
  INDEX idx_intlog_status (status, created_at),
  INDEX idx_intlog_entity_time (entity_id, created_at),
  INDEX idx_intlog_subject (subject_type, subject_id),
  CONSTRAINT fk_intlog_entity FOREIGN KEY (entity_id)
    REFERENCES entities(id) ON DELETE SET NULL,
  CONSTRAINT fk_intlog_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
