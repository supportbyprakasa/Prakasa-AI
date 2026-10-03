-- ============================================================
-- Migration 046 — keep names of Workspace people after they leave
-- Google anonymises a deleted account everywhere (Chat shows it with no name,
-- and the directory forgets it after ~20 days). google_people remembers every
-- Google account id → email/name we have seen, so DMs with people who left keep
-- their real name. chat_space_aliases lets a user label a conversation whose
-- partner can no longer be identified (private to that user).
-- Additive only.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS google_people (
  google_id VARCHAR(40) NOT NULL,
  email VARCHAR(190) NULL,
  name VARCHAR(190) NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (google_id),
  KEY idx_google_people_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_space_aliases (
  user_id INT UNSIGNED NOT NULL,
  space_name VARCHAR(190) NOT NULL,
  alias VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, space_name),
  CONSTRAINT fk_chat_alias_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
