-- ============================================================
-- Migration 065 — Accurate developer-app credentials, entered in the app
--
-- Owner's decision (2026-09-29): the owner only gives instructions; Claude
-- (in the browser) registers the Accurate developer app and copies its Client
-- ID and Client Secret straight into Administrasi → Integrasi Accurate, so the
-- secret never travels through chat or a file. The secret is kept encrypted
-- (AES-256-GCM, same helper as the tokens) and is never sent back to a browser.
-- backend/.env still wins when ACCURATE_CLIENT_* are set there.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS accurate_app_credentials (
  id               TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  client_id        VARCHAR(200) NOT NULL,
  secret_encrypted VARBINARY(1024) NOT NULL,
  secret_iv        VARCHAR(32) NOT NULL,
  secret_auth_tag  VARCHAR(64) NOT NULL,
  redirect_uri     VARCHAR(500) NOT NULL,
  updated_by       INT UNSIGNED NULL,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_accurate_app_credentials_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
