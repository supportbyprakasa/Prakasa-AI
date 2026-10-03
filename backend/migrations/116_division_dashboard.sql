-- Dashboard divisi (owner, 1 Oct 2026: "setiap divisi saya mau ada
-- dashboardnya, dan jangan lupa ada motion chartnya"). One page per division
-- built from the management providers: headline figures, 12-month trends with
-- targets, a motion chart, and the division's escalations.
--
-- division_dashboard.view: Supervisor and Head of every division (their own
-- division), and Super Admin. Management Office (management_dashboard.view)
-- sees every division and the whole company. Members keep their personal
-- Dashboard. Mirrors COMMON_SUPERVISOR in src/config/standardOrganization.js.
-- Permissions only; no data changes.
SET NAMES utf8mb4;

INSERT IGNORE INTO permissions (code, description) VALUES
('division_dashboard.view', 'Lihat dashboard divisi sendiri: angka utama, tren 12 bulan, motion chart, dan eskalasi divisi');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'division_dashboard.view'
 WHERE r.deleted_at IS NULL AND r.is_system_template = 1
   AND (r.role_level IN ('supervisor', 'head') OR r.role_key = 'system.super_admin');
