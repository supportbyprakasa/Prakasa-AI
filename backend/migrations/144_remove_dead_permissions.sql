-- Audit kemudahan pengguna (3 Okt 2026): 24 kode izin yang tidak dicek di mana
-- pun di backend maupun frontend (sisa fitur yang sudah dicabut: form, knowledge
-- base, workflow engine, automation, timeline, brief, data classification,
-- decision log, dashboard layout, workspace customer/operations). Mereka hanya
-- memenuhi halaman Peran dan Izin akses dan membuat admin mengira ada fitur di
-- baliknya. Menghapusnya tidak mengubah akses siapa pun: tidak ada route atau
-- layar yang memeriksanya. role_permissions ikut terhapus (ON DELETE CASCADE).
-- Idempotent.
SET NAMES utf8mb4;

DELETE FROM permissions WHERE code IN (
  'automation.manage', 'automation.view', 'brief.view',
  'dashboard_layout.manage', 'dashboard_widget.manage',
  'data_classification.manage', 'data_classification.view', 'decision_log.manage',
  'form.manage', 'form.submit', 'form.view',
  'form_submission.manage', 'form_submission.transition', 'form_submission.view',
  'kb.manage', 'kb.query', 'kb.view', 'timeline.view',
  'workflow_definition.manage', 'workflow_definition.view',
  'workflow_instance.transition', 'workflow_instance.view',
  'workspace.customer.view', 'workspace.operations.view'
);
