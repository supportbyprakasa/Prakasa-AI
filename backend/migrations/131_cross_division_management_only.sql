-- Cross-division view is for the Management Office and the Super Admin only
-- (owner rule: data is scoped per division; management sees across). Migration
-- 032 also granted workspace.cross_division.view to every Supervisor and Head
-- of every division, which let a Sales Head read Finance's tasks, boards,
-- approvals, documents and division storage (final security audit, 1 Oct
-- 2026). This revokes that one grant from every role except management_office.*
-- and system.super_admin. Permission grants only; no business data. Idempotent.
SET NAMES utf8mb4;

DELETE rp
  FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  JOIN permissions p ON p.id = rp.permission_id
 WHERE p.code = 'workspace.cross_division.view'
   AND r.role_key NOT LIKE 'management\_office.%'
   AND r.role_key <> 'system.super_admin';
