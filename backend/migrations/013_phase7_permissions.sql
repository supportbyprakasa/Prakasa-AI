INSERT IGNORE INTO permissions (code, description) VALUES
('finance.view','Lihat finance workflow'),
('finance.request','Buat payment request / reimbursement'),
('finance.manage','Update finance workflow (non-approval)'),
('finance.approve','Approve/reject finance workflow'),
('finance.process','Proses & tandai paid (PIC Finance)'),
('finance.document_check','Jalankan AI document check'),
('hrga.view','Lihat HRGA workflow'),
('hrga.request','Buat onboarding/offboarding workflow'),
('hrga.manage','Update HRGA workflow (non-approval)'),
('hrga.approve','Approve/reject HRGA workflow'),
('hrga.complete','Tandai HRGA workflow selesai'),
('hrga.checklist_template.manage','Kelola template checklist HRGA');

-- AI module context untuk document completeness checker
INSERT IGNORE INTO ai_module_contexts (module, provider, model, system_prompt, params)
VALUES (
  'document_check',
  'openai',
  'gpt-4o-mini',
  'Kamu adalah asisten Finance/HRGA Prakasa Group yang memeriksa kelengkapan dokumen pengajuan (payment request, reimbursement, onboarding, offboarding). Tugas: periksa apakah dokumen yang diunggah lengkap sesuai jenis pengajuan. Output WAJIB berupa JSON valid tanpa penjelasan tambahan, dengan skema: {"status":"passed|warning|failed","missing_documents":[],"warnings":[],"notes":""}. status "passed" jika semua dokumen wajib ada, "warning" jika ada dokumen opsional yang kurang atau ada kejanggalan minor, "failed" jika ada dokumen wajib yang hilang atau data kunci tidak konsisten.',
  JSON_OBJECT('temperature', 0.1, 'max_tokens', 800)
);
