-- ============================================================
-- Migration 029 — AI provider settings managed from the web app
-- Additive only: widens an ENUM, adds a table and a permission.
-- ============================================================

ALTER TABLE ai_module_contexts
  MODIFY COLUMN provider ENUM('openai','gemini','claude','n8n','claude_team') NOT NULL;

CREATE TABLE IF NOT EXISTS ai_provider_settings (
  provider VARCHAR(40) NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  config JSON NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ai_provider_settings_user
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO permissions (code, description) VALUES
('ai.provider.manage','Kelola pengaturan provider AI (Claude Team) — khusus Super Admin');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'ai.provider.manage'
WHERE LOWER(r.name) IN ('super admin','superadmin')
  AND r.deleted_at IS NULL;
