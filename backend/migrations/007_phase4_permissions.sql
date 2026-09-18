INSERT IGNORE INTO permissions (code, description) VALUES
('sales.customer.view','Lihat customer sales'),
('sales.customer.manage','Kelola customer sales'),
('sales.inquiry.view','Lihat buyer inquiry'),
('sales.inquiry.manage','Kelola buyer inquiry'),
('sales.pipeline.view','Lihat sales pipeline'),
('sales.pipeline.manage','Kelola sales pipeline'),
('sales.visit.view','Lihat visit report'),
('sales.visit.create','Buat visit report'),
('sales.sample.view','Lihat sample request'),
('sales.sample.request','Buat sample request'),
('sales.sample.approve','Approve/reject sample request'),
('sales.quotation.view','Lihat quotation'),
('sales.quotation.manage','Kelola quotation'),
('sales.field_bot.use','Gunakan Field Sales Chat Bot'),
('warehouse.checklist.view','Lihat checklist warehouse'),
('warehouse.checklist.manage','Kelola checklist warehouse'),
('warehouse.inbound.manage','Kelola inbound warehouse'),
('warehouse.outbound.manage','Kelola outbound warehouse'),
('warehouse.sample.view','Lihat sample task'),
('warehouse.sample.manage','Kelola sample task (prepare/ready/deliver)'),
('warehouse.delivery_proof.upload','Unggah delivery proof'),
('warehouse.incident.view','Lihat incident warehouse'),
('warehouse.incident.manage','Kelola incident warehouse');

-- Seed AI module context untuk Field Sales Bot
INSERT IGNORE INTO ai_module_contexts (module, provider, model, system_prompt, params)
VALUES (
  'field_sales_bot',
  'openai',
  'gpt-4o-mini',
  'Kamu adalah asisten Field Sales untuk Prakasa Group. Tugas: menerima laporan tidak terstruktur (chat suara/teks/foto) dari sales lapangan, lalu mengubahnya jadi data terstruktur: customer, produk, aksi (visit/follow_up/request_sample/request_quotation/report_issue), ringkasan singkat, prioritas. Jawab HANYA dalam format JSON valid tanpa penjelasan tambahan, dengan skema: {"action":"visit_report|follow_up|request_sample|request_quotation|report_issue|update_deal","customer_name":"","product":"","summary":"","priority":"low|normal|high|urgent","suggested_pipeline_stage":""}.',
  JSON_OBJECT('temperature', 0.1, 'max_tokens', 600)
);
