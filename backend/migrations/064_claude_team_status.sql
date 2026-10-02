-- ============================================================
-- Migration 064 — Claude Team health, so Prakasa AI stays usable on one seat
--
-- Owner's decision (2026-09-29): Prakasa AI keeps running on Claude Team (one
-- seat, this Mac first, a VPS later). The CLI reports the seat's usage window
-- on every answer (status allowed / allowed_warning / rejected, utilization,
-- reset time) and its login can lapse. This row keeps the latest of both per
-- account, so a limit is respected without spawning the CLI again, the Super
-- Admin sees it, and warnings are sent once per window.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS ai_claude_team_status (
  account_key      VARCHAR(40) NOT NULL PRIMARY KEY,
  rate_status      VARCHAR(30) NULL,
  rate_type        VARCHAR(30) NULL,
  utilization      DECIMAL(5,4) NULL,
  resets_at        DATETIME NULL,
  cooldown_until   DATETIME NULL,
  logged_in        TINYINT(1) NULL,
  last_check_at    DATETIME NULL,
  last_error       VARCHAR(255) NULL,
  warned_window    VARCHAR(60) NULL,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
