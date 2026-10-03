-- ============================================================
-- Migration 048 — Division-scoped management reporting
--
-- Adds `management_dashboard.division`: a division Head sees the Project
-- Tracker portfolio of their OWN division only, while
-- `management_dashboard.view` keeps the entity-wide view it always had.
--
-- Also backfills boards.department_id for projects enabled before the tracker
-- started recording a division, using the division of whoever created them —
-- without it those projects never appear in a per-division report.
--
-- (047 is reserved for the module removal migration.)
-- Idempotent.
-- ============================================================
SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- A. The permission itself
-- ------------------------------------------------------------
INSERT INTO permissions (code, description)
SELECT 'management_dashboard.division',
       'Lihat laporan Project Tracker untuk divisinya sendiri'
 WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'management_dashboard.division');

-- ------------------------------------------------------------
-- B. Grant it to every division Head role that does not already hold the
--    entity-wide view (Management Office and Super Admin keep that one).
-- ------------------------------------------------------------
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
 WHERE p.code = 'management_dashboard.division'
   AND r.deleted_at IS NULL
   AND r.department_id IS NOT NULL
   AND LOWER(r.name) LIKE '%head%'
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions rp
      JOIN permissions pv ON pv.id = rp.permission_id
     WHERE rp.role_id = r.id AND pv.code = 'management_dashboard.view'
   )
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
   );

-- ------------------------------------------------------------
-- C. Backfill the division of projects enabled before it was recorded.
-- ------------------------------------------------------------
UPDATE boards b
  JOIN users u ON u.id = b.created_by
   SET b.department_id = u.department_id
 WHERE b.department_id IS NULL
   AND u.department_id IS NOT NULL
   AND b.project_key IS NOT NULL
   AND b.google_chat_space_name IS NOT NULL
   AND b.deleted_at IS NULL;
