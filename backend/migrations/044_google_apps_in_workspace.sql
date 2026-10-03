-- ============================================================
-- Migration 044 — Google apps inside Prakasa Workspace
-- Gmail, Google Chat, Docs/Sheets/Slides and Groups open inside the app for
-- every user (each only ever sees their own mail/chats/files). Google
-- Analytics reports are limited to Marketing, Management Office and Super Admin.
-- Additive only.
-- ============================================================
SET NAMES utf8mb4;

INSERT IGNORE INTO permissions (code, description) VALUES
('google.mail.use','Buka Gmail (kotak masuk sendiri) di dalam Prakasa Workspace'),
('google.chat.use','Buka Google Chat (space & pesan sendiri) di dalam Prakasa Workspace'),
('google.docs.use','Buka dan edit Google Docs/Sheets/Slides di dalam Prakasa Workspace'),
('google.groups.view','Lihat Google Groups dan anggotanya'),
('analytics.view','Lihat laporan Google Analytics');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN ('google.mail.use','google.chat.use','google.docs.use','google.groups.view')
WHERE r.is_system_template = 1 AND r.role_level IN ('member','supervisor','head') AND r.deleted_at IS NULL;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code = 'analytics.view'
WHERE r.deleted_at IS NULL
  AND (r.role_key LIKE 'marketing.%' OR r.role_key LIKE 'management\_office.%');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN ('google.mail.use','google.chat.use','google.docs.use','google.groups.view','analytics.view')
WHERE r.role_key = 'system.super_admin' AND r.deleted_at IS NULL;
