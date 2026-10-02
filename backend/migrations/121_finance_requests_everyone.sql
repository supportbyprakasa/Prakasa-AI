-- Pengajuan pembayaran & reimbursement are raised by every division (owner,
-- 1 Oct 2026: Finance module revived). Mirrors COMMON_MEMBER and the
-- Management Office supervisor set in src/config/standardOrganization.js:
--   finance.request → every standard division role (member and up);
--   finance.view    → Management Office supervisor/head (oversight of all
--                     requests and the Finance rupiah KPIs).
-- Grants only; no data changes.
SET NAMES utf8mb4;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'finance.request'
 WHERE r.deleted_at IS NULL AND r.is_system_template = 1 AND r.role_level IN ('member', 'supervisor', 'head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'finance.view'
 WHERE r.deleted_at IS NULL AND r.role_key IN ('management_office.supervisor', 'management_office.head');
