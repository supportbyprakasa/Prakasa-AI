-- ============================================================
-- Migration 043 — My Drive (personal Google Drive) permissions
-- Every user gets a personal area in Prakasa Workspace to browse and manage
-- their own Google Drive (My Drive), alongside their division's Shared
-- Drive. Unlike documents.* / letterhead.* this is never gated by role level
-- (member/supervisor/head) — it's the user's own personal storage, not a
-- divisional or organizational resource, so everyone gets both permissions.
-- Additive only.
-- ============================================================
SET NAMES utf8mb4;

INSERT IGNORE INTO permissions (code, description) VALUES
('mydrive.view','Lihat file di My Drive (Google Drive pribadi) milik sendiri'),
('mydrive.manage','Unggah, buat folder/file, dan hapus file di My Drive pribadi milik sendiri');

-- Every standard role, at every level, gets both — it's personal storage.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('mydrive.view','mydrive.manage')
WHERE r.is_system_template = 1
  AND r.role_level IN ('member','supervisor','head')
  AND r.deleted_at IS NULL;

-- Super Admin gets both too.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('mydrive.view','mydrive.manage')
WHERE r.role_key = 'system.super_admin' AND r.deleted_at IS NULL;
