-- ============================================================
-- Migration 063 — "Sambungkan Accurate" (OAuth 2.0, read-only)
--
-- One Accurate connection per entity. The Super Admin signs in to Accurate in
-- the browser; the app keeps the tokens encrypted at rest (AES-256-GCM, the
-- same helper as signatures/letterheads) and only ever asks for *_view scopes.
-- The app never writes to Accurate (services/accurate/accurateReadOnly.js).
--
-- OAuth `state` values are single use and live 10 minutes; only their SHA-256
-- is stored, bound to the user and entity that started the sign-in.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS accurate_connections (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_id          INT UNSIGNED NOT NULL,
  status             ENUM('connected','error','disconnected') NOT NULL DEFAULT 'disconnected',
  -- JSON {accessToken, refreshToken} encrypted with AES-256-GCM.
  tokens_encrypted   VARBINARY(8192) NULL,
  tokens_iv          VARCHAR(32) NULL,
  tokens_auth_tag    VARCHAR(64) NULL,
  expires_at         DATETIME NULL,
  granted_scope      VARCHAR(1000) NULL,
  accurate_db_id     VARCHAR(40) NULL,
  accurate_db_alias  VARCHAR(255) NULL,
  connected_by       INT UNSIGNED NULL,
  connected_at       DATETIME NULL,
  last_refreshed_at  DATETIME NULL,
  last_error         VARCHAR(255) NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_accurate_connections_entity (entity_id),
  CONSTRAINT fk_accurate_connections_connected_by FOREIGN KEY (connected_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS accurate_oauth_states (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  state_hash  CHAR(64) NOT NULL,
  entity_id   INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NOT NULL,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_accurate_oauth_states_hash (state_hash),
  KEY idx_accurate_oauth_states_expires (expires_at),
  CONSTRAINT fk_accurate_oauth_states_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (code, description) VALUES
('integration.accurate.manage', 'Sambungkan / putuskan Accurate Online (hanya baca) — khusus Super Admin');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'integration.accurate.manage'
WHERE (r.role_key = 'system.super_admin' OR LOWER(r.name) IN ('super admin','superadmin'))
  AND r.deleted_at IS NULL;
