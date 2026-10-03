-- ============================================================
-- Migration 036 — Multi-account Claude Team + per-division AI routing
-- Additive only. Replaces the old claude_team allow-list (allowedEmails /
-- allowedDepartmentIds) with: named Claude Team accounts, a global default
-- engine, and an optional per-division override. Every active user now gets
-- an engine by default; nobody is blocked outright anymore.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_claude_team_accounts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  label VARCHAR(120) NOT NULL,
  mode ENUM('cli','gateway') NOT NULL DEFAULT 'cli',
  gateway_url VARCHAR(500) NULL,
  gateway_secret VARCHAR(255) NULL,
  model VARCHAR(80) NOT NULL DEFAULT 'sonnet',
  web_research TINYINT(1) NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by INT UNSIGNED NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_ai_claude_team_accounts_user
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Carry the existing single-account settings forward as "Akun Utama" so nothing
-- breaks: same model/web-research/enabled, mode='cli' (today's direct CLI login).
INSERT INTO ai_claude_team_accounts (label, mode, model, web_research, enabled, updated_by)
SELECT
  'Akun Utama',
  'cli',
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(config, '$.model')), 'sonnet'),
  COALESCE(JSON_EXTRACT(config, '$.webResearch') = true, 0),
  enabled,
  updated_by
FROM ai_provider_settings
WHERE provider = 'claude_team'
  AND NOT EXISTS (SELECT 1 FROM ai_claude_team_accounts);

-- If claude_team had no row yet (fresh install), seed a disabled default account
-- so the routing tables below always have something to point at.
INSERT INTO ai_claude_team_accounts (label, mode, model, web_research, enabled)
SELECT 'Akun Utama', 'cli', 'sonnet', 0, 0
WHERE NOT EXISTS (SELECT 1 FROM ai_claude_team_accounts);

CREATE TABLE IF NOT EXISTS ai_routing_settings (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  default_provider VARCHAR(40) NOT NULL DEFAULT 'claude_team',
  default_claude_team_account_id INT UNSIGNED NULL,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by INT UNSIGNED NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_ai_routing_settings_singleton CHECK (id = 1),
  CONSTRAINT fk_ai_routing_settings_account
    FOREIGN KEY (default_claude_team_account_id) REFERENCES ai_claude_team_accounts(id) ON DELETE SET NULL,
  CONSTRAINT fk_ai_routing_settings_user
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO ai_routing_settings (id, default_provider, default_claude_team_account_id)
SELECT 1, 'claude_team', (SELECT id FROM ai_claude_team_accounts ORDER BY id LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM ai_routing_settings WHERE id = 1);

CREATE TABLE IF NOT EXISTS ai_division_assignments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  department_id INT UNSIGNED NOT NULL,
  provider VARCHAR(40) NOT NULL,
  claude_team_account_id INT UNSIGNED NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by INT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_division_assignments_department (department_id),
  CONSTRAINT fk_ai_division_assignments_department
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_division_assignments_account
    FOREIGN KEY (claude_team_account_id) REFERENCES ai_claude_team_accounts(id) ON DELETE SET NULL,
  CONSTRAINT fk_ai_division_assignments_user
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- openai/gemini/claude/n8n become manageable from the database instead of only
-- from server .env; seed disabled rows so the settings screen always has one
-- consistent record per provider to read and update.
INSERT IGNORE INTO ai_provider_settings (provider, enabled, config) VALUES
('openai', 0, JSON_OBJECT('apiKey', NULL, 'model', 'gpt-4o-mini')),
('gemini', 0, JSON_OBJECT('apiKey', NULL, 'model', 'gemini-1.5-flash')),
('claude', 0, JSON_OBJECT('apiKey', NULL, 'model', 'claude-sonnet-4-5')),
('n8n', 0, JSON_OBJECT('gatewayUrl', NULL, 'gatewaySecret', NULL));

INSERT IGNORE INTO permissions (code, description) VALUES
('ai.provider.manage', 'Kelola pengaturan provider AI dan akun Claude Team — khusus Super Admin'),
('ai.routing.manage', 'Kelola engine AI default dan penetapan engine per divisi — khusus Super Admin');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'ai.routing.manage'
WHERE LOWER(r.name) IN ('super admin','superadmin')
  AND r.deleted_at IS NULL;
