-- ============================================================
-- Migration 026 — Work Execution Core (Batch 4 Part 1)
-- Idempotent. Additive only. Does NOT modify existing columns
-- destructively. Does NOT drop or rename.
-- ============================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------
-- A. Extend tasks
-- ------------------------------------------------------------

-- start_date
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'start_date');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD COLUMN start_date DATE NULL AFTER due_date',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- progress_percent
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'progress_percent');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD COLUMN progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER start_date',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- completed_by
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'completed_by');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD COLUMN completed_by INT UNSIGNED NULL AFTER completed_at',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index: entity + due + status
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND INDEX_NAME = 'idx_tasks_entity_due_status');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD INDEX idx_tasks_entity_due_status (entity_id, due_date, status)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index: entity + dept + status
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND INDEX_NAME = 'idx_tasks_entity_dept_status');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD INDEX idx_tasks_entity_dept_status (entity_id, department_id, status)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- completed_by FK
SET @c := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tasks'
    AND CONSTRAINT_NAME = 'fk_tasks_completed_by');
SET @s := IF(@c = 0,
  'ALTER TABLE tasks ADD CONSTRAINT fk_tasks_completed_by FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- B. task_watchers
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_watchers (
  task_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, user_id),
  KEY idx_tw_user (user_id),
  CONSTRAINT fk_tw_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_tw_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tw_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- C. task_checklist_items
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_checklist_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id INT UNSIGNED NOT NULL,
  title VARCHAR(500) NOT NULL,
  is_done TINYINT(1) NOT NULL DEFAULT 0,
  position INT NOT NULL DEFAULT 0,
  completed_by INT UNSIGNED NULL,
  completed_at TIMESTAMP NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  KEY idx_tci_task_pos (task_id, position),
  KEY idx_tci_task_done (task_id, is_done),
  CONSTRAINT fk_tci_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_tci_completed_by FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tci_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- D. task_dependencies
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_dependencies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  predecessor_task_id INT UNSIGNED NOT NULL,
  successor_task_id INT UNSIGNED NOT NULL,
  dependency_type ENUM('blocks','related') NOT NULL DEFAULT 'blocks',
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_td_edge (predecessor_task_id, successor_task_id, dependency_type),
  KEY idx_td_pred (predecessor_task_id),
  KEY idx_td_succ (successor_task_id),
  CONSTRAINT fk_td_pred FOREIGN KEY (predecessor_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_td_succ FOREIGN KEY (successor_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_td_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- E. task_activity
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_activity (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id INT UNSIGNED NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  actor_user_id INT UNSIGNED NULL,
  event VARCHAR(80) NOT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ta_task_id (task_id, id),
  KEY idx_ta_entity_time (entity_id, created_at),
  KEY idx_ta_event_time (event, created_at),
  CONSTRAINT fk_ta_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_ta_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_ta_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- F. notifications.dedupe_key
-- ------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'dedupe_key');
SET @s := IF(@c = 0,
  'ALTER TABLE notifications ADD COLUMN dedupe_key VARCHAR(190) NULL AFTER subject_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Unique index: MySQL treats NULLs as distinct, so rows with dedupe_key=NULL
-- are unaffected by the constraint. Dedupe is opt-in per call.
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND INDEX_NAME = 'uq_notif_dedupe');
SET @s := IF(@c = 0,
  'ALTER TABLE notifications ADD UNIQUE KEY uq_notif_dedupe (user_id, event, dedupe_key)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET FOREIGN_KEY_CHECKS = 1;