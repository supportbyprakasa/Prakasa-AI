-- ============================================================
-- Migration 028 — Search & Notification Center Hardening
-- Idempotent. Additive only. No drops. No column modifications.
-- ============================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- A. notifications.deleted_at
-- ------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'deleted_at');
SET @s := IF(@c = 0,
  'ALTER TABLE notifications ADD COLUMN deleted_at TIMESTAMP NULL AFTER read_at',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- B. Notification indexes (idempotent via information_schema check)
-- ------------------------------------------------------------

-- idx_notif_user_read_created
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications'
    AND INDEX_NAME = 'idx_notif_user_read_created');
SET @s := IF(@c = 0,
  'ALTER TABLE notifications ADD INDEX idx_notif_user_read_created (user_id, is_read, created_at)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- idx_notif_user_event_created
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications'
    AND INDEX_NAME = 'idx_notif_user_event_created');
SET @s := IF(@c = 0,
  'ALTER TABLE notifications ADD INDEX idx_notif_user_event_created (user_id, event, created_at)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- idx_notif_user_subject
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications'
    AND INDEX_NAME = 'idx_notif_user_subject');
SET @s := IF(@c = 0,
  'ALTER TABLE notifications ADD INDEX idx_notif_user_subject (user_id, subject_type, subject_id)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- C. Search-relevant indexes (safe, only added if missing)
-- ------------------------------------------------------------

-- documents: entity + title
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents' AND INDEX_NAME = 'idx_docs_entity_title');
SET @s := IF(@c = 0,
  'ALTER TABLE documents ADD INDEX idx_docs_entity_title (entity_id, title)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- tasks: entity + title
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND INDEX_NAME = 'idx_tasks_entity_title');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD INDEX idx_tasks_entity_title (entity_id, title)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;