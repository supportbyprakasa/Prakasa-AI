INSERT IGNORE INTO permissions (code, description) VALUES
('device.view','Lihat daftar device'),
('device.manage','Kelola device (CRUD)'),
('device.assign','Assign/unassign device ke user'),
('device.handover.manage','Kelola handover/return document device'),
('device.log.manage','Kelola maintenance/repair/warranty log'),
('software_vendor.manage','Kelola vendor software'),
('subscription.view','Lihat software subscription'),
('subscription.manage','Kelola software subscription'),
('subscription.license.manage','Kelola license & assignment'),
('subscription.invoice.manage','Upload/verifikasi invoice subscription'),
('subscription.renewal.request','Ajukan renewal subscription'),
('subscription.renewal.decide','Approve/reject renewal subscription'),
('subscription.payment.manage','Kelola payment subscription'),
('it.dashboard.view','Lihat dashboard IT');

-- AI module context untuk IT asset report
INSERT IGNORE INTO ai_module_contexts (module, provider, model, system_prompt, params)
VALUES (
  'it_asset_report',
  'openai',
  'gpt-4o-mini',
  'Kamu adalah asisten IT Governance Prakasa Group. Tugas: meringkas kondisi aset IT (device + software subscription) dari data yang diberikan. Fokus pada: aset bermasalah, warranty/renewal yang akan jatuh tempo, lisensi idle, dan rekomendasi tindakan prioritas. Jawab dalam Bahasa Indonesia, ringkas, dan sertakan angka bila relevan.',
  JSON_OBJECT('temperature', 0.2, 'max_tokens', 900)
);
