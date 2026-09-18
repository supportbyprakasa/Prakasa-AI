-- ============================================================
-- Migration 022 — Signature QR Verification + AI Precheck
-- ============================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='signature_rules' AND COLUMN_NAME='qr_required');
SET @s := IF(@c=0,
  'ALTER TABLE signature_rules ADD COLUMN qr_required TINYINT(1) NOT NULL DEFAULT 1 AFTER auto_generate_verification_code',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='signature_rules' AND COLUMN_NAME='checksum_algorithm');
SET @s := IF(@c=0,
  "ALTER TABLE signature_rules ADD COLUMN checksum_algorithm VARCHAR(10) NOT NULL DEFAULT 'sha256' AFTER qr_required",
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='signature_rules' AND COLUMN_NAME='precheck_module');
SET @s := IF(@c=0,
  "ALTER TABLE signature_rules ADD COLUMN precheck_module VARCHAR(80) NULL DEFAULT 'signature_precheck' AFTER checksum_algorithm",
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Keep designated signer separate from the actual signer recorded in signed_by.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='signature_requests' AND COLUMN_NAME='signature_rule_id');
SET @s := IF(@c=0,
  'ALTER TABLE signature_requests ADD COLUMN signature_rule_id INT UNSIGNED NULL AFTER approval_request_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='signature_requests' AND COLUMN_NAME='designated_signer_user_id');
SET @s := IF(@c=0,
  'ALTER TABLE signature_requests ADD COLUMN designated_signer_user_id INT UNSIGNED NULL AFTER signature_type',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='signature_requests' AND COLUMN_NAME='designated_signer_role_id');
SET @s := IF(@c=0,
  'ALTER TABLE signature_requests ADD COLUMN designated_signer_role_id INT UNSIGNED NULL AFTER designated_signer_user_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill legacy pending requests that used signed_by as the designated signer.
UPDATE signature_requests
SET designated_signer_user_id = signed_by,
    signed_by = NULL
WHERE status = 'pending'
  AND signed_by IS NOT NULL
  AND designated_signer_user_id IS NULL;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='document_verifications' AND COLUMN_NAME='verification_url');
SET @s := IF(@c=0,
  'ALTER TABLE document_verifications ADD COLUMN verification_url VARCHAR(500) NULL AFTER verification_code',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='document_verifications' AND COLUMN_NAME='hash_algorithm');
SET @s := IF(@c=0,
  "ALTER TABLE document_verifications ADD COLUMN hash_algorithm VARCHAR(10) NOT NULL DEFAULT 'sha256' AFTER document_hash",
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='document_verifications' AND COLUMN_NAME='metadata_json');
SET @s := IF(@c=0,
  'ALTER TABLE document_verifications ADD COLUMN metadata_json JSON NULL AFTER hash_algorithm',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='document_verifications' AND COLUMN_NAME='qr_generated_at');
SET @s := IF(@c=0,
  'ALTER TABLE document_verifications ADD COLUMN qr_generated_at TIMESTAMP NULL AFTER metadata_json',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Snapshot the resolved signature rule / signer assignment on each request.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='signature_requests' AND COLUMN_NAME='signature_rule_id');
SET @s := IF(@c=0,
  'ALTER TABLE signature_requests ADD COLUMN signature_rule_id INT UNSIGNED NULL AFTER approval_request_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='signature_requests' AND COLUMN_NAME='assigned_signer_user_id');
SET @s := IF(@c=0,
  'ALTER TABLE signature_requests ADD COLUMN assigned_signer_user_id INT UNSIGNED NULL AFTER signature_rule_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='signature_requests' AND COLUMN_NAME='assigned_signer_role_id');
SET @s := IF(@c=0,
  'ALTER TABLE signature_requests ADD COLUMN assigned_signer_role_id INT UNSIGNED NULL AFTER assigned_signer_user_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='signature_requests' AND INDEX_NAME='idx_sig_assigned_user');
SET @s := IF(@c=0,
  'CREATE INDEX idx_sig_assigned_user ON signature_requests (assigned_signer_user_id, status)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill Phase-3 pending requests where signed_by was used as the assigned signer.
UPDATE signature_requests
SET assigned_signer_user_id = signed_by,
    signed_by = NULL
WHERE status = 'pending'
  AND assigned_signer_user_id IS NULL
  AND assigned_signer_role_id IS NULL
  AND signed_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS signature_precheck_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NULL,
  document_id INT UNSIGNED NOT NULL,
  signature_request_id INT UNSIGNED NULL,
  approval_request_id INT UNSIGNED NULL,
  ai_summary_id BIGINT UNSIGNED NULL,
  status VARCHAR(20) NOT NULL,
  summary TEXT NULL,
  findings_json JSON NULL,
  provider VARCHAR(40) NULL,
  model VARCHAR(120) NULL,
  tokens_in INT UNSIGNED NULL,
  tokens_out INT UNSIGNED NULL,
  duration_ms INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_precheck_doc (document_id, created_at),
  INDEX idx_precheck_status (status, created_at),
  INDEX idx_precheck_entity (entity_id, created_at),
  CONSTRAINT fk_precheck_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_precheck_department FOREIGN KEY (department_id)
    REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_precheck_document FOREIGN KEY (document_id)
    REFERENCES documents(id),
  CONSTRAINT fk_precheck_sigreq FOREIGN KEY (signature_request_id)
    REFERENCES signature_requests(id) ON DELETE SET NULL,
  CONSTRAINT fk_precheck_approval FOREIGN KEY (approval_request_id)
    REFERENCES approval_requests(id) ON DELETE SET NULL,
  CONSTRAINT fk_precheck_ai FOREIGN KEY (ai_summary_id)
    REFERENCES ai_summaries(id) ON DELETE SET NULL,
  CONSTRAINT fk_precheck_created_by FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
