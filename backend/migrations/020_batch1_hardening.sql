-- ============================================================
-- Migration 020 — Batch 1 hardening / forward compatibility
-- Safe for environments that already executed early 017-019.
-- ============================================================
SET NAMES utf8mb4;

-- form_fields.deleted_at was added during Batch 1 hardening after the first
-- draft of migration 017. Add it only when missing.
SET @has_form_fields_deleted_at := (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'form_fields'
     AND COLUMN_NAME = 'deleted_at'
);
SET @sql := IF(
  @has_form_fields_deleted_at = 0,
  'ALTER TABLE form_fields ADD COLUMN deleted_at TIMESTAMP NULL AFTER updated_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Workflow status codes support configurable values up to workflow_statuses.code.
ALTER TABLE form_submissions
  MODIFY COLUMN status VARCHAR(80) NOT NULL DEFAULT 'draft';

-- New form submissions that use the seeded simple-approval workflow begin in
-- "submitted". Existing workflow instances are left untouched.
UPDATE workflow_statuses ws
JOIN workflow_definitions wd ON wd.id = ws.workflow_definition_id
SET ws.is_initial = CASE WHEN ws.code = 'submitted' THEN 1 ELSE 0 END
WHERE wd.slug = 'simple-approval'
  AND wd.deleted_at IS NULL
  AND ws.code IN ('draft', 'submitted');

-- Keep deterministic display order for seeded simple-approval workflows.
UPDATE workflow_statuses ws
JOIN workflow_definitions wd ON wd.id = ws.workflow_definition_id
SET ws.order_index = CASE ws.code
  WHEN 'submitted' THEN 1
  WHEN 'under_review' THEN 2
  WHEN 'approved' THEN 3
  WHEN 'rejected' THEN 4
  ELSE ws.order_index
END
WHERE wd.slug = 'simple-approval'
  AND wd.deleted_at IS NULL
  AND ws.code IN ('submitted','under_review','approved','rejected');
