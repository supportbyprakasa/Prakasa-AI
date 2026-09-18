-- ============================================================
-- Migration 018 — Configuration Engine Permissions
-- ============================================================
INSERT IGNORE INTO permissions (code, description) VALUES
('entity.cross_access','Akses lintas entity khusus administrator global'),
('form.view','Lihat daftar form'),
('form.manage','Buat/ubah/nonaktifkan form dan field'),
('form.submit','Submit form'),
('form_submission.view','Lihat form submission'),
('form_submission.manage','Kelola form submission'),
('form_submission.transition','Jalankan transisi workflow form submission'),
('workflow_definition.view','Lihat workflow definition'),
('workflow_definition.manage','Kelola workflow definition/status/transition'),
('workflow_instance.view','Lihat workflow instance'),
('workflow_instance.transition','Jalankan transisi workflow instance'),
('document_type.view','Lihat document type'),
('document_type.manage','Kelola document type'),
('signature_rule.view','Lihat signature rule'),
('signature_rule.manage','Kelola signature rule'),
('dashboard_widget.manage','Kelola katalog dashboard widget'),
('dashboard_layout.manage','Kelola layout dashboard per role'),
('integration_log.view','Lihat integration log');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'entity.cross_access',
  'form.view','form.manage','form.submit',
  'form_submission.view','form_submission.manage','form_submission.transition',
  'workflow_definition.view','workflow_definition.manage',
  'workflow_instance.view','workflow_instance.transition',
  'document_type.view','document_type.manage',
  'signature_rule.view','signature_rule.manage',
  'dashboard_widget.manage','dashboard_layout.manage',
  'integration_log.view'
)
WHERE LOWER(r.name) IN ('super admin','superadmin','administrator')
  AND r.deleted_at IS NULL;
