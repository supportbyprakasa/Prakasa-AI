-- ============================================================
-- Migration 021 — Approval Engine Expansion (Batch 2)
-- Extends Phase 3 approval tables without dropping legacy fields.
-- ============================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Helper pattern: add columns only when missing.

-- approval_matrix: matrix identity / grouping

-- Legacy column was NOT NULL in migration 004. Batch 2 matrices may target
-- request_type/document_type_id without a legacy document_type string.
ALTER TABLE approval_matrix
  MODIFY COLUMN document_type VARCHAR(80) NULL;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='matrix_key');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN matrix_key VARCHAR(120) NULL AFTER id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='matrix_name');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN matrix_name VARCHAR(190) NULL AFTER matrix_key',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='document_type_id');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN document_type_id INT UNSIGNED NULL AFTER document_type',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='request_type');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN request_type VARCHAR(80) NULL AFTER document_type_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='order_index');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN order_index INT NOT NULL DEFAULT 1 AFTER level',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='amount_min');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN amount_min DECIMAL(18,2) NULL AFTER is_required',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='amount_max');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN amount_max DECIMAL(18,2) NULL AFTER amount_min',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='currency');
SET @s := IF(@c=0,
  "ALTER TABLE approval_matrix ADD COLUMN currency VARCHAR(8) NULL DEFAULT 'IDR' AFTER amount_max",
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='flow_type');
SET @s := IF(@c=0,
  "ALTER TABLE approval_matrix ADD COLUMN flow_type VARCHAR(20) NOT NULL DEFAULT 'sequential' AFTER currency",
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='parallel_group');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN parallel_group VARCHAR(40) NULL AFTER flow_type',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='is_optional');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN is_optional TINYINT(1) NOT NULL DEFAULT 0 AFTER parallel_group',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='priority');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN priority INT NOT NULL DEFAULT 100 AFTER is_optional',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Optional signer target attached to the resolved matrix chain.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='signer_user_id');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN signer_user_id INT UNSIGNED NULL AFTER priority',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='signer_role_id');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN signer_role_id INT UNSIGNED NULL AFTER signer_user_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='escalation_user_id');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN escalation_user_id INT UNSIGNED NULL AFTER signer_role_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='escalation_role_id');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN escalation_role_id INT UNSIGNED NULL AFTER escalation_user_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='reminder_after_hours');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN reminder_after_hours INT UNSIGNED NULL AFTER escalation_role_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='escalate_after_hours');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN escalate_after_hours INT UNSIGNED NULL AFTER reminder_after_hours',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='is_active');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER escalate_after_hours',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='created_by');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN created_by INT UNSIGNED NULL AFTER is_active',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='updated_at');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND COLUMN_NAME='deleted_at');
SET @s := IF(@c=0,
  'ALTER TABLE approval_matrix ADD COLUMN deleted_at TIMESTAMP NULL AFTER updated_at',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill legacy rows as deterministic grouped sequential matrices.
-- Existing rows receive DEFAULT 1 when order_index is added, so copy level
-- before assigning matrix_key to preserve their original ordering.
UPDATE approval_matrix
SET order_index = level
WHERE matrix_key IS NULL;

UPDATE approval_matrix
SET matrix_key = COALESCE(
      matrix_key,
      CONCAT(
        'legacy:', entity_id, ':',
        COALESCE(department_id, 0), ':',
        REPLACE(LOWER(document_type), ' ', '-')
      )
    ),
    matrix_name = COALESCE(matrix_name, CONCAT('Legacy ', document_type)),
    flow_type = COALESCE(NULLIF(flow_type, ''), 'sequential')
WHERE matrix_key IS NULL OR matrix_name IS NULL;

-- Advanced lookup index.
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_matrix' AND INDEX_NAME='idx_matrix_advanced');
SET @s := IF(@c=0,
  'CREATE INDEX idx_matrix_advanced ON approval_matrix (entity_id, department_id, request_type, document_type_id, is_active, priority)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- approval_requests
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_requests' AND COLUMN_NAME='request_type');
SET @s := IF(@c=0,
  'ALTER TABLE approval_requests ADD COLUMN request_type VARCHAR(80) NULL AFTER subject_type',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_requests' AND COLUMN_NAME='document_type_id');
SET @s := IF(@c=0,
  'ALTER TABLE approval_requests ADD COLUMN document_type_id INT UNSIGNED NULL AFTER request_type',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_requests' AND COLUMN_NAME='amount');
SET @s := IF(@c=0,
  'ALTER TABLE approval_requests ADD COLUMN amount DECIMAL(18,2) NULL AFTER document_type_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_requests' AND COLUMN_NAME='currency');
SET @s := IF(@c=0,
  "ALTER TABLE approval_requests ADD COLUMN currency VARCHAR(8) NULL DEFAULT 'IDR' AFTER amount",
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_requests' AND COLUMN_NAME='flow_type');
SET @s := IF(@c=0,
  "ALTER TABLE approval_requests ADD COLUMN flow_type VARCHAR(20) NOT NULL DEFAULT 'legacy' AFTER currency",
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_requests' AND COLUMN_NAME='matrix_key');
SET @s := IF(@c=0,
  'ALTER TABLE approval_requests ADD COLUMN matrix_key VARCHAR(120) NULL AFTER flow_type',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_requests' AND COLUMN_NAME='matrix_rule_ids');
SET @s := IF(@c=0,
  'ALTER TABLE approval_requests ADD COLUMN matrix_rule_ids JSON NULL AFTER matrix_key',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- approval_steps
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_steps' AND COLUMN_NAME='matrix_rule_id');
SET @s := IF(@c=0,
  'ALTER TABLE approval_steps ADD COLUMN matrix_rule_id INT UNSIGNED NULL AFTER approval_request_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_steps' AND COLUMN_NAME='order_index');
SET @s := IF(@c=0,
  'ALTER TABLE approval_steps ADD COLUMN order_index INT NOT NULL DEFAULT 1 AFTER level',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_steps' AND COLUMN_NAME='parallel_group');
SET @s := IF(@c=0,
  'ALTER TABLE approval_steps ADD COLUMN parallel_group VARCHAR(40) NULL AFTER order_index',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_steps' AND COLUMN_NAME='is_optional');
SET @s := IF(@c=0,
  'ALTER TABLE approval_steps ADD COLUMN is_optional TINYINT(1) NOT NULL DEFAULT 0 AFTER parallel_group',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_steps' AND COLUMN_NAME='delegated_from_user_id');
SET @s := IF(@c=0,
  'ALTER TABLE approval_steps ADD COLUMN delegated_from_user_id INT UNSIGNED NULL AFTER is_optional',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_steps' AND COLUMN_NAME='activated_at');
SET @s := IF(@c=0,
  'ALTER TABLE approval_steps ADD COLUMN activated_at TIMESTAMP NULL AFTER delegated_from_user_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_steps' AND COLUMN_NAME='deadline_at');
SET @s := IF(@c=0,
  'ALTER TABLE approval_steps ADD COLUMN deadline_at TIMESTAMP NULL AFTER activated_at',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_steps' AND COLUMN_NAME='escalated_at');
SET @s := IF(@c=0,
  'ALTER TABLE approval_steps ADD COLUMN escalated_at TIMESTAMP NULL AFTER deadline_at',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_steps' AND COLUMN_NAME='escalated_to_user_id');
SET @s := IF(@c=0,
  'ALTER TABLE approval_steps ADD COLUMN escalated_to_user_id INT UNSIGNED NULL AFTER escalated_at',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='approval_steps' AND COLUMN_NAME='escalated_to_role_id');
SET @s := IF(@c=0,
  'ALTER TABLE approval_steps ADD COLUMN escalated_to_role_id INT UNSIGNED NULL AFTER escalated_to_user_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE approval_steps s
JOIN approval_requests ar ON ar.id=s.approval_request_id
SET s.order_index = CASE
      WHEN s.matrix_rule_id IS NULL THEN s.level
      ELSE s.order_index
    END,
    s.activated_at = CASE
      WHEN s.level <= ar.current_level THEN COALESCE(s.activated_at, s.created_at)
      ELSE s.activated_at
    END;

-- New table: approval_delegations
CREATE TABLE IF NOT EXISTS approval_delegations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  from_user_id INT UNSIGNED NOT NULL,
  to_user_id INT UNSIGNED NOT NULL,
  applies_to_request_type VARCHAR(80) NULL,
  applies_to_document_type_id INT UNSIGNED NULL,
  starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at TIMESTAMP NOT NULL,
  reason VARCHAR(500) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  INDEX idx_deleg_entity_active (entity_id, is_active),
  INDEX idx_deleg_from_window (from_user_id, starts_at, ends_at),
  INDEX idx_deleg_to_window (to_user_id, starts_at, ends_at),
  CONSTRAINT fk_deleg_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_deleg_from FOREIGN KEY (from_user_id) REFERENCES users(id),
  CONSTRAINT fk_deleg_to FOREIGN KEY (to_user_id) REFERENCES users(id),
  CONSTRAINT fk_deleg_doctype FOREIGN KEY (applies_to_document_type_id)
    REFERENCES document_types(id) ON DELETE SET NULL,
  CONSTRAINT fk_deleg_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- New table: approval_reminders
CREATE TABLE IF NOT EXISTS approval_reminders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  approval_request_id INT UNSIGNED NOT NULL,
  approval_step_id INT UNSIGNED NULL,
  reminder_type VARCHAR(30) NOT NULL,
  target_user_id INT UNSIGNED NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notification_id BIGINT UNSIGNED NULL,
  notes VARCHAR(500) NULL,
  UNIQUE KEY uq_approval_reminder_once
    (approval_step_id, reminder_type, target_user_id),
  INDEX idx_reminder_request (approval_request_id, sent_at),
  CONSTRAINT fk_reminder_request FOREIGN KEY (approval_request_id)
    REFERENCES approval_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_reminder_step FOREIGN KEY (approval_step_id)
    REFERENCES approval_steps(id) ON DELETE SET NULL,
  CONSTRAINT fk_reminder_target FOREIGN KEY (target_user_id)
    REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_reminder_notification FOREIGN KEY (notification_id)
    REFERENCES notifications(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- New table: approval_audit_log
CREATE TABLE IF NOT EXISTS approval_audit_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NULL,
  actor_user_id INT UNSIGNED NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id_ref INT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_entity_type (entity_type, entity_id_ref),
  INDEX idx_audit_actor (actor_user_id, created_at),
  CONSTRAINT fk_approval_audit_entity FOREIGN KEY (entity_id)
    REFERENCES entities(id) ON DELETE SET NULL,
  CONSTRAINT fk_approval_audit_actor FOREIGN KEY (actor_user_id)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
