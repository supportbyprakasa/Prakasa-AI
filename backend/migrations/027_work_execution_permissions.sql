-- ============================================================
-- Migration 027 — Work Execution Permissions (Batch 4 Part 1)
-- Idempotent.
-- ============================================================

INSERT IGNORE INTO permissions (code, description) VALUES
('task.watch','Pantau task (watch/unwatch diri sendiri)'),
('task.watch.manage','Kelola watcher task (tambah/hapus user lain)'),
('task.checklist.manage','Kelola checklist task'),
('task.dependency.manage','Kelola dependency task'),
('task.activity.view','Lihat riwayat aktivitas task');

-- Grant to Super Admin only (same policy as Batches 1–3).
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'task.watch','task.watch.manage',
  'task.checklist.manage','task.dependency.manage','task.activity.view'
)
WHERE LOWER(r.name) IN ('super admin','superadmin','administrator')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );