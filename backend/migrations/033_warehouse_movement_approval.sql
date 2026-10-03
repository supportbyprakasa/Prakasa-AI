-- ============================================================
-- Migration 033 — Warehouse movement workflow and Supervisor approval
-- Additive and idempotent. Rows that existed before this migration are
-- treated as historical, already-approved movements. No external sync.
-- ============================================================
SET NAMES utf8mb4;

-- warehouse_inbound

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND COLUMN_NAME='status');
SET @historical := (@c = 0);
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT ''approved'' AFTER notes', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
ALTER TABLE warehouse_inbound ALTER COLUMN status SET DEFAULT 'draft';

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND COLUMN_NAME='created_by');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD COLUMN created_by INT UNSIGNED NULL AFTER status', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND COLUMN_NAME='submitted_by');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD COLUMN submitted_by INT UNSIGNED NULL AFTER created_by', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND COLUMN_NAME='submitted_at');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD COLUMN submitted_at TIMESTAMP NULL DEFAULT NULL AFTER submitted_by', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND COLUMN_NAME='approval_request_id');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD COLUMN approval_request_id INT UNSIGNED NULL AFTER submitted_at', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND COLUMN_NAME='approved_by');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD COLUMN approved_by INT UNSIGNED NULL AFTER approval_request_id', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND COLUMN_NAME='approved_at');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD COLUMN approved_at TIMESTAMP NULL DEFAULT NULL AFTER approved_by', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND COLUMN_NAME='rejected_by');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD COLUMN rejected_by INT UNSIGNED NULL AFTER approved_at', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND COLUMN_NAME='rejected_at');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD COLUMN rejected_at TIMESTAMP NULL DEFAULT NULL AFTER rejected_by', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND COLUMN_NAME='decision_note');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD COLUMN decision_note VARCHAR(500) NULL AFTER rejected_at', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND COLUMN_NAME='cancelled_by');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD COLUMN cancelled_by INT UNSIGNED NULL AFTER decision_note', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND COLUMN_NAME='cancelled_at');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD COLUMN cancelled_at TIMESTAMP NULL DEFAULT NULL AFTER cancelled_by', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND COLUMN_NAME='cancellation_reason');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD COLUMN cancellation_reason VARCHAR(500) NULL AFTER cancelled_at', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND COLUMN_NAME='version');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER cancellation_reason', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Historical rows: keep received_by and reuse it as creator/approver only when present.
UPDATE warehouse_inbound
   SET created_by = COALESCE(created_by, received_by),
       approved_by = COALESCE(approved_by, received_by),
       approved_at = COALESCE(approved_at, created_at)
 WHERE @historical = 1 AND status = 'approved' AND received_by IS NOT NULL;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND INDEX_NAME='idx_inbound_scope_status');
SET @s := IF(@c=0, 'CREATE INDEX idx_inbound_scope_status ON warehouse_inbound (entity_id, department_id, status, inbound_date)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND INDEX_NAME='idx_inbound_approval_request');
SET @s := IF(@c=0, 'CREATE INDEX idx_inbound_approval_request ON warehouse_inbound (approval_request_id)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND CONSTRAINT_NAME='fk_inbound_approval_request');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD CONSTRAINT fk_inbound_approval_request FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_inbound' AND CONSTRAINT_NAME='fk_inbound_created_by');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_inbound ADD CONSTRAINT fk_inbound_created_by FOREIGN KEY (created_by) REFERENCES users(id)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- warehouse_outbound

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND COLUMN_NAME='status');
SET @historical := (@c = 0);
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT ''approved'' AFTER notes', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
ALTER TABLE warehouse_outbound ALTER COLUMN status SET DEFAULT 'draft';

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND COLUMN_NAME='created_by');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD COLUMN created_by INT UNSIGNED NULL AFTER status', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND COLUMN_NAME='submitted_by');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD COLUMN submitted_by INT UNSIGNED NULL AFTER created_by', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND COLUMN_NAME='submitted_at');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD COLUMN submitted_at TIMESTAMP NULL DEFAULT NULL AFTER submitted_by', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND COLUMN_NAME='approval_request_id');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD COLUMN approval_request_id INT UNSIGNED NULL AFTER submitted_at', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND COLUMN_NAME='approved_by');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD COLUMN approved_by INT UNSIGNED NULL AFTER approval_request_id', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND COLUMN_NAME='approved_at');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD COLUMN approved_at TIMESTAMP NULL DEFAULT NULL AFTER approved_by', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND COLUMN_NAME='rejected_by');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD COLUMN rejected_by INT UNSIGNED NULL AFTER approved_at', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND COLUMN_NAME='rejected_at');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD COLUMN rejected_at TIMESTAMP NULL DEFAULT NULL AFTER rejected_by', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND COLUMN_NAME='decision_note');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD COLUMN decision_note VARCHAR(500) NULL AFTER rejected_at', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND COLUMN_NAME='cancelled_by');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD COLUMN cancelled_by INT UNSIGNED NULL AFTER decision_note', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND COLUMN_NAME='cancelled_at');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD COLUMN cancelled_at TIMESTAMP NULL DEFAULT NULL AFTER cancelled_by', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND COLUMN_NAME='cancellation_reason');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD COLUMN cancellation_reason VARCHAR(500) NULL AFTER cancelled_at', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND COLUMN_NAME='version');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER cancellation_reason', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Historical rows: keep released_by and reuse it as creator/approver only when present.
UPDATE warehouse_outbound
   SET created_by = COALESCE(created_by, released_by),
       approved_by = COALESCE(approved_by, released_by),
       approved_at = COALESCE(approved_at, created_at)
 WHERE @historical = 1 AND status = 'approved' AND released_by IS NOT NULL;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND INDEX_NAME='idx_outbound_scope_status');
SET @s := IF(@c=0, 'CREATE INDEX idx_outbound_scope_status ON warehouse_outbound (entity_id, department_id, status, outbound_date)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND INDEX_NAME='idx_outbound_approval_request');
SET @s := IF(@c=0, 'CREATE INDEX idx_outbound_approval_request ON warehouse_outbound (approval_request_id)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND CONSTRAINT_NAME='fk_outbound_approval_request');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD CONSTRAINT fk_outbound_approval_request FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='warehouse_outbound' AND CONSTRAINT_NAME='fk_outbound_created_by');
SET @s := IF(@c=0, 'ALTER TABLE warehouse_outbound ADD CONSTRAINT fk_outbound_created_by FOREIGN KEY (created_by) REFERENCES users(id)', 'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Supervisor approval matrix with Warehouse Head as escalation role.
-- Inserted only when no equivalent active rule exists for the request type.
INSERT INTO approval_matrix
  (matrix_key, matrix_name, entity_id, department_id, request_type, level, order_index,
   approver_role_id, escalation_role_id, is_required, currency, flow_type, is_optional,
   priority, reminder_after_hours, escalate_after_hours, is_active)
SELECT seed.matrix_key, seed.matrix_name, d.entity_id, d.id, seed.request_type, 1, 1,
       supervisor.id, head.id, 1, 'IDR', 'sequential', 0,
       50, 8, 24, 1
FROM (
  SELECT 'warehouse_inbound:default' AS matrix_key, 'Warehouse — Barang Masuk' AS matrix_name,
         'warehouse_inbound' AS request_type
  UNION ALL SELECT 'warehouse_outbound:default', 'Warehouse — Barang Keluar', 'warehouse_outbound'
) seed
JOIN departments d ON d.entity_id = 1 AND d.code = 'warehouse' AND d.deleted_at IS NULL
JOIN roles supervisor ON supervisor.entity_id = 1 AND supervisor.role_key = 'warehouse.supervisor' AND supervisor.deleted_at IS NULL
JOIN roles head ON head.entity_id = 1 AND head.role_key = 'warehouse.head' AND head.deleted_at IS NULL
LEFT JOIN approval_matrix existing
  ON existing.entity_id = d.entity_id
 AND existing.request_type = seed.request_type
 AND existing.is_active = 1
 AND existing.deleted_at IS NULL
WHERE existing.id IS NULL;
