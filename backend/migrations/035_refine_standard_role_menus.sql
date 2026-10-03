-- ============================================================
-- Migration 035 — Refine standard role defaults to what each division needs
-- Rerunnable. Touches only the 27 standard division templates (never Super Admin
-- or custom roles) and only the permission codes listed here.
-- ============================================================
SET NAMES utf8mb4;

-- Governance: data classification is managed by Heads, not every member.
DELETE rp FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.is_system_template = 1 AND r.role_level IN ('member', 'supervisor')
  AND p.code = 'data_classification.view';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'data_classification.view'
WHERE r.is_system_template = 1 AND r.role_level = 'head' AND r.deleted_at IS NULL;

-- Approval matrix configuration is system administration.
DELETE rp FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.is_system_template = 1 AND r.role_level IN ('member', 'supervisor', 'head')
  AND p.code = 'approval_matrix.view';

-- Customer workspaces only for customer-facing divisions.
DELETE rp FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
JOIN departments d ON d.id = r.department_id
WHERE r.is_system_template = 1 AND r.role_level IN ('member', 'supervisor', 'head')
  AND d.code NOT IN ('sales', 'retail_commerce', 'marketing')
  AND p.code = 'workspace.customer.view';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN departments d ON d.id = r.department_id
JOIN permissions p ON p.code = 'workspace.customer.view'
WHERE r.is_system_template = 1 AND r.role_level IN ('member', 'supervisor', 'head')
  AND d.code IN ('sales', 'retail_commerce', 'marketing') AND r.deleted_at IS NULL;

-- Automation belongs to Operations oversight (Supervisor and Head).
DELETE rp FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.is_system_template = 1 AND r.role_level IN ('member', 'supervisor', 'head')
  AND r.role_key NOT IN ('operations.supervisor', 'operations.head')
  AND p.code = 'automation.view';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'automation.view'
WHERE r.role_key IN ('operations.supervisor', 'operations.head')
  AND r.is_system_template = 1 AND r.deleted_at IS NULL;

-- Procurement and Retail Commerce read Warehouse movements, not the sample queue.
DELETE rp FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
JOIN departments d ON d.id = r.department_id
WHERE r.is_system_template = 1 AND r.role_level IN ('member', 'supervisor', 'head')
  AND d.code IN ('procurement', 'retail_commerce')
  AND p.code = 'warehouse.sample.view';

-- Marketing reads customers; quotations stay with Sales.
DELETE rp FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
JOIN departments d ON d.id = r.department_id
WHERE r.is_system_template = 1 AND r.role_level IN ('member', 'supervisor', 'head')
  AND d.code = 'marketing'
  AND p.code = 'sales.quotation.view';
