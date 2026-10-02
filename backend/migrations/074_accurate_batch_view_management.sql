-- ============================================================
-- Migration 074 — Management Office Head can oversee Accurate batches
--
-- Viewing only: every division's batch is still decided by that division's
-- Supervisor/Head. Mirrors standardOrganization.js. Idempotent.
-- ============================================================
SET NAMES utf8mb4;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code = 'accurate.batch.view'
 WHERE r.role_key = 'management_office.head' AND r.deleted_at IS NULL;
