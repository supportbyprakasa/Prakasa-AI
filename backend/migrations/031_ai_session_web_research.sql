-- ============================================================
-- Migration 031 — Per-conversation web research toggle
-- Additive only. The toggle only takes effect when Super Admin allows web
-- research in the Claude Team provider settings.
-- ============================================================

ALTER TABLE ai_sessions
  ADD COLUMN web_research TINYINT(1) NOT NULL DEFAULT 0 AFTER provider;
