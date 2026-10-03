-- ============================================================
-- Migration 034 — AI conversation pins and message edits
-- Additive and idempotent. Editing a message never deletes rows: the edited
-- message and every later message are hidden (deleted_at) and kept for audit.
-- ============================================================
SET NAMES utf8mb4;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ai_messages' AND COLUMN_NAME='edited_from_message_id');
SET @s := IF(@c=0,
  'ALTER TABLE ai_messages ADD COLUMN edited_from_message_id BIGINT UNSIGNED NULL AFTER reply_to_message_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ai_messages' AND COLUMN_NAME='deleted_at');
SET @s := IF(@c=0,
  'ALTER TABLE ai_messages ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER created_at',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ai_messages' AND COLUMN_NAME='deleted_by');
SET @s := IF(@c=0,
  'ALTER TABLE ai_messages ADD COLUMN deleted_by INT UNSIGNED NULL AFTER deleted_at',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ai_messages' AND INDEX_NAME='idx_aim_session_live');
SET @s := IF(@c=0,
  'CREATE INDEX idx_aim_session_live ON ai_messages (session_id, deleted_at, id)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='ai_messages' AND CONSTRAINT_NAME='fk_aim_edited_from');
SET @s := IF(@c=0,
  'ALTER TABLE ai_messages ADD CONSTRAINT fk_aim_edited_from FOREIGN KEY (edited_from_message_id) REFERENCES ai_messages(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Pins are personal: each user pins the conversations they care about.
CREATE TABLE IF NOT EXISTS ai_session_pins (
  user_id INT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NOT NULL,
  pinned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, session_id),
  KEY idx_asp_session (session_id),
  CONSTRAINT fk_asp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_asp_session FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
