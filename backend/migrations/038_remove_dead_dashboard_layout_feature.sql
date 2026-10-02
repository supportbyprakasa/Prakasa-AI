-- ============================================================
-- Migration 038 — Remove the dead "Dashboard Layouts" feature
-- The admin screen configured per-role widget layouts, but the actual
-- Dashboard page never read dashboard_role_layouts to render anything —
-- confirmed orphaned (zero rows, zero real usage since it shipped).
-- Only revokes the now-unreachable permissions; the empty tables
-- (dashboard_role_layouts, dashboard_widgets) are left in place —
-- no destructive schema changes.
-- ============================================================
SET NAMES utf8mb4;

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN ('dashboard_layout.manage', 'dashboard_widget.manage');
