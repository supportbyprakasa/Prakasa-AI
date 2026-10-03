-- Administrator Sistem (owner, 1 Oct 2026): a global role tied to no division
-- that runs the system — users, roles, divisions, rules, integrations, AI
-- providers — without reading any division's data. It holds only
-- configuration permissions plus personal tools (own notifications, own IT
-- tickets, own Google apps). Unlike Super Admin it never sees Sales,
-- Warehouse, Procurement, People & Culture, IT assets, management dashboards,
-- activity logs or other people's AI sessions.
-- The list must equal SYSTEM_ADMIN_PERMISSIONS in src/config/standardOrganization.js
-- (checked by test/systemAdminRole.test.js). Adds rows only; nothing existing changes.
SET NAMES utf8mb4;

INSERT INTO roles (entity_id, department_id, name, role_key, role_level, is_system_template)
SELECT e.id, NULL, 'Administrator Sistem', 'system.admin', 'admin', 1
  FROM entities e
 WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.entity_id = e.id AND r.role_key = 'system.admin');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code IN (
    -- System configuration
    'user.manage', 'role.manage', 'permission.manage', 'department.manage', 'entity.manage',
    'approval_matrix.view', 'approval_matrix.manage',
    'signature_rule.view', 'signature_rule.manage',
    'document_type.view', 'document_type.manage', 'folder_rule.manage',
    'notification.manage_rule',
    'integration.accurate.manage', 'integration_log.view',
    'ai.provider.manage', 'ai.config.manage', 'ai.routing.manage',
    -- Personal tools: own notifications, own IT tickets, own Google apps
    'notification.view',
    'it_ticket.create', 'it_ticket.view', 'it_ticket.comment', 'it_ticket.cancel_own',
    'google.mail.use', 'google.chat.use', 'google.docs.use', 'google.groups.view',
    'meeting.view', 'mydrive.view'
  )
 WHERE r.role_key = 'system.admin' AND r.deleted_at IS NULL;
