-- ============================================================
-- Migration 062 — Prakasa AI agent: the steps behind an answer
--
-- The agent (Tahap 0 of docs/prakasa-ai-rencana.md) may call Prakasa tools
-- while answering. Every call is kept with the answer it produced, so the
-- conversation shows what the AI read ("Membaca notifikasi Anda") and the
-- trail can be audited later. Inputs are summarised, never stored in full.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS ai_message_steps (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id      BIGINT UNSIGNED NOT NULL,
  message_id      BIGINT UNSIGNED NOT NULL,
  seq             INT NOT NULL,
  tool            VARCHAR(120) NOT NULL,
  label           VARCHAR(160) NOT NULL,
  target          VARCHAR(255) NULL,
  status          ENUM('ok','error','running') NOT NULL DEFAULT 'ok',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ai_message_steps_message (message_id, seq),
  KEY idx_ai_message_steps_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
