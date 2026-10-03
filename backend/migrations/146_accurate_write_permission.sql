-- ============================================================
-- Migration 146 — Pengajuan ke Accurate: siapa yang boleh mengajukan
--
-- Separate from 145 (table and matrix) on purpose (owner, 3 Oct 2026): the
-- feature only appears to users once this permission is granted, so a
-- deployment can carry the schema first and switch the feature on later.
-- Mirrors standardOrganization.js. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

-- Who may propose: everyone who keeps customers (Sales, Retail Commerce) or
-- works with vendors (Procurement). Deciding stays with the approval engine
-- (approval.decide + the matrix in migration 145). Mirrors standardOrganization.js.
INSERT IGNORE INTO permissions (code, description) VALUES
('accurate.write.request', 'Ajukan perubahan data master (pelanggan, pemasok) ke Accurate lewat persetujuan Supervisor/Head');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code = 'accurate.write.request'
 WHERE r.deleted_at IS NULL
   AND r.role_key IN (
     'sales.member', 'sales.supervisor', 'sales.head',
     'retail_commerce.member', 'retail_commerce.supervisor', 'retail_commerce.head',
     'procurement.member', 'procurement.supervisor', 'procurement.head'
   );

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code = 'accurate.write.request'
 WHERE (r.role_key = 'system.super_admin' OR LOWER(r.name) IN ('super admin', 'superadmin'))
   AND r.deleted_at IS NULL;
