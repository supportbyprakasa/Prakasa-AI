-- ============================================================
-- Migration 037 — IT lives under People & Culture; Operations has no
-- standard modules yet (shows as "coming soon" in the UI).
-- Rerunnable. Touches only the 27 standard division templates and only the
-- permission codes listed here, matching standardOrganization.js.
-- ============================================================
SET NAMES utf8mb4;

-- Remove IT/automation/workflow permissions from Operations at every level.
DELETE rp FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN departments d ON d.id = r.department_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.is_system_template = 1 AND d.code = 'operations'
  AND p.code IN (
    'it.dashboard.view', 'device.view', 'subscription.view',
    'device.manage', 'device.assign', 'device.handover.manage',
    'device.log.manage', 'subscription.manage', 'subscription.renewal.request',
    'automation.view',
    'software_vendor.manage', 'subscription.license.manage',
    'subscription.invoice.manage', 'subscription.renewal.decide',
    'subscription.payment.manage', 'automation.manage',
    'workflow_definition.view', 'workflow_definition.manage'
  );

-- Grant the same set to People & Culture, at the matching level.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN departments d ON d.id = r.department_id
JOIN permissions p ON p.code IN ('it.dashboard.view', 'device.view', 'subscription.view')
WHERE r.is_system_template = 1 AND d.code = 'people_culture'
  AND r.role_level IN ('member', 'supervisor', 'head') AND r.deleted_at IS NULL;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN departments d ON d.id = r.department_id
JOIN permissions p ON p.code IN (
  'device.manage', 'device.assign', 'device.handover.manage',
  'device.log.manage', 'subscription.manage', 'subscription.renewal.request',
  'automation.view'
)
WHERE r.is_system_template = 1 AND d.code = 'people_culture'
  AND r.role_level IN ('supervisor', 'head') AND r.deleted_at IS NULL;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN departments d ON d.id = r.department_id
JOIN permissions p ON p.code IN (
  'software_vendor.manage', 'subscription.license.manage',
  'subscription.invoice.manage', 'subscription.renewal.decide',
  'subscription.payment.manage', 'automation.manage',
  'workflow_definition.view', 'workflow_definition.manage'
)
WHERE r.is_system_template = 1 AND d.code = 'people_culture'
  AND r.role_level = 'head' AND r.deleted_at IS NULL;

-- Coming-soon placeholder cards for divisions with no standard modules yet.
-- Each view permission only gates that one placeholder card — nothing sensitive.
INSERT IGNORE INTO permissions (code, description) VALUES
('workspace.operations.view', 'Lihat halaman workspace Operations (coming soon)'),
('workspace.procurement.view', 'Lihat halaman workspace Procurement (coming soon)'),
('workspace.management_office.view', 'Lihat halaman workspace Management Office (coming soon)'),
('workspace.retail_commerce.view', 'Lihat halaman workspace Retail Commerce (coming soon)'),
('workspace.marketing.view', 'Lihat halaman workspace Marketing (coming soon)');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN departments d ON d.id = r.department_id
JOIN permissions p ON p.code = CONCAT('workspace.', d.code, '.view')
WHERE r.is_system_template = 1
  AND d.code IN ('operations', 'procurement', 'management_office', 'retail_commerce', 'marketing')
  AND r.role_level IN ('member', 'supervisor', 'head') AND r.deleted_at IS NULL;

-- Super Admin can preview every coming-soon placeholder too.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN (
  'workspace.operations.view', 'workspace.procurement.view',
  'workspace.management_office.view', 'workspace.retail_commerce.view', 'workspace.marketing.view'
)
WHERE LOWER(r.name) IN ('super admin', 'superadmin') AND r.deleted_at IS NULL;
