-- ============================================================
-- Migration 041 — Cap Surat (letterhead) per division
-- One letterhead/stamp image per department, shared by everyone in that
-- division (unlike a personal signature) — uploaded/replaced only by that
-- division's Head or Super Admin. Encrypted at rest the same way
-- signature_assets already is (AES-256-GCM via signature.service.js).
-- Additive only.
-- ============================================================
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS letterhead_assets (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_id INT UNSIGNED NOT NULL,
  department_id INT UNSIGNED NOT NULL,
  encrypted_blob MEDIUMBLOB NOT NULL,
  iv VARCHAR(64) NOT NULL,
  auth_tag VARCHAR(64) NOT NULL,
  mime_type VARCHAR(80) NOT NULL DEFAULT 'image/png',
  uploaded_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_letterhead_department (department_id),
  KEY idx_letterhead_entity (entity_id),
  CONSTRAINT fk_letterhead_entity FOREIGN KEY (entity_id) REFERENCES entities(id),
  CONSTRAINT fk_letterhead_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  CONSTRAINT fk_letterhead_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO permissions (code, description) VALUES
('letterhead.view','Lihat/pakai cap surat (letterhead) divisi'),
('letterhead.manage','Upload/ganti cap surat (letterhead) divisi');

-- Every standard role can use the division's letterhead.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'letterhead.view'
WHERE r.is_system_template = 1
  AND r.role_level IN ('member','supervisor','head')
  AND r.deleted_at IS NULL;

-- Only the division's Head manages (uploads/replaces) it.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'letterhead.manage'
WHERE r.is_system_template = 1
  AND r.role_level = 'head'
  AND r.deleted_at IS NULL;

-- Super Admin gets both.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('letterhead.view','letterhead.manage')
WHERE r.role_key = 'system.super_admin' AND r.deleted_at IS NULL;
