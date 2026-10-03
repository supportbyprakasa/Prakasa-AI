-- ============================================================
-- Migration 076 — Warehouse stage 1 permissions (quantities only; owner D1/D2)
--   warehouse.stock.view      see stock from Accurate: Warehouse (all roles) and
--                             Management Office Supervisor/Head (oversight)
--   warehouse.accurate.sync   start a Warehouse pull from Accurate (read-only):
--                             Warehouse Supervisor/Head
-- Mirrors backend/src/config/standardOrganization.js. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

INSERT IGNORE INTO permissions (code, description) VALUES
('warehouse.stock.view', 'Lihat stok barang dari Accurate (jumlah saja, tanpa harga)'),
('warehouse.accurate.sync', 'Tarik data gudang dari Accurate untuk disetujui (hanya membaca Accurate)');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'warehouse.stock.view'
 WHERE r.deleted_at IS NULL
   AND r.role_key IN ('warehouse.member', 'warehouse.supervisor', 'warehouse.head',
                      'management_office.supervisor', 'management_office.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'warehouse.accurate.sync'
 WHERE r.deleted_at IS NULL AND r.role_key IN ('warehouse.supervisor', 'warehouse.head');

-- Super Admin keeps every permission.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('warehouse.stock.view', 'warehouse.accurate.sync')
 WHERE (r.role_key = 'system.super_admin' OR LOWER(r.name) IN ('super admin', 'superadmin')) AND r.deleted_at IS NULL;
