-- ============================================================
-- Migration 042 — Workspace Sync staging area
-- Google Workspace member data can't be turned straight into Prakasa
-- Workspace accounts (job title/department aren't reliably filled in on the
-- Google side, so division + role level can't be inferred safely). This
-- table holds what a "fetch" pulled from the Admin Directory API, pending an
-- admin manually assigning department + role before it's actually applied —
-- the fetch step never writes to `users` directly.
-- Additive only.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS workspace_sync_candidates (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_id INT UNSIGNED NOT NULL,
  email VARCHAR(190) NOT NULL,
  name VARCHAR(150) NOT NULL,
  org_unit_path VARCHAR(190) NULL,
  google_is_admin TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('pending','dismissed','applied') NOT NULL DEFAULT 'pending',
  department_id INT UNSIGNED NULL,
  role_id INT UNSIGNED NULL,
  applied_user_id INT UNSIGNED NULL,
  reviewed_by INT UNSIGNED NULL,
  reviewed_at TIMESTAMP NULL,
  fetched_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_wsc_entity_email (entity_id, email),
  KEY idx_wsc_status (entity_id, status),
  CONSTRAINT fk_wsc_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_wsc_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  CONSTRAINT fk_wsc_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL,
  CONSTRAINT fk_wsc_applied_user FOREIGN KEY (applied_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_wsc_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
