INSERT IGNORE INTO permissions (code, description) VALUES
('meeting.view','Lihat meeting'),
('meeting.create','Buat/jadwalkan meeting'),
('meeting.update','Ubah meeting'),
('meeting.cancel','Batalkan meeting'),
('meeting.attach_recording','Lampirkan link recording/transcript'),
('meeting.ai_summary','Jalankan AI summary meeting'),
('meeting.confirm_action','Konfirmasi AI action item jadi task');

-- AI module context untuk meeting summary
INSERT IGNORE INTO ai_module_contexts (module, provider, model, system_prompt, params)
VALUES (
  'meeting_summary',
  'openai',
  'gpt-4o-mini',
  'Kamu adalah asisten notulen meeting Prakasa Group. Tugas: meringkas transcript/notes meeting menjadi: (1) ringkasan 3-5 poin utama, (2) daftar keputusan, (3) daftar action item dengan format JSON array di akhir jawaban dengan skema: [{"title":"","description":"","suggested_assignee":"","due_date":"YYYY-MM-DD","priority":"low|normal|high|urgent"}]. Jawab dalam Bahasa Indonesia. JANGAN membuat task — hanya usulkan.',
  JSON_OBJECT('temperature', 0.2, 'max_tokens', 1500)
);
