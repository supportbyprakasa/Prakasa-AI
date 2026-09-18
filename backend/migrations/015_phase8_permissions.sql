INSERT IGNORE INTO permissions (code, description) VALUES
('workspace.customer.view','Lihat Customer Workspace'),
('workspace.cross_division.view','Lihat Cross-Division Workspace'),
('search.global','Gunakan global search'),
('kb.view','Lihat AI Knowledge Base'),
('kb.manage','Kelola dokumen Knowledge Base'),
('kb.query','Tanya AI Knowledge Base'),
('automation.view','Lihat Automation Builder'),
('automation.manage','Kelola Automation Builder'),
('decision_log.view','Lihat Decision Log'),
('decision_log.manage','Kelola Decision Log'),
('timeline.view','Lihat timeline / gantt'),
('brief.view','Lihat AI Daily/Weekly Brief'),
('data_classification.view','Lihat klasifikasi data'),
('data_classification.manage','Kelola klasifikasi data'),
('management_dashboard.view','Lihat management dashboard');

-- AI module context untuk Knowledge Base & Brief
INSERT IGNORE INTO ai_module_contexts (module, provider, model, system_prompt, params)
VALUES
('knowledge_base',
 'openai','gpt-4o-mini',
 'Kamu adalah asisten SOP/policy Prakasa Group. Jawab pertanyaan user HANYA berdasarkan konteks dokumen yang diberikan. Jika jawaban tidak ada di konteks, jawab: "Informasi ini tidak ditemukan di dokumen SOP yang tersedia." WAJIB menyebutkan sumber (judul dokumen) di akhir jawaban. Jawab ringkas dalam Bahasa Indonesia.',
 JSON_OBJECT('temperature', 0.1, 'max_tokens', 900)),
('daily_brief',
 'openai','gpt-4o-mini',
 'Kamu adalah asisten manajemen Prakasa Group. Buat ringkasan singkat (maks 250 kata) untuk manajemen berdasarkan data operasional hari ini. Fokus pada: hal yang butuh perhatian, angka penting, dan 3 rekomendasi tindakan. Format paragraf + bullet list. Bahasa Indonesia.',
 JSON_OBJECT('temperature', 0.3, 'max_tokens', 700));
