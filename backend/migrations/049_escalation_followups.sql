-- ============================================================
-- Migration 049 — Pusat Eskalasi (escalation centre)
--
-- The escalation queue itself is DERIVED, never stored: it is computed live
-- from issues, approvals and sprints that are past their deadline. Storing a
-- copy would drift the moment the underlying record changes.
--
-- What is stored here is only the human follow-up on one of those breaches:
-- who is handling it, what they noted, and whether it is done. Keyed by
-- (source, source_id) so it survives the row being recomputed.
--
-- (047 is reserved for the module removal migration.)
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS escalation_followups (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_id     INT UNSIGNED NOT NULL,
  source        VARCHAR(32)  NOT NULL COMMENT 'issue_overdue | issue_stale | approval_aged | sprint_overdue',
  source_id     BIGINT UNSIGNED NOT NULL COMMENT 'id of the underlying task / approval_request / sprint',
  status        ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
  owner_user_id INT UNSIGNED NULL,
  note          VARCHAR(1000) NULL,
  updated_by    INT UNSIGNED NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- One follow-up per breach: writes upsert onto this key.
  UNIQUE KEY uq_escalation_source (entity_id, source, source_id),
  KEY idx_escalation_status (entity_id, status),
  CONSTRAINT fk_escalation_entity FOREIGN KEY (entity_id) REFERENCES entities (id),
  CONSTRAINT fk_escalation_owner  FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_escalation_actor  FOREIGN KEY (updated_by)    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
