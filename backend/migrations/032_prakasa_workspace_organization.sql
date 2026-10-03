-- ============================================================
-- Migration 032 — Prakasa Workspace organization and role defaults
-- Additive and idempotent. Existing users are not assigned new roles.
-- ============================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Department identity
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='departments' AND COLUMN_NAME='code');
SET @s := IF(@c=0,
  'ALTER TABLE departments ADD COLUMN code VARCHAR(80) NULL AFTER name',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Give every historical department a deterministic collision-free code first.
UPDATE departments
SET code = CONCAT('department_', id)
WHERE code IS NULL OR TRIM(code) = '';

-- Promote one matching historical department per entity to each stable code.
UPDATE departments d
JOIN (
  SELECT entity_id, MIN(id) AS department_id,
    CASE LOWER(TRIM(MIN(name)))
      WHEN 'operations' THEN 'operations'
      WHEN 'finance' THEN 'finance'
      WHEN 'procurement' THEN 'procurement'
      WHEN 'sales' THEN 'sales'
      WHEN 'people & culture' THEN 'people_culture'
      WHEN 'management office' THEN 'management_office'
      WHEN 'retail commerce' THEN 'retail_commerce'
      WHEN 'warehouse' THEN 'warehouse'
      WHEN 'marketing' THEN 'marketing'
    END AS stable_code
  FROM departments
  WHERE LOWER(TRIM(name)) IN (
    'operations','finance','procurement','sales','people & culture',
    'management office','retail commerce','warehouse','marketing'
  )
  GROUP BY entity_id, LOWER(TRIM(name))
) canonical ON canonical.department_id = d.id
LEFT JOIN departments conflict
  ON conflict.entity_id = d.entity_id
 AND conflict.code = canonical.stable_code
 AND conflict.id <> d.id
SET d.code = canonical.stable_code
WHERE conflict.id IS NULL
  AND d.code LIKE 'department\_%';

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='departments'
    AND INDEX_NAME='uq_departments_entity_code');
SET @s := IF(@c=0,
  'CREATE UNIQUE INDEX uq_departments_entity_code ON departments (entity_id, code)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Role identity and structural division scope
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='roles' AND COLUMN_NAME='role_key');
SET @s := IF(@c=0,
  'ALTER TABLE roles ADD COLUMN role_key VARCHAR(120) NULL AFTER name',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='roles' AND COLUMN_NAME='department_id');
SET @s := IF(@c=0,
  'ALTER TABLE roles ADD COLUMN department_id INT UNSIGNED NULL AFTER entity_id',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='roles' AND COLUMN_NAME='role_level');
SET @s := IF(@c=0,
  'ALTER TABLE roles ADD COLUMN role_level VARCHAR(20) NULL AFTER role_key',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='roles' AND COLUMN_NAME='is_system_template');
SET @s := IF(@c=0,
  'ALTER TABLE roles ADD COLUMN is_system_template TINYINT(1) NOT NULL DEFAULT 0 AFTER role_level',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE roles r
JOIN (
  SELECT entity_id, MIN(id) AS role_id
  FROM roles
  WHERE LOWER(TRIM(name)) IN ('super admin','superadmin','administrator')
    AND deleted_at IS NULL
  GROUP BY entity_id
) canonical ON canonical.role_id = r.id
SET r.role_key = COALESCE(r.role_key, 'system.super_admin'),
    r.department_id = NULL,
    r.role_level = 'admin',
    r.is_system_template = 1;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='roles'
    AND INDEX_NAME='uq_roles_entity_role_key');
SET @s := IF(@c=0,
  'CREATE UNIQUE INDEX uq_roles_entity_role_key ON roles (entity_id, role_key)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='roles'
    AND INDEX_NAME='idx_roles_department_level');
SET @s := IF(@c=0,
  'CREATE INDEX idx_roles_department_level ON roles (department_id, role_level)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='roles'
    AND CONSTRAINT_NAME='fk_roles_department');
SET @s := IF(@c=0,
  'ALTER TABLE roles ADD CONSTRAINT fk_roles_department FOREIGN KEY (department_id) REFERENCES departments(id)',
  'SELECT 1');
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Nine standard divisions for the default entity.
INSERT IGNORE INTO departments (entity_id, name, code)
SELECT 1, seed.name, seed.code
FROM (
  SELECT 'Operations' AS name, 'operations' AS code
  UNION ALL SELECT 'Finance', 'finance'
  UNION ALL SELECT 'Procurement', 'procurement'
  UNION ALL SELECT 'Sales', 'sales'
  UNION ALL SELECT 'People & Culture', 'people_culture'
  UNION ALL SELECT 'Management Office', 'management_office'
  UNION ALL SELECT 'Retail Commerce', 'retail_commerce'
  UNION ALL SELECT 'Warehouse', 'warehouse'
  UNION ALL SELECT 'Marketing', 'marketing'
) seed
JOIN entities e ON e.id = 1 AND e.deleted_at IS NULL
LEFT JOIN departments existing
  ON existing.entity_id = e.id AND existing.code = seed.code
WHERE existing.id IS NULL;

-- Three standard role templates per division.
INSERT IGNORE INTO roles
  (entity_id, department_id, name, role_key, role_level, is_system_template)
SELECT 1, d.id, seed.name, seed.role_key, seed.role_level, 1
FROM (
  SELECT 'operations' AS department_code, 'Operations Member' AS name,
    'operations.member' AS role_key, 'member' AS role_level
  UNION ALL SELECT 'operations', 'Operations Supervisor', 'operations.supervisor', 'supervisor'
  UNION ALL SELECT 'operations', 'Operations Head', 'operations.head', 'head'
  UNION ALL SELECT 'finance', 'Finance Member', 'finance.member', 'member'
  UNION ALL SELECT 'finance', 'Finance Supervisor', 'finance.supervisor', 'supervisor'
  UNION ALL SELECT 'finance', 'Finance Head', 'finance.head', 'head'
  UNION ALL SELECT 'procurement', 'Procurement Member', 'procurement.member', 'member'
  UNION ALL SELECT 'procurement', 'Procurement Supervisor', 'procurement.supervisor', 'supervisor'
  UNION ALL SELECT 'procurement', 'Procurement Head', 'procurement.head', 'head'
  UNION ALL SELECT 'sales', 'Sales Member', 'sales.member', 'member'
  UNION ALL SELECT 'sales', 'Sales Supervisor', 'sales.supervisor', 'supervisor'
  UNION ALL SELECT 'sales', 'Sales Head', 'sales.head', 'head'
  UNION ALL SELECT 'people_culture', 'People & Culture Member', 'people_culture.member', 'member'
  UNION ALL SELECT 'people_culture', 'People & Culture Supervisor', 'people_culture.supervisor', 'supervisor'
  UNION ALL SELECT 'people_culture', 'People & Culture Head', 'people_culture.head', 'head'
  UNION ALL SELECT 'management_office', 'Management Office Member', 'management_office.member', 'member'
  UNION ALL SELECT 'management_office', 'Management Office Supervisor', 'management_office.supervisor', 'supervisor'
  UNION ALL SELECT 'management_office', 'Management Office Head', 'management_office.head', 'head'
  UNION ALL SELECT 'retail_commerce', 'Retail Commerce Member', 'retail_commerce.member', 'member'
  UNION ALL SELECT 'retail_commerce', 'Retail Commerce Supervisor', 'retail_commerce.supervisor', 'supervisor'
  UNION ALL SELECT 'retail_commerce', 'Retail Commerce Head', 'retail_commerce.head', 'head'
  UNION ALL SELECT 'warehouse', 'Warehouse Member', 'warehouse.member', 'member'
  UNION ALL SELECT 'warehouse', 'Warehouse Supervisor', 'warehouse.supervisor', 'supervisor'
  UNION ALL SELECT 'warehouse', 'Warehouse Head', 'warehouse.head', 'head'
  UNION ALL SELECT 'marketing', 'Marketing Member', 'marketing.member', 'member'
  UNION ALL SELECT 'marketing', 'Marketing Supervisor', 'marketing.supervisor', 'supervisor'
  UNION ALL SELECT 'marketing', 'Marketing Head', 'marketing.head', 'head'
) seed
JOIN departments d ON d.entity_id = 1 AND d.code = seed.department_code
LEFT JOIN roles existing
  ON existing.entity_id = 1 AND existing.role_key = seed.role_key
WHERE existing.id IS NULL;

-- Warehouse movement permissions. Accurate integration is intentionally absent.
INSERT IGNORE INTO permissions (code, description) VALUES
('warehouse.movement.view','Lihat pergerakan barang Warehouse'),
('warehouse.movement.create','Buat draft pergerakan barang Warehouse'),
('warehouse.movement.update','Ubah draft pergerakan barang Warehouse'),
('warehouse.movement.submit','Ajukan pergerakan barang Warehouse'),
('warehouse.movement.approve','Tinjau pergerakan barang Warehouse'),
('warehouse.movement.cancel','Batalkan pergerakan barang Warehouse yang disetujui'),
('warehouse.movement.audit.view','Lihat audit pergerakan barang Warehouse');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'warehouse.movement.view','warehouse.movement.create',
  'warehouse.movement.update','warehouse.movement.submit',
  'warehouse.movement.approve','warehouse.movement.cancel',
  'warehouse.movement.audit.view'
)
WHERE r.role_key = 'system.super_admin' AND r.deleted_at IS NULL;

-- Common Member defaults apply to every standard division role.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'notification.view',
  'document.view','document.create','document.update',
  'template.view','document_type.view',
  'board.view','task.view','task.create','task.update','task.watch',
  'task.checklist.manage','task.activity.view',
  'chat.view','chat.send',
  'approval.view','approval.request',
  'signature.view','signature.request','signature.sign','signature.manage_asset',
  'meeting.view','meeting.create','meeting.update',
  'meeting.attach_recording','meeting.ai_summary',
  'form.view','form.submit','form_submission.view',
  'workflow_instance.view','search.global',
  'kb.view','kb.query','workspace.customer.view',
  'data_classification.view',
  'ai.use','ai.view','ai_command.use','ai_command.session.view',
  'ai_command.session.manage','ai_command.context.attach',
  'ai_command.action.propose','ai_command.department.view'
)
WHERE r.is_system_template = 1
  AND r.role_level IN ('member','supervisor','head')
  AND r.deleted_at IS NULL;

-- Common Supervisor defaults apply to Supervisor and Head.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'board.manage','task.delete','task.watch.manage','task.dependency.manage',
  'approval.decide','approval_delegation.view',
  'meeting.cancel','meeting.confirm_action',
  'ai_command.action.confirm',
  'workspace.cross_division.view','timeline.view','decision_log.view',
  'form_submission.manage','form_submission.transition',
  'workflow_instance.transition'
)
WHERE r.is_system_template = 1
  AND r.role_level IN ('supervisor','head')
  AND r.deleted_at IS NULL;

-- Common Head defaults.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'document.delete','template.manage','kb.manage',
  'decision_log.manage','automation.view','brief.view',
  'data_classification.manage','approval_matrix.view',
  'approval_delegation.manage'
)
WHERE r.is_system_template = 1
  AND r.role_level = 'head'
  AND r.deleted_at IS NULL;

-- Operations additions.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'it.dashboard.view','device.view','subscription.view'
)
WHERE r.role_key IN ('operations.member','operations.supervisor','operations.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'device.manage','device.assign','device.handover.manage','device.log.manage',
  'subscription.manage','subscription.renewal.request'
)
WHERE r.role_key IN ('operations.supervisor','operations.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'software_vendor.manage','subscription.license.manage',
  'subscription.invoice.manage','subscription.renewal.decide',
  'subscription.payment.manage','automation.manage',
  'workflow_definition.view','workflow_definition.manage'
)
WHERE r.role_key = 'operations.head';

-- Finance additions.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'finance.view','finance.request','finance.manage','finance.document_check'
)
WHERE r.role_key IN ('finance.member','finance.supervisor','finance.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'finance.approve','finance.process'
)
WHERE r.role_key IN ('finance.supervisor','finance.head');

-- Procurement additions.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'finance.view','finance.request','warehouse.movement.view','warehouse.sample.view'
)
WHERE r.role_key IN ('procurement.member','procurement.supervisor','procurement.head');

-- Sales additions.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'sales.customer.view','sales.customer.manage',
  'sales.inquiry.view','sales.inquiry.manage',
  'sales.pipeline.view','sales.pipeline.manage',
  'sales.visit.view','sales.visit.create',
  'sales.sample.view','sales.sample.request',
  'sales.quotation.view','sales.quotation.manage','sales.field_bot.use'
)
WHERE r.role_key IN ('sales.member','sales.supervisor','sales.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'sales.sample.approve'
WHERE r.role_key IN ('sales.supervisor','sales.head');

-- People & Culture additions.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'hrga.view','hrga.request','hrga.manage'
)
WHERE r.role_key IN (
  'people_culture.member','people_culture.supervisor','people_culture.head'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'hrga.approve','hrga.complete'
)
WHERE r.role_key IN ('people_culture.supervisor','people_culture.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code = 'hrga.checklist_template.manage'
WHERE r.role_key = 'people_culture.head';

-- Management Office additions.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'workspace.cross_division.view','timeline.view','brief.view','decision_log.view'
)
WHERE r.role_key IN (
  'management_office.member','management_office.supervisor','management_office.head'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code = 'management_dashboard.view'
WHERE r.role_key IN ('management_office.supervisor','management_office.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'activity_log.view'
WHERE r.role_key = 'management_office.head';

-- Retail Commerce additions.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'sales.customer.view','sales.customer.manage',
  'sales.pipeline.view','sales.pipeline.manage',
  'sales.quotation.view','sales.quotation.manage',
  'sales.sample.view','sales.sample.request',
  'warehouse.movement.view','warehouse.sample.view'
)
WHERE r.role_key IN (
  'retail_commerce.member','retail_commerce.supervisor','retail_commerce.head'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'sales.sample.approve'
WHERE r.role_key IN ('retail_commerce.supervisor','retail_commerce.head');

-- Warehouse additions.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'warehouse.movement.view','warehouse.movement.create',
  'warehouse.movement.update','warehouse.movement.submit',
  'warehouse.inbound.manage','warehouse.outbound.manage',
  'warehouse.sample.view','warehouse.sample.manage',
  'warehouse.checklist.view','warehouse.checklist.manage',
  'warehouse.delivery_proof.upload',
  'warehouse.incident.view','warehouse.incident.manage'
)
WHERE r.role_key IN ('warehouse.member','warehouse.supervisor','warehouse.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'warehouse.movement.approve','warehouse.movement.audit.view'
)
WHERE r.role_key IN ('warehouse.supervisor','warehouse.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code = 'warehouse.movement.cancel'
WHERE r.role_key = 'warehouse.head';

-- Marketing additions.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'sales.customer.view','sales.quotation.view'
)
WHERE r.role_key IN ('marketing.member','marketing.supervisor','marketing.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'template.manage'
WHERE r.role_key IN ('marketing.supervisor','marketing.head');

SET FOREIGN_KEY_CHECKS = 1;
