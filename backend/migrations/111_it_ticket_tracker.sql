-- IT tickets ↔ Project Tracker (owner, 1 Oct 2026): every new IT ticket becomes
-- an issue in the IT project chosen in Tiket IT → Pengaturan tiket, and is
-- announced in that project's Google Chat Space. One ticket, at most one issue.
-- Schema only; no existing row changes.
SET NAMES utf8mb4;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'it_tickets' AND COLUMN_NAME = 'tracker_issue_id');
SET @s := IF(@c = 0,
  'ALTER TABLE it_tickets ADD COLUMN tracker_issue_id INT UNSIGNED NULL AFTER device_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'it_tickets' AND INDEX_NAME = 'uq_it_tickets_tracker_issue');
SET @s := IF(@c = 0,
  'ALTER TABLE it_tickets ADD UNIQUE KEY uq_it_tickets_tracker_issue (tracker_issue_id)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'it_tickets' AND CONSTRAINT_NAME = 'fk_it_tickets_tracker_issue');
SET @s := IF(@c = 0,
  'ALTER TABLE it_tickets ADD CONSTRAINT fk_it_tickets_tracker_issue FOREIGN KEY (tracker_issue_id) REFERENCES tasks (id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
