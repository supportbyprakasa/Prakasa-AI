-- ============================================================
-- Migration 019 — Default Configuration Seed
-- ============================================================

INSERT IGNORE INTO dashboard_widgets
(code, name, description, category, default_size, permission_code) VALUES
('kpi.users','Total Users','Jumlah user aktif','kpi','small','user.manage'),
('kpi.entities','Total Entities','Jumlah entity','kpi','small','entity.manage'),
('kpi.departments','Total Departments','Jumlah department','kpi','small','department.manage'),
('kpi.tasks_active','Task Aktif','Task belum selesai','kpi','small','task.view'),
('kpi.tasks_overdue','Task Overdue','Task melewati due date','kpi','small','task.view'),
('kpi.approvals_pending','Approval Pending','Approval belum diputuskan','kpi','small','approval.view'),
('kpi.signatures_pending','Signature Pending','Signature belum ditandatangani','kpi','small','signature.view'),
('kpi.subscriptions_expiring','Subscription Expiring','Subscription renewal dekat','kpi','small','subscription.view'),
('kpi.form_submissions_open','Form Submission Open','Submission belum final','kpi','small','form_submission.view'),
('list.overdue_tasks','Top Overdue Tasks','Daftar task overdue','list','medium','task.view'),
('list.aged_approvals','Approval Aging','Approval pending lama','list','medium','approval.view'),
('list.recent_activity','Recent Activity','Activity log terbaru','list','medium','activity_log.view'),
('list.recent_submissions','Recent Submissions','Form submission terbaru','list','medium','form_submission.view'),
('list.integration_health','Integration Health','Status integrasi eksternal','list','medium','integration_log.view'),
('chart.ai_usage','AI Usage','Statistik pemakaian AI','chart','medium','ai.view');

INSERT IGNORE INTO workflow_definitions
(entity_id, name, slug, description, applies_to, is_active)
SELECT id, 'Simple Approval', 'simple-approval',
       'Workflow dasar form: draft -> submitted -> under_review -> approved/rejected',
       'form', 1
FROM entities
WHERE deleted_at IS NULL;

INSERT IGNORE INTO workflow_statuses
(workflow_definition_id, code, label, color, is_initial, is_final, order_index)
SELECT id, 'draft', 'Draft', '#64748b', 1, 0, 1
FROM workflow_definitions WHERE slug='simple-approval' AND deleted_at IS NULL;

INSERT IGNORE INTO workflow_statuses
(workflow_definition_id, code, label, color, is_initial, is_final, order_index)
SELECT id, 'submitted', 'Submitted', '#0ea5e9', 0, 0, 2
FROM workflow_definitions WHERE slug='simple-approval' AND deleted_at IS NULL;

INSERT IGNORE INTO workflow_statuses
(workflow_definition_id, code, label, color, is_initial, is_final, order_index)
SELECT id, 'under_review', 'Under Review', '#f59e0b', 0, 0, 3
FROM workflow_definitions WHERE slug='simple-approval' AND deleted_at IS NULL;

INSERT IGNORE INTO workflow_statuses
(workflow_definition_id, code, label, color, is_initial, is_final, order_index)
SELECT id, 'approved', 'Approved', '#16a34a', 0, 1, 4
FROM workflow_definitions WHERE slug='simple-approval' AND deleted_at IS NULL;

INSERT IGNORE INTO workflow_statuses
(workflow_definition_id, code, label, color, is_initial, is_final, order_index)
SELECT id, 'rejected', 'Rejected', '#dc2626', 0, 1, 5
FROM workflow_definitions WHERE slug='simple-approval' AND deleted_at IS NULL;

INSERT IGNORE INTO workflow_transitions
(workflow_definition_id, from_status_id, to_status_id, action_label, required_permission_code, order_index)
SELECT wd.id, s1.id, s2.id, 'Submit', 'form.submit', 1
FROM workflow_definitions wd
JOIN workflow_statuses s1 ON s1.workflow_definition_id=wd.id AND s1.code='draft'
JOIN workflow_statuses s2 ON s2.workflow_definition_id=wd.id AND s2.code='submitted'
WHERE wd.slug='simple-approval' AND wd.deleted_at IS NULL;

INSERT IGNORE INTO workflow_transitions
(workflow_definition_id, from_status_id, to_status_id, action_label, required_permission_code, order_index)
SELECT wd.id, s1.id, s2.id, 'Mulai Review', 'form_submission.manage', 2
FROM workflow_definitions wd
JOIN workflow_statuses s1 ON s1.workflow_definition_id=wd.id AND s1.code='submitted'
JOIN workflow_statuses s2 ON s2.workflow_definition_id=wd.id AND s2.code='under_review'
WHERE wd.slug='simple-approval' AND wd.deleted_at IS NULL;

INSERT IGNORE INTO workflow_transitions
(workflow_definition_id, from_status_id, to_status_id, action_label, required_permission_code, requires_comment, order_index)
SELECT wd.id, s1.id, s2.id, 'Setujui', 'form_submission.manage', 0, 3
FROM workflow_definitions wd
JOIN workflow_statuses s1 ON s1.workflow_definition_id=wd.id AND s1.code='under_review'
JOIN workflow_statuses s2 ON s2.workflow_definition_id=wd.id AND s2.code='approved'
WHERE wd.slug='simple-approval' AND wd.deleted_at IS NULL;

INSERT IGNORE INTO workflow_transitions
(workflow_definition_id, from_status_id, to_status_id, action_label, required_permission_code, requires_comment, order_index)
SELECT wd.id, s1.id, s2.id, 'Tolak', 'form_submission.manage', 1, 4
FROM workflow_definitions wd
JOIN workflow_statuses s1 ON s1.workflow_definition_id=wd.id AND s1.code='under_review'
JOIN workflow_statuses s2 ON s2.workflow_definition_id=wd.id AND s2.code='rejected'
WHERE wd.slug='simple-approval' AND wd.deleted_at IS NULL;

INSERT IGNORE INTO document_types
(entity_id, code, name, category, requires_signature, requires_ai_precheck, is_active)
SELECT id, 'sop', 'SOP', 'policy', 0, 0, 1 FROM entities WHERE deleted_at IS NULL;
INSERT IGNORE INTO document_types
(entity_id, code, name, category, requires_signature, requires_ai_precheck, is_active)
SELECT id, 'proposal', 'Proposal', 'sales', 1, 1, 1 FROM entities WHERE deleted_at IS NULL;
INSERT IGNORE INTO document_types
(entity_id, code, name, category, requires_signature, requires_ai_precheck, is_active)
SELECT id, 'quotation', 'Quotation', 'sales', 1, 1, 1 FROM entities WHERE deleted_at IS NULL;
INSERT IGNORE INTO document_types
(entity_id, code, name, category, requires_signature, requires_ai_precheck, is_active)
SELECT id, 'invoice', 'Invoice', 'finance', 0, 0, 1 FROM entities WHERE deleted_at IS NULL;
INSERT IGNORE INTO document_types
(entity_id, code, name, category, requires_signature, requires_ai_precheck, is_active)
SELECT id, 'policy', 'Policy', 'hr', 0, 0, 1 FROM entities WHERE deleted_at IS NULL;

INSERT IGNORE INTO forms
(entity_id, name, slug, description, category, is_active, is_public, submit_permission_code, workflow_definition_id)
SELECT e.id, 'IT Access Request', 'it-access-request',
       'Permintaan akses sistem/aplikasi/device',
       'it_access', 1, 1, 'form.submit', wd.id
FROM entities e
LEFT JOIN workflow_definitions wd
  ON wd.entity_id=e.id AND wd.slug='simple-approval' AND wd.deleted_at IS NULL
WHERE e.deleted_at IS NULL;

INSERT IGNORE INTO form_fields
(form_id, field_key, label, field_type, is_required, order_index, section_name, help_text)
SELECT f.id, 'system_name', 'Sistem / Aplikasi', 'text', 1, 1, 'Detail',
       'Contoh: Google Workspace, Jurnal.id'
FROM forms f WHERE f.slug='it-access-request' AND f.deleted_at IS NULL;

INSERT IGNORE INTO form_fields
(form_id, field_key, label, field_type, is_required, order_index, section_name, options_json)
SELECT f.id, 'access_level', 'Level Akses', 'select', 1, 2, 'Detail',
       JSON_ARRAY(
         JSON_OBJECT('value','view','label','View Only'),
         JSON_OBJECT('value','edit','label','Edit'),
         JSON_OBJECT('value','admin','label','Admin')
       )
FROM forms f WHERE f.slug='it-access-request' AND f.deleted_at IS NULL;

INSERT IGNORE INTO form_fields
(form_id, field_key, label, field_type, is_required, order_index, section_name)
SELECT f.id, 'justification', 'Justifikasi', 'textarea', 1, 3, 'Detail'
FROM forms f WHERE f.slug='it-access-request' AND f.deleted_at IS NULL;

INSERT IGNORE INTO form_fields
(form_id, field_key, label, field_type, is_required, order_index, section_name)
SELECT f.id, 'attachment', 'Dokumen Pendukung', 'file', 0, 4, 'Lampiran'
FROM forms f WHERE f.slug='it-access-request' AND f.deleted_at IS NULL;
