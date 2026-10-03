-- ============================================================
-- Migration 045 — Project Tracker per Google Chat space
-- A project is a `boards` row linked to a Chat space (google_chat_space_name)
-- with a project_key; issues are `tasks` rows; statuses are `board_columns`
-- with a category. Existing boards/tasks keep working unchanged.
-- Idempotent. Additive only.
-- ============================================================
SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- A. boards
-- ------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'boards' AND COLUMN_NAME = 'project_key');
SET @s := IF(@c = 0,
  'ALTER TABLE boards ADD COLUMN project_key VARCHAR(10) NULL',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'boards' AND COLUMN_NAME = 'issue_seq');
SET @s := IF(@c = 0,
  'ALTER TABLE boards ADD COLUMN issue_seq INT NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'boards' AND COLUMN_NAME = 'post_updates_to_space');
SET @s := IF(@c = 0,
  'ALTER TABLE boards ADD COLUMN post_updates_to_space TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- One live project per (entity, space). Soft-deleted boards keep their space
-- name, so uniqueness is enforced on a generated column that is NULL once the
-- board is deleted (NULLs never collide).
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'boards' AND COLUMN_NAME = 'active_space_name');
SET @s := IF(@c = 0,
  'ALTER TABLE boards ADD COLUMN active_space_name VARCHAR(190) GENERATED ALWAYS AS (IF(deleted_at IS NULL, google_chat_space_name, NULL)) STORED',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'boards' AND INDEX_NAME = 'uq_boards_entity_space');
SET @s := IF(@c = 0,
  'ALTER TABLE boards ADD UNIQUE KEY uq_boards_entity_space (entity_id, active_space_name)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- B. board_columns.category (+ backfill from the column name)
-- ------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'board_columns' AND COLUMN_NAME = 'category');
SET @s := IF(@c = 0,
  'ALTER TABLE board_columns ADD COLUMN category ENUM(''todo'',''in_progress'',''done'') NOT NULL DEFAULT ''todo''',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE board_columns SET category = 'done'
 WHERE category = 'todo'
   AND (LOWER(name) LIKE '%done%' OR LOWER(name) LIKE '%selesai%' OR LOWER(name) LIKE '%complete%');

UPDATE board_columns SET category = 'in_progress'
 WHERE category = 'todo'
   AND (LOWER(name) LIKE '%progress%' OR LOWER(name) LIKE '%review%'
        OR LOWER(name) LIKE '%dikerjakan%' OR LOWER(name) LIKE '%proses%');

-- ------------------------------------------------------------
-- C. tracker_sprints
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracker_sprints (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  board_id INT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  goal VARCHAR(1000) NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  status ENUM('planned','active','completed') NOT NULL DEFAULT 'planned',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  KEY idx_tracker_sprints_board (board_id, status),
  CONSTRAINT fk_tracker_sprints_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
  CONSTRAINT fk_tracker_sprints_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- D. tasks (issues)
-- ------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'issue_number');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD COLUMN issue_number INT NULL',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'issue_type');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD COLUMN issue_type ENUM(''task'',''bug'',''story'',''epic'',''subtask'') NOT NULL DEFAULT ''task''',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'story_points');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD COLUMN story_points DECIMAL(5,1) NULL',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'labels');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD COLUMN labels JSON NULL',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'sprint_id');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD COLUMN sprint_id INT UNSIGNED NULL',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'parent_id');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD COLUMN parent_id INT UNSIGNED NULL',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'assignee_email');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD COLUMN assignee_email VARCHAR(190) NULL',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND INDEX_NAME = 'uq_tasks_board_issue_number');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD UNIQUE KEY uq_tasks_board_issue_number (board_id, issue_number)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND INDEX_NAME = 'idx_tasks_assignee_email');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD INDEX idx_tasks_assignee_email (assignee_email)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND CONSTRAINT_NAME = 'fk_tasks_sprint');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD CONSTRAINT fk_tasks_sprint FOREIGN KEY (sprint_id) REFERENCES tracker_sprints(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND CONSTRAINT_NAME = 'fk_tasks_parent');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD CONSTRAINT fk_tasks_parent FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
