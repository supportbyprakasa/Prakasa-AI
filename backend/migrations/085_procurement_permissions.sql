-- ============================================================
-- Migration 085 — Procurement stage 1 permissions (docs/program-4-divisi.md 2.1)
--   procurement.view           POs, vendors and incoming goods from Accurate
--                              (quantities and dates): every Procurement role,
--                              Management Office Supervisor/Head
--   procurement.price.view     purchase prices and PO values (owner P1): the
--                              Procurement Supervisor/Head and the Management
--                              Office Supervisor/Head
--   procurement.accurate.sync  start a Procurement pull from Accurate (read-only):
--                              Procurement Supervisor/Head
-- The approval matrix for Procurement batches already exists (migration 072).
-- Mirrors backend/src/config/standardOrganization.js. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

INSERT IGNORE INTO permissions (code, description) VALUES
('procurement.view', 'Lihat PO, pemasok, dan barang datang dari Accurate (jumlah dan tanggal)'),
('procurement.price.view', 'Lihat harga beli dan nilai PO dari Accurate'),
('procurement.accurate.sync', 'Tarik data Procurement dari Accurate untuk disetujui (hanya membaca Accurate)');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'procurement.view'
 WHERE r.deleted_at IS NULL
   AND r.role_key IN ('procurement.member', 'procurement.supervisor', 'procurement.head',
                      'management_office.supervisor', 'management_office.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'procurement.price.view'
 WHERE r.deleted_at IS NULL
   AND r.role_key IN ('procurement.supervisor', 'procurement.head', 'management_office.supervisor', 'management_office.head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'procurement.accurate.sync'
 WHERE r.deleted_at IS NULL AND r.role_key IN ('procurement.supervisor', 'procurement.head');

-- Super Admin keeps every permission.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('procurement.view', 'procurement.price.view', 'procurement.accurate.sync')
 WHERE (r.role_key = 'system.super_admin' OR LOWER(r.name) IN ('super admin', 'superadmin')) AND r.deleted_at IS NULL;
