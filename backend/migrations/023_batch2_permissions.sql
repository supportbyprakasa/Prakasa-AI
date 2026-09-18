-- ============================================================
-- Migration 023 — Batch 2 Permissions + Signature Precheck Context
-- ============================================================
INSERT IGNORE INTO permissions (code, description) VALUES
('approval_matrix.view','Lihat approval matrix'),
('approval_matrix.manage','Kelola approval matrix'),
('approval_delegation.view','Lihat delegasi approval'),
('approval_delegation.manage','Kelola delegasi approval'),
('approval_reminder.manage','Kelola dan jalankan reminder/escalation approval'),
('signature_precheck.view','Lihat log AI precheck tanda tangan'),
('signature_precheck.run','Jalankan AI precheck tanda tangan'),
('signature_qr.view','Lihat QR verifikasi dokumen'),
('signature_qr.generate','Generate QR verifikasi dokumen');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'approval_matrix.view','approval_matrix.manage',
  'approval_delegation.view','approval_delegation.manage',
  'approval_reminder.manage',
  'signature_precheck.view','signature_precheck.run',
  'signature_qr.view','signature_qr.generate'
)
WHERE LOWER(r.name) IN ('super admin','superadmin','administrator')
  AND r.deleted_at IS NULL;

-- Reuse the provider/model already selected for the document assistant rather
-- than hard-coding a different AI provider for this module.
INSERT IGNORE INTO ai_module_contexts
(module, provider, model, system_prompt, params, is_active)
SELECT
  'signature_precheck',
  provider,
  model,
  'Kamu adalah asisten kepatuhan tanda tangan dokumen Prakasa Group. Periksa kelengkapan, konsistensi angka/nama/tanggal, bagian penting, dan kesesuaian dengan approval. Jangan membuat keputusan approve/reject. Output wajib JSON valid: {"status":"passed|warning|failed","summary":"","findings":[{"severity":"low|medium|high","message":"","ref":""}]}.',
  JSON_OBJECT('temperature', 0.1, 'max_tokens', 1200),
  1
FROM ai_module_contexts
WHERE module='document_assistant'
LIMIT 1;
