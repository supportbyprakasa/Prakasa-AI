-- ============================================================
-- Migration 073 — "Data Accurate" page for every division that gets Accurate data
--
-- Supervisors and Heads of Sales, Retail Commerce, Warehouse, Procurement and
-- Finance see (and decide) their own division's Accurate batches on one page,
-- /data-accurate. Mirrors backend/src/config/standardOrganization.js.
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

INSERT IGNORE INTO permissions (code, description) VALUES
('accurate.batch.view', 'Lihat dan putuskan batch data Accurate divisi sendiri (Supervisor/Head)');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code = 'accurate.batch.view'
 WHERE r.deleted_at IS NULL
   AND r.role_key IN (
     'sales.supervisor', 'sales.head', 'retail_commerce.supervisor', 'retail_commerce.head',
     'warehouse.supervisor', 'warehouse.head', 'procurement.supervisor', 'procurement.head',
     'finance.supervisor', 'finance.head'
   );

-- Super Admin keeps every permission.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code = 'accurate.batch.view'
 WHERE (r.role_key = 'system.super_admin' OR LOWER(r.name) IN ('super admin', 'superadmin'))
   AND r.deleted_at IS NULL;
