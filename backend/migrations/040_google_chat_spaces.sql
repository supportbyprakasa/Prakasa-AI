-- ============================================================
-- Migration 040 — Google Chat Spaces for Task Boards
-- Every board gets an auto-provisioned Google Chat Space; messages in that
-- Space can be converted into tasks on the same board. Chat/Meetings' own
-- tables (chat_rooms, chat_messages, meetings, ...) are left untouched —
-- the app stops reading/writing them, but nothing here drops them.
-- Additive only.
-- ============================================================
SET NAMES utf8mb4;

ALTER TABLE boards
  ADD COLUMN google_chat_space_name VARCHAR(190) NULL,
  ADD COLUMN google_chat_space_url VARCHAR(500) NULL;

ALTER TABLE tasks
  ADD COLUMN source_external_ref VARCHAR(190) NULL;

CREATE TABLE IF NOT EXISTS chat_task_links (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  board_id INT UNSIGNED NOT NULL,
  chat_message_name VARCHAR(190) NOT NULL,
  task_id INT UNSIGNED NOT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_chat_task_links_message (board_id, chat_message_name),
  KEY idx_chat_task_links_task (task_id),
  CONSTRAINT fk_chat_task_links_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_task_links_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_task_links_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
