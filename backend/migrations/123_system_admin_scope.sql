-- Administrator Sistem scope (security review, 1 Oct 2026): the Accurate
-- connection and the AI provider, model and routing settings decide where
-- company data comes from and where every prompt is sent, so they are Super
-- Admin only. This revokes those four permission grants from the role
-- system.admin (every entity). Permission grants only; no business data, no
-- other role touched. Idempotent: a second run deletes nothing.
-- SYSTEM_ADMIN_PERMISSIONS (src/config/standardOrganization.js) equals
-- migration 112's list minus these codes (test/systemAdminRole.test.js).
SET NAMES utf8mb4;

DELETE rp
  FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id
  JOIN permissions p ON p.id = rp.permission_id
 WHERE r.role_key = 'system.admin'
   AND p.code IN ('integration.accurate.manage', 'ai.provider.manage', 'ai.routing.manage', 'ai.config.manage');
