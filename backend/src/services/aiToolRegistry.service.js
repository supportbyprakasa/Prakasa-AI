// Central description of every application tool that Prakasa AI can assist with.
// A coverage test fails when a permission-visible frontend route has no descriptor here.
// Which agent data tools serve each page: services/ai/agent/moduleCoverage.js.
const { isPending } = require('./ai/agent/moduleCoverage');

const RISK_TIERS = Object.freeze(['read', 'draft', 'confirmed_write', 'controlled_decision', 'system_administration']);
const CONFIRMATION = Object.freeze({
  read: 'none',
  draft: 'user_saves',
  confirmed_write: 'explicit_confirmation',
  controlled_decision: 'human_decides',
  system_administration: 'super_admin_confirms',
});
const ROLE_LEVELS = Object.freeze(['member', 'supervisor', 'head', 'admin']);

const COMMON_QUERY_KEYS = Object.freeze(['tab', 'status', 'q', 'search', 'from', 'to', 'page', 'view', 'type']);

function action(key, label, riskTier, { executor = null, permission = null, auditEvent = null } = {}) {
  return Object.freeze({
    key,
    label,
    riskTier,
    confirmationTier: CONFIRMATION[riskTier],
    executor: riskTier === 'controlled_decision' ? null : executor,
    permission,
    auditEvent: auditEvent || `ai_tool.${key}`,
  });
}

const EXPLAIN = action('explain', 'Jelaskan halaman atau record', 'read');
const SUMMARIZE = action('summarize', 'Ringkas data yang terlihat', 'read');
const FIND_GAPS = action('find_gaps', 'Cari data kosong atau tidak konsisten', 'read');
const DRAFT_NEXT = action('draft_next_step', 'Siapkan draft langkah berikutnya', 'draft');
const BASE_ACTIONS = [EXPLAIN, SUMMARIZE, FIND_GAPS, DRAFT_NEXT];

// Existing AI Command Center executors (confirmed through the action proposal flow).
const PROPOSE_TASK = action('propose_create_task', 'Usulkan task baru', 'confirmed_write', { executor: 'ai_command.create_task', permission: 'task.create' });
const PROPOSE_TASK_UPDATE = action('propose_update_task', 'Usulkan perubahan task', 'confirmed_write', { executor: 'ai_command.update_task', permission: 'task.update' });
const PROPOSE_DOCUMENT = action('propose_create_document', 'Usulkan dokumen baru', 'confirmed_write', { executor: 'ai_command.create_document', permission: 'document.create' });
const PROPOSE_APPROVAL = action('propose_approval_request', 'Usulkan pengajuan approval', 'confirmed_write', { executor: 'ai_command.create_approval', permission: 'approval.request' });
const PROPOSE_NOTIFICATION = action('propose_notification', 'Usulkan notifikasi', 'confirmed_write', { executor: 'ai_command.send_notification', permission: 'notification.view' });
const RECOMMEND_DECISION = action('recommend_decision', 'Rekomendasikan keputusan (manusia yang memutuskan)', 'controlled_decision');
const ADMIN_CHANGE_PREVIEW = action('preview_admin_change', 'Siapkan pratinjau perubahan konfigurasi', 'system_administration');

// Starter questions per page and role level (member / supervisor / head).
// Every one names the agent tool that answers it (ai/agent/tools/*): the
// starter is shown only to a user who holds that tool, so a suggestion never
// leads to "Anda tidak punya akses". `permission` narrows it further.
// test/aiAgentCoverage.test.js checks this for every standard role.
const q = (text, tool, permission = null) => Object.freeze(permission ? { text, tool, permission } : { text, tool });

// Action starters (Wave C): Prakasa AI opens the form and fills it, the user
// saves. Each names the page tool that does it and the form's own permission;
// one ending in "…" is put in the message box for the user to finish.
// A starter made with fromFile() works from a file ("dari dokumen ke formulir",
// §9.15): the panel asks for a photo, scan or PDF first, then puts the request
// in the message box with the file attached. Without a file (the user closes
// the picker, or may not attach) the same text goes into the message box to be
// finished with pasted text.
const ATTACH_STARTERS = new Set();
const fromFile = (starter) => { ATTACH_STARTERS.add(starter.text); return starter; };
const FILL_IT_TICKET = fromFile(q('Buat tiket IT dari tangkapan layar ini', 'isi_form', 'it_ticket.create'));
const FILL_REIMBURSEMENT = fromFile(q('Isi pengajuan reimbursement dari struk atau foto ini', 'isi_form', 'finance.request'));
const FILL_LEAD = fromFile(q('Buat lead dari kartu nama ini', 'isi_form', 'sales.customer.manage'));
const FILL_TASK = q('Buatkan tugas dari catatan ini: …', 'isi_form', 'task.create');
const FILL_GA_REPAIR = q('Laporkan kerusakan fasilitas ini ke GA: …', 'isi_form', 'ga.request.create');

const FOLLOW_UP_FIRST = q('Notifikasi mana yang perlu saya tindak lanjuti lebih dulu?', 'notifikasi_saya');
const TODAY = q('Apa yang perlu saya kerjakan hari ini?', 'pekerjaan_saya_hari_ini');
const WAITING_FOR_ME = q('Pengajuan apa saja yang menunggu keputusan saya?', 'persetujuan_menunggu_saya', 'approval.decide');
const MY_REQUESTS = q('Pengajuan saya sudah sampai mana?', 'pengajuan_saya');
const OLDEST_ESCALATION = q('Eskalasi apa yang paling lama terbuka di divisi saya?', 'eskalasi_terbuka');
const TARGETS_BEHIND = q('Target mana yang tertinggal kuartal ini?', 'target_realisasi');
const TEMPLATE_STARTERS = Object.freeze([
  q('Template dokumen apa saja yang tersedia untuk saya?', 'template_dokumen'),
  q('Apa saja yang perlu saya isi untuk membuat BAST dari template?', 'template_dokumen'),
]);
const SEARCH_STARTERS = Object.freeze([
  q('Cari dokumen dan tugas yang memuat kata "kontrak"', 'pencarian_global'),
  q('Cari semua yang memuat kata "laporan" di modul yang boleh saya buka', 'pencarian_global'),
]);
const DELEGATION_STARTERS = Object.freeze([
  q('Siapa yang menggantikan saya menyetujui, dan sampai kapan?', 'delegasi_persetujuan_saya'),
  q('Saya sedang menerima delegasi persetujuan dari siapa?', 'delegasi_persetujuan_saya'),
]);
const CHECKLIST_STARTERS = Object.freeze([
  q('Apa saja butir checklist onboarding bawaan, dan siapa penanggung jawabnya?', 'template_checklist_karyawan'),
  q('Divisi mana yang punya template checklist sendiri?', 'template_checklist_karyawan'),
]);
const MY_HR_TASKS = q('Tugas onboarding/offboarding saya apa saja dan kapan tenggatnya?', 'tugas_onboarding_saya');
const BATCH_WAITING = q('Batch Data Accurate mana yang menunggu keputusan saya, dan sudah berapa lama?', 'batch_data_accurate');
// Wave D2: the automatic review of a batch, for those who decide it (the decision stays theirs).
const BATCH_REVIEW = q('Periksa batch Accurate yang menunggu keputusan saya: apa yang janggal?', 'periksa_batch_accurate', 'approval.decide');
const REVENUE_VS_TARGET = q('Omzet bulan ini (sebelum PPN) dibanding target dan bulan lalu', 'omzet_sales');
const NOT_FULLY_SHIPPED = q('Order mana yang belum terkirim penuh?', 'status_sales_order');

const STARTERS = Object.freeze({
  // ---- daily work
  dashboard: {
    member: [TODAY, q('Tugas saya mana yang terlambat atau jatuh tempo minggu ini?', 'tugas_saya'), MY_REQUESTS],
    supervisor: [TODAY, WAITING_FOR_ME, q('Ringkas angka kunci divisi saya bulan ini', 'dashboard_divisi')],
    head: [TODAY, OLDEST_ESCALATION, TARGETS_BEHIND],
  },
  search: { member: SEARCH_STARTERS, supervisor: SEARCH_STARTERS, head: SEARCH_STARTERS },
  notifications: {
    member: [q('Notifikasi apa yang belum saya baca?', 'notifikasi_saya'), FOLLOW_UP_FIRST],
    supervisor: [q('Ringkas notifikasi saya yang belum dibaca', 'notifikasi_saya'), FOLLOW_UP_FIRST],
    head: [FOLLOW_UP_FIRST, q('Ringkas notifikasi saya yang belum dibaca', 'notifikasi_saya')],
  },
  tasks: {
    member: [
      q('Tugas saya apa saja, dan mana yang terlambat?', 'tugas_saya'),
      q('Tugas saya mana yang jatuh tempo 7 hari ke depan?', 'tugas_saya'),
      FILL_TASK,
    ],
    supervisor: [
      q('Task mana yang terlambat atau macet?', 'tugas_saya'),
      q('Siapa yang paling banyak memegang tugas di papan divisi saya?', 'ringkasan_papan'),
      FILL_TASK,
    ],
    head: [
      q('Ringkas tugas divisi saya: aktif, terlambat, dan jatuh tempo minggu ini', 'tugas_saya'),
      q('Tugas mana yang belum punya penanggung jawab?', 'ringkasan_papan'),
      FILL_TASK,
    ],
  },
  approvals: {
    member: [MY_REQUESTS, q('Pengajuan saya yang ditolak atau diminta revisi, apa alasannya?', 'pengajuan_saya')],
    supervisor: [WAITING_FOR_ME, q('Pengajuan mana yang sudah lewat tenggat keputusan saya?', 'persetujuan_menunggu_saya', 'approval.decide'), MY_REQUESTS],
    head: [WAITING_FOR_ME, q('Pengajuan mana yang paling lama menunggu keputusan saya?', 'persetujuan_menunggu_saya', 'approval.decide'), DELEGATION_STARTERS[0]],
  },
  'approval-delegations': { member: DELEGATION_STARTERS, supervisor: DELEGATION_STARTERS, head: DELEGATION_STARTERS },
  signatures: {
    member: [
      q('Dokumen apa yang menunggu tanda tangan saya?', 'tanda_tangan_saya'),
      q('Permintaan tanda tangan saya sudah ditandatangani belum?', 'tanda_tangan_saya'),
    ],
    supervisor: [
      q('Dokumen apa yang menunggu tanda tangan saya?', 'tanda_tangan_saya'),
      q('Dokumen mana yang sudah siap saya tanda tangani?', 'tanda_tangan_saya'),
    ],
    head: [
      q('Dokumen apa yang menunggu tanda tangan saya?', 'tanda_tangan_saya'),
      q('Permintaan tanda tangan mana yang ditolak, dan oleh siapa?', 'tanda_tangan_saya'),
    ],
  },
  documents: {
    member: [
      q('Carikan dokumen kontrak divisi saya', 'cari_dokumen'),
      q('Dokumen divisi saya mana yang masih draf?', 'cari_dokumen'),
    ],
    supervisor: [
      q('Dokumen divisi saya mana yang masih draf?', 'cari_dokumen'),
      q('Dokumen final apa saja yang dimiliki divisi saya?', 'cari_dokumen'),
    ],
    head: [
      q('Carikan dokumen kontrak divisi saya', 'cari_dokumen'),
      q('Dokumen apa saja yang sudah diarsipkan di divisi saya?', 'cari_dokumen'),
    ],
  },
  'division-storage': {
    member: [
      q('File apa saja yang baru tercatat di penyimpanan divisi saya?', 'dokumen_divisi'),
      q('Dokumen apa yang terakhir dibuat dari template di divisi saya?', 'dokumen_divisi'),
    ],
    supervisor: [
      q('File apa saja yang baru tercatat di penyimpanan divisi saya?', 'dokumen_divisi'),
      q('Siapa yang paling baru membuat dokumen di divisi saya?', 'dokumen_divisi'),
    ],
    head: [
      q('Ringkas isi penyimpanan divisi', 'dokumen_divisi'),
      q('Dokumen apa yang terakhir dibuat dari template di divisi saya?', 'dokumen_divisi'),
    ],
  },
  templates: { member: TEMPLATE_STARTERS, supervisor: TEMPLATE_STARTERS, head: TEMPLATE_STARTERS },
  'doc-templates': {
    member: TEMPLATE_STARTERS,
    supervisor: TEMPLATE_STARTERS,
    head: [...TEMPLATE_STARTERS, q('Template mana yang khusus untuk divisi saya?', 'template_dokumen')],
  },
  projects: {
    member: [
      q('Issue apa yang harus saya kerjakan di sprint ini?', 'issue_saya'),
      q('Proyek apa saja yang saya ikuti?', 'proyek_saya'),
    ],
    supervisor: [
      q('Bagaimana kondisi sprint aktif di proyek saya?', 'proyek_saya'),
      q('Issue saya mana yang terlambat?', 'issue_saya'),
    ],
    head: [
      q('Proyek saya mana yang paling banyak issue terlambat?', 'proyek_saya'),
      q('Bagaimana kondisi sprint aktif di proyek saya?', 'proyek_saya'),
    ],
  },

  // ---- Sales, Retail Commerce, Marketing
  'sales-pipeline': {
    member: [
      q('Customer dormant mana yang perlu saya hubungi minggu ini?', 'sales_perlu_tindakan'),
      q('Berapa customer saya di tiap tahap pipeline?', 'pipeline_sales'),
      q('Omzet saya bulan ini (sebelum PPN) dibanding target', 'omzet_sales'),
    ],
    supervisor: [
      q('Customer mana yang hampir jadi Lost?', 'sales_perlu_tindakan'),
      REVENUE_VS_TARGET,
      q('Lead mana yang belum dikunjungi 14 hari atau lebih?', 'sales_perlu_tindakan'),
    ],
    head: [
      q('Ringkas omzet (sebelum PPN) dan customer baru bulan ini', 'omzet_sales'),
      q('Channel mana yang omzetnya turun dibanding bulan lalu?', 'omzet_sales'),
      q('Berapa customer di tiap tahap pipeline, dan berapa yang Lost?', 'pipeline_sales'),
    ],
  },
  'sales-customers': {
    member: [
      q('Customer saya mana yang berstatus Dormant atau Lost?', 'customer_lead_sales'),
      q('Customer dormant mana yang perlu saya hubungi minggu ini?', 'sales_perlu_tindakan'),
      q('Customer mana yang punya faktur lewat jatuh tempo?', 'piutang_sales'),
    ],
    supervisor: [
      q('Customer mana yang berstatus Dormant, dan siapa salesnya?', 'customer_lead_sales'),
      q('Customer mana yang hampir jadi Lost?', 'sales_perlu_tindakan'),
      q('Customer mana yang tunggakannya paling lama?', 'piutang_sales'),
    ],
    head: [
      q('Berapa customer Aktif, Dormant, dan Lost saat ini?', 'pipeline_sales'),
      q('Customer mana yang hampir jadi Lost?', 'sales_perlu_tindakan'),
      q('Ringkas piutang penjualan menurut umur', 'piutang_sales'),
    ],
  },
  'sales-leads': {
    member: [
      q('Lead mana yang belum saya kunjungi 14 hari atau lebih?', 'sales_perlu_tindakan'),
      q('Outlet mana yang sebaiknya saya kunjungi ulang?', 'customer_lead_sales'),
      FILL_LEAD,
    ],
    supervisor: [
      q('Ringkas catatan kunjungan lead yang belum jadi customer', 'customer_lead_sales'),
      q('Lead mana yang belum dikunjungi 14 hari atau lebih?', 'sales_perlu_tindakan'),
      FILL_LEAD,
    ],
    head: [
      q('Berapa lead yang sudah dikunjungi tetapi belum order?', 'pipeline_sales'),
      q('Lead mana yang paling lama tidak dikunjungi?', 'sales_perlu_tindakan'),
      FILL_LEAD,
    ],
  },
  'sales-orders': {
    member: [NOT_FULLY_SHIPPED, q('Faktur mana yang lewat jatuh tempo, dan sudah berapa hari?', 'piutang_sales')],
    supervisor: [q('SO mana yang sudah terkirim tetapi belum difaktur?', 'status_sales_order'), REVENUE_VS_TARGET, NOT_FULLY_SHIPPED],
    head: [
      q('Channel mana yang omzetnya turun?', 'omzet_sales'),
      q('Ringkas piutang penjualan menurut umur', 'piutang_sales'),
      NOT_FULLY_SHIPPED,
    ],
  },
  'accurate-batches': {
    member: [q('Batch Data Accurate mana yang masih menunggu keputusan, dan sudah berapa lama?', 'batch_data_accurate')],
    supervisor: [BATCH_REVIEW, BATCH_WAITING, q('Ringkas isi batch Accurate yang menunggu keputusan saya', 'batch_data_accurate')],
    head: [BATCH_REVIEW, BATCH_WAITING, q('Batch Data Accurate mana yang ditolak atau ditarik kembali?', 'batch_data_accurate')],
  },
  'retail-commerce': {
    member: [
      q('Pesanan marketplace mana yang belum terkirim atau terlambat?', 'pengiriman_marketplace_tertunda'),
      q('Produk apa yang paling laris di marketplace?', 'produk_terlaris_marketplace'),
    ],
    supervisor: [
      q('Bagaimana penjualan tiap marketplace pada bulan terakhir yang sudah berfaktur?', 'ringkasan_marketplace'),
      q('Tagihan marketplace mana yang lewat jatuh tempo?', 'tagihan_marketplace_belum_lunas'),
    ],
    head: [
      q('Marketplace mana yang penjualannya terbesar, dan mana yang turun?', 'ringkasan_marketplace'),
      q('Tagihan marketplace mana yang belum lunas?', 'tagihan_marketplace_belum_lunas'),
    ],
  },
  'marketing-insights': {
    member: [
      q('Produk apa yang paling naik dan paling turun bulan ini?', 'penjualan_channel_dan_produk'),
      q('Berapa customer baru bulan ini per channel?', 'lead_dan_customer_baru'),
    ],
    supervisor: [
      q('Channel mana yang penjualannya paling besar bulan ini (sebelum PPN)?', 'penjualan_channel_dan_produk'),
      q('Area mana yang paling banyak lead baru?', 'lead_dan_customer_baru'),
    ],
    head: [
      q('Ringkas penjualan per channel bulan ini dibanding bulan lalu', 'penjualan_channel_dan_produk'),
      q('Berapa lead yang sudah jadi customer bulan ini?', 'lead_dan_customer_baru'),
    ],
  },
  'marketing-campaigns': {
    member: [
      q('Kampanye apa yang sedang berjalan?', 'daftar_kampanye'),
      q('Kampanye mana yang sudah lewat tanggal selesainya?', 'daftar_kampanye'),
    ],
    supervisor: [
      q('Kampanye mana yang perlu ditutup dan dicatat hasilnya?', 'daftar_kampanye'),
      q('Bagaimana hasil kampanye yang sedang berjalan?', 'hasil_kampanye'),
    ],
    head: [
      q('Kampanye mana yang paling menaikkan penjualan produk sasarannya?', 'hasil_kampanye'),
      q('Kampanye apa yang sedang berjalan?', 'daftar_kampanye'),
    ],
  },

  // ---- Finance
  finance: {
    member: [
      q('Pengajuan pembayaran saya sudah sampai mana?', 'pengajuan_pembayaran_saya'),
      q('Pengajuan saya mana yang diminta revisi?', 'pengajuan_pembayaran_perlu_tindakan'),
      FILL_REIMBURSEMENT,
    ],
    supervisor: [
      q('Pengajuan mana yang menunggu keputusan saya?', 'pengajuan_pembayaran_perlu_tindakan'),
      q('Pengajuan pembayaran saya sudah sampai mana?', 'pengajuan_pembayaran_saya'),
      FILL_REIMBURSEMENT,
    ],
    head: [
      q('Pengajuan mana yang menunggu keputusan saya?', 'pengajuan_pembayaran_perlu_tindakan'),
      q('Pengajuan divisi saya mana yang belum dibayar?', 'daftar_pengajuan_pembayaran'),
      FILL_REIMBURSEMENT,
    ],
  },
  'finance-receivables': {
    member: [
      q('Ringkas posisi piutang dan perkiraan DSO', 'ringkasan_piutang'),
      q('Faktur mana yang jatuh tempo 14 hari ke depan?', 'ringkasan_piutang'),
    ],
    supervisor: [
      q('Ringkas posisi piutang dan perkiraan DSO', 'ringkasan_piutang'),
      q('Customer mana yang tunggakannya terbesar?', 'ringkasan_piutang'),
    ],
    head: [
      q('Ringkas posisi piutang dan perkiraan DSO', 'ringkasan_piutang'),
      q('Berapa piutang yang sudah lewat 90 hari, dan dari channel mana?', 'ringkasan_piutang'),
    ],
  },
  'finance-payables': {
    member: [
      q('Faktur pembelian mana yang segera jatuh tempo?', 'ringkasan_utang'),
      q('Ringkas posisi utang menurut umur', 'ringkasan_utang'),
    ],
    supervisor: [
      q('Faktur pembelian mana yang paling lama terlambat?', 'ringkasan_utang'),
      q('Ringkas posisi utang menurut umur', 'ringkasan_utang'),
    ],
    head: [
      q('Pemasok mana yang utangnya terbesar?', 'ringkasan_utang'),
      q('Ringkas posisi utang menurut umur', 'ringkasan_utang'),
    ],
  },

  // ---- People & Culture, GA
  'hr-onboarding': {
    member: [MY_HR_TASKS, q('Onboarding mana yang sedang berjalan, dan berapa tugasnya yang terlambat?', 'daftar_onboarding_offboarding')],
    supervisor: [
      q('Onboarding mana yang punya tugas terlambat?', 'daftar_onboarding_offboarding'),
      q('Onboarding mana yang masih menunggu persetujuan?', 'daftar_onboarding_offboarding'),
    ],
    head: [
      q('Ringkas onboarding yang sedang berjalan per status', 'daftar_onboarding_offboarding'),
      q('Karyawan baru mana yang masuk dalam waktu dekat?', 'daftar_onboarding_offboarding'),
    ],
  },
  'hr-offboarding': {
    member: [MY_HR_TASKS, q('Offboarding mana yang sedang berjalan, dan berapa tugasnya yang terlambat?', 'daftar_onboarding_offboarding')],
    supervisor: [
      q('Offboarding mana yang punya tugas terlambat?', 'daftar_onboarding_offboarding'),
      q('Offboarding mana yang masih menunggu persetujuan?', 'daftar_onboarding_offboarding'),
    ],
    head: [
      q('Ringkas offboarding yang sedang berjalan per status', 'daftar_onboarding_offboarding'),
      q('Karyawan mana yang hari terakhirnya dalam waktu dekat?', 'daftar_onboarding_offboarding'),
    ],
  },
  'hr-workflows': {
    member: [MY_HR_TASKS, q('Tugas checklist apa yang masih terbuka di alur ini?', 'status_onboarding_offboarding')],
    supervisor: [
      q('Alur ini sedang menunggu keputusan siapa?', 'status_onboarding_offboarding'),
      q('Tugas checklist apa yang masih terbuka di alur ini?', 'status_onboarding_offboarding'),
    ],
    head: [
      q('Alur ini sedang menunggu keputusan siapa?', 'status_onboarding_offboarding'),
      q('Tugas mana di alur ini yang sudah lewat tenggat, dan siapa penanggung jawabnya?', 'status_onboarding_offboarding'),
    ],
  },
  'hr-checklists': { member: CHECKLIST_STARTERS, supervisor: CHECKLIST_STARTERS, head: CHECKLIST_STARTERS },
  'people-directory': {
    member: [
      q('Siapa saja di divisi saya, dan siapa atasannya?', 'direktori_karyawan'),
      q('Siapa yang menangani IT?', 'direktori_karyawan'),
    ],
    supervisor: [
      q('Siapa saja anggota divisi saya?', 'direktori_karyawan'),
      q('Siapa yang menangani pajak di Finance?', 'direktori_karyawan'),
    ],
    head: [
      q('Siapa saja Head tiap divisi?', 'direktori_karyawan'),
      q('Siapa saja anggota divisi saya?', 'direktori_karyawan'),
    ],
  },
  'ga-services': {
    member: [
      q('Permintaan GA saya sudah sampai mana?', 'layanan_ga_saya'),
      q('Ruang rapat apa yang terpakai hari ini?', 'pemesanan_ruang'),
      FILL_GA_REPAIR,
    ],
    supervisor: [
      q('Permintaan GA apa yang menunggu persetujuan saya?', 'layanan_ga_saya'),
      q('Bagaimana jadwal ruang rapat minggu ini?', 'pemesanan_ruang'),
      FILL_GA_REPAIR,
    ],
    head: [
      q('Permintaan GA apa yang menunggu persetujuan saya?', 'layanan_ga_saya'),
      q('Permintaan GA saya sudah sampai mana?', 'layanan_ga_saya'),
      FILL_GA_REPAIR,
    ],
  },
  'ga-operations': {
    member: [
      q('Perawatan berkala apa yang lewat jadwal atau jatuh tempo minggu ini?', 'operasional_ga'),
      q('Kontrak dan sewa mana yang segera berakhir?', 'operasional_ga'),
    ],
    supervisor: [
      q('Kontrak dan sewa mana yang segera berakhir?', 'operasional_ga'),
      q('Tagihan utilitas mana yang lewat jatuh tempo?', 'operasional_ga'),
      q('Berapa nominal tagihan utilitas bulan ini per lokasi?', 'tagihan_utilitas_ga'),
    ],
    head: [
      q('Apa saja yang perlu ditindak di Operasional GA minggu ini?', 'operasional_ga'),
      q('Kontrak dan sewa mana yang segera berakhir?', 'operasional_ga'),
      q('Berapa nominal tagihan utilitas bulan ini per lokasi?', 'tagihan_utilitas_ga'),
    ],
  },

  // ---- IT
  'it-tickets': {
    member: [
      q('Tiket IT saya sudah sampai mana?', 'tiket_it'),
      q('Perangkat apa yang tercatat atas nama saya?', 'perangkat_saya'),
      FILL_IT_TICKET,
    ],
    supervisor: [
      q('Tiket IT saya sudah sampai mana?', 'tiket_it'),
      q('Tiket mana yang paling lama terbuka?', 'tiket_it'),
      FILL_IT_TICKET,
    ],
    head: [
      q('Ringkas tiket IT yang belum selesai menurut prioritas', 'tiket_it'),
      q('Tiket mana yang paling lama terbuka?', 'tiket_it'),
      FILL_IT_TICKET,
    ],
  },
  'it-dashboard': {
    member: [
      q('Apa yang perlu ditindak di IT hari ini?', 'ringkasan_it'),
      q('Berapa perangkat yang garansinya habis dalam 60 hari?', 'ringkasan_it'),
    ],
    supervisor: [
      q('Ringkas kondisi IT hari ini', 'ringkasan_it'),
      q('Berapa lisensi software yang menganggur?', 'ringkasan_it'),
    ],
    head: [
      q('Ringkas kondisi IT hari ini', 'ringkasan_it'),
      q('Perpanjangan langganan apa yang jatuh tempo 30 hari ke depan?', 'langganan_software'),
    ],
  },
  devices: {
    member: [
      q('Perangkat mana yang garansinya segera habis?', 'perangkat_it'),
      q('Perangkat mana yang belum dikembalikan?', 'perangkat_it'),
    ],
    supervisor: [
      q('Perangkat mana yang masih dipegang karyawan yang sudah resign?', 'perangkat_it'),
      q('Perangkat mana yang belum punya pemegang?', 'perangkat_it'),
    ],
    head: [
      q('Ringkas perangkat yang bermasalah dan yang garansinya segera habis', 'perangkat_it'),
      q('Perangkat mana yang belum dikembalikan?', 'perangkat_it'),
    ],
  },
  subscriptions: {
    member: [
      q('Lisensi software mana yang menganggur?', 'langganan_software'),
      q('Langganan mana yang perpanjangannya jatuh tempo 30 hari ke depan?', 'langganan_software'),
    ],
    supervisor: [
      q('Lisensi software mana yang menganggur?', 'langganan_software'),
      q('Langganan mana yang perpanjangannya jatuh tempo 30 hari ke depan?', 'langganan_software'),
      q('Langganan software mana yang paling mahal?', 'biaya_langganan_software'),
    ],
    head: [
      q('Lisensi software mana yang menganggur?', 'langganan_software'),
      q('Berapa biaya yang terbuang untuk lisensi menganggur?', 'biaya_langganan_software'),
      q('Langganan mana yang perpanjangannya jatuh tempo 30 hari ke depan?', 'langganan_software'),
    ],
  },
  'it-infrastructure': {
    member: [
      q('Register infrastruktur mana yang perlu ditinjau?', 'infrastruktur_it'),
      q('Bagaimana status backup tiap lokasi?', 'infrastruktur_it'),
    ],
    supervisor: [
      q('Kontrak ISP mana yang segera berakhir?', 'infrastruktur_it'),
      q('Lokasi mana yang punya kamera CCTV mati?', 'infrastruktur_it'),
    ],
    head: [
      q('Register infrastruktur mana yang perlu ditinjau?', 'infrastruktur_it'),
      q('Kapan review Google Workspace berikutnya, dan apa temuan terakhirnya?', 'infrastruktur_it'),
    ],
  },

  // ---- Management
  'division-dashboard': {
    member: [q('Ringkas angka kunci divisi saya bulan ini', 'dashboard_divisi')],
    supervisor: [
      q('Ringkas angka kunci divisi saya bulan ini', 'dashboard_divisi'),
      q('Metrik mana yang di bawah target bulan ini?', 'dashboard_divisi'),
    ],
    head: [
      q('Angka kunci mana yang perlu perhatian di divisi saya?', 'dashboard_divisi'),
      q('Metrik mana yang di bawah target bulan ini?', 'dashboard_divisi'),
      q('Ringkas angka rupiah dashboard divisi saya bulan ini', 'angka_rupiah_divisi'),
    ],
  },
  escalations: {
    member: [OLDEST_ESCALATION],
    supervisor: [OLDEST_ESCALATION, q('Eskalasi mana yang belum ada tindak lanjutnya?', 'eskalasi_terbuka')],
    head: [
      OLDEST_ESCALATION,
      q('Eskalasi mana yang belum ada tindak lanjutnya?', 'eskalasi_terbuka'),
      q('Sumber eskalasi apa yang paling banyak saat ini?', 'eskalasi_terbuka'),
    ],
  },
  roadmap: {
    member: [q('Proyek mana yang punya issue terlambat?', 'peta_program')],
    supervisor: [q('Proyek mana yang punya issue terlambat?', 'peta_program'), q('Ringkas progres proyek divisi saya', 'peta_program')],
    head: [
      q('Proyek mana yang punya issue terlambat?', 'peta_program'),
      q('Ringkas progres proyek divisi saya', 'peta_program'),
      q('Proyek mana yang sudah lewat tenggat tetapi belum selesai?', 'peta_program'),
    ],
  },
  targets: {
    member: [TARGETS_BEHIND],
    supervisor: [TARGETS_BEHIND, q('Metrik mana yang sudah tercapai bulan ini?', 'target_realisasi')],
    head: [
      TARGETS_BEHIND,
      q('Metrik mana yang sudah tercapai bulan ini?', 'target_realisasi'),
      q('Berapa realisasi rupiah dibanding targetnya bulan ini?', 'target_realisasi_rupiah'),
    ],
  },
  // Kalender: the user's own agenda (acara_kalender_saya); "Buat event" is added by FILL_STARTERS.
  calendar: {
    member: [q('Apa jadwal saya hari ini?', 'acara_kalender_saya'), q('Jadwal saya minggu ini apa saja?', 'acara_kalender_saya')],
    supervisor: [q('Apa jadwal saya hari ini?', 'acara_kalender_saya'), q('Jadwal saya minggu ini apa saja?', 'acara_kalender_saya')],
    head: [q('Apa jadwal saya hari ini?', 'acara_kalender_saya'), q('Jadwal saya minggu ini apa saja?', 'acara_kalender_saya')],
  },
  management: {
    member: [OLDEST_ESCALATION],
    supervisor: [OLDEST_ESCALATION, q('Angka kunci mana yang perlu perhatian?', 'dashboard_divisi')],
    head: [
      OLDEST_ESCALATION,
      q('Angka kunci mana yang perlu perhatian?', 'dashboard_divisi'),
      q('Apa pengecualian lintas divisi yang perlu perhatian?', 'eskalasi_terbuka', 'management_dashboard.view'),
    ],
  },
});

// Action starters of Wave C2 (docs/prakasa-ai-rencana.md §9.12): the forms a
// page's users can now have filled. Added AFTER the page's questions, one per
// role level (two pages spread two over the levels), so a level shows at most
// four of its own. `permission` is the form's own (forms/<modul>.js); a list
// means any of. A user without it never sees the starter.
const fill = (text, permission) => q(text, 'isi_form', permission);
const FILL_BOARD = fill('Buatkan board baru beserta kolomnya: …', 'board.manage');
const FILL_TASK_COMMENT = fill('Tulis komentar perkembangan untuk tugas ini: …', 'task.update');
const FILL_INBOUND = fromFile(fill('Catat barang masuk dari surat jalan ini', 'warehouse.movement.create'));
const FILL_INCIDENT = fill('Laporkan insiden gudang: …', 'warehouse.incident.manage');
const everyLevel = (starter) => ({ member: [starter], supervisor: [starter], head: [starter] });
const FILL_STARTERS = Object.freeze({
  tasks: { member: [FILL_TASK_COMMENT], supervisor: [FILL_BOARD], head: [FILL_BOARD] },
  calendar: everyLevel(fill('Buatkan event rapat besok jam 10 selama satu jam', 'meeting.create')),
  projects: everyLevel(fill('Buatkan issue baru dari uraian saya: …', 'google.chat.use')),
  'sales-orders': everyLevel(fill('Buat sales order untuk …: produk dan jumlahnya …', 'sales.order.manage')),
  'sales-customers': everyLevel(fill('Tambah pelanggan baru dari data ini: …', 'sales.customer.manage')),
  'marketing-campaigns': everyLevel(fill('Buat kampanye: nama, tujuan, tanggal, channel, produk target …', 'marketing.campaign.manage')),
  warehouse: { member: [FILL_INBOUND], supervisor: [FILL_INCIDENT], head: [FILL_INCIDENT] },
  escalations: everyLevel(fill('Tulis catatan tindak lanjut untuk eskalasi yang sedang saya buka: …', ['management_dashboard.view', 'management_dashboard.division'])),
  'ga-services': everyLevel(fill('Pinjam ruang rapat untuk besok jam …', 'ga.request.create')),
  'ga-operations': everyLevel(fill('Tambah jadwal perawatan: …', 'ga.ops.manage')),
  devices: everyLevel(fill('Tambahkan perangkat baru: …', 'device.manage')),
  'it-infrastructure': everyLevel(fill('Catat pemeriksaan backup hari ini: …', 'it.infra.manage')),
  'it-tickets': everyLevel(fill('Buatkan tanggapan untuk tiket ini: …', 'it_ticket.comment')),
  subscriptions: everyLevel(fill('Tambahkan langganan software: …', 'subscription.manage')),
  'hr-onboarding': everyLevel(fill('Buatkan draf onboarding untuk …', 'hrga.request')),
  'hr-offboarding': everyLevel(fill('Buatkan draf offboarding untuk … dengan hari terakhir …', 'hrga.request')),
  'hr-checklists': everyLevel(fill('Buat template checklist onboarding untuk divisi …', 'hrga.checklist_template.manage')),
  'people-directory': everyLevel(fill('Tambah orang tanpa akun ke direktori: …', 'people.directory.manage')),
  'doc-templates': everyLevel(fill('Buat template dokumen baru bernama …', 'template.manage')),
});
const MAX_OWN_STARTERS = 4;
function withFillStarters(key, starters) {
  const extra = FILL_STARTERS[key];
  if (!extra) return starters;
  const out = {};
  for (const level of ['member', 'supervisor', 'head']) {
    const own = starters[level] || [];
    out[level] = Object.freeze([...own, ...(extra[level] || [])].slice(0, Math.max(own.length, MAX_OWN_STARTERS)));
  }
  return out;
}

function tool(key, title, patterns, readPermission, extras = {}) {
  const actions = [...BASE_ACTIONS, ...(extras.actions || [])];
  const riskTier = actions.reduce(
    (highest, entry) => (RISK_TIERS.indexOf(entry.riskTier) > RISK_TIERS.indexOf(highest) ? entry.riskTier : highest),
    'read',
  );
  return Object.freeze({
    key,
    title,
    patterns: Object.freeze(patterns),
    readPermission,
    subjects: Object.freeze(extras.subjects || []),
    queryKeys: Object.freeze(extras.queryKeys || COMMON_QUERY_KEYS),
    starters: Object.freeze(withFillStarters(key, extras.starters || STARTERS[key] || {})),
    actions: Object.freeze(actions),
    riskTier,
    admin: Boolean(extras.admin),
    publishesState: extras.publishesState !== false,
  });
}

const admin = (key, title, patterns, permission, extras = {}) => tool(key, title, patterns, permission, {
  ...extras,
  admin: true,
  actions: [ADMIN_CHANGE_PREVIEW, ...(extras.actions || [])],
});

const TOOLS = Object.freeze([
  tool('dashboard', 'Beranda', ['/'], null),
  tool('search', 'Pencarian', ['/search'], 'search.global'),
  // The handbook: every signed-in user, content already cut to their role.
  tool('handbook', 'Panduan', ['/panduan'], null, {
    // Answered by the agent tool panduan_aplikasi, cut to the user's role.
    starters: {
      member: ['Bagaimana cara mengajukan pembayaran?', 'Bagaimana cara membuat tiket IT?'],
      supervisor: ['Bagaimana cara menyetujui atau menolak pengajuan?', 'Bagaimana cara mengajukan pembayaran?'],
      head: ['Apa tugas Head di aplikasi ini?', 'Bagaimana cara menyetujui atau menolak pengajuan?'],
    },
  }),
  tool('notifications', 'Notifikasi', ['/notifications'], 'notification.view', { actions: [PROPOSE_NOTIFICATION] }),
  // Akun saya: the user's own language and password; nothing for the AI to read
  // beyond the profile (profil_saya) and the handbook.
  tool('account', 'Akun saya', ['/akun'], null, {
    publishesState: false,
    starters: {
      member: ['Bagaimana cara mengganti bahasa tampilan?', 'Apa peran dan divisi saya di aplikasi ini?'],
      supervisor: ['Bagaimana cara mengganti bahasa tampilan?', 'Apa peran dan divisi saya di aplikasi ini?'],
      head: ['Bagaimana cara mengganti bahasa tampilan?', 'Apa peran dan divisi saya di aplikasi ini?'],
    },
  }),
  tool('ai-command', 'Pusat perintah AI', ['/ai-command'], 'ai_command.session.view', { publishesState: false }),
  tool('documents', 'Dokumen', ['/documents'], 'document.view', {
    actions: [PROPOSE_DOCUMENT],
  }),
  tool('division-storage', 'Penyimpanan divisi', ['/division-storage'], 'document.view', {
    actions: [PROPOSE_DOCUMENT],
  }),
  tool('my-drive', 'My Drive', ['/my-drive'], 'mydrive.view', { publishesState: false }),
  tool('notification-policy', 'Notifikasi & email', ['/admin/notification-policy'], 'notification.manage_rule', { publishesState: false }),
  tool('division-dashboard', 'Dashboard divisi', ['/division-dashboard'], ['division_dashboard.view', 'management_dashboard.view'], { publishesState: false, queryKeys: ['division'] }),
  tool('doc-templates', 'Template dokumen', ['/doc-templates'], 'template.view', { publishesState: false, queryKeys: ['tab'] }),
  tool('google-mail', 'Gmail', ['/mail'], 'google.mail.use', { publishesState: false }),
  tool('google-chat', 'Google Chat', ['/chat'], 'google.chat.use', { publishesState: false }),
  tool('projects', 'Project Tracker', ['/projects', '/projects/:spaceId'], 'google.chat.use', { publishesState: false }),
  tool('google-docs', 'Google Docs', ['/docs', '/docs/:fileId'], 'google.docs.use', { publishesState: false }),
  tool('google-sheets', 'Google Sheets', ['/sheets', '/sheets/:fileId'], 'google.docs.use', { publishesState: false }),
  tool('google-slides', 'Google Slides', ['/slides', '/slides/:fileId'], 'google.docs.use', { publishesState: false }),
  tool('google-groups', 'Groups', ['/groups'], 'google.groups.view', { publishesState: false }),
  tool('google-analytics', 'Google Analytics', ['/analytics'], 'analytics.view', { publishesState: false }),
  tool('templates', 'Template', ['/templates'], 'template.view', { actions: [PROPOSE_DOCUMENT] }),
  tool('tasks', 'Tugas', ['/tasks', '/tasks/:id'], 'task.view', {
    subjects: [{ pattern: '/tasks/:id', type: 'task', params: ['id'] }],
    actions: [PROPOSE_TASK, PROPOSE_TASK_UPDATE],
  }),
  tool('approvals', 'Persetujuan', ['/approvals', '/approvals/:id'], 'approval.view', {
    subjects: [{ pattern: '/approvals/:id', type: 'approval_request', params: ['id'] }],
    actions: [PROPOSE_APPROVAL, RECOMMEND_DECISION],
  }),
  tool('approval-delegations', 'Delegasi persetujuan', ['/admin/approval-delegations'], 'approval_delegation.view'),
  tool('signatures', 'Tanda tangan', ['/signatures', '/signatures/:id'], 'signature.view', { actions: [RECOMMEND_DECISION] }),
  tool('signature-asset', 'Tanda tangan saya', ['/signatures/asset'], 'signature.manage_asset', { publishesState: false }),
  tool('letterhead', 'Cap surat', ['/signatures/letterhead'], 'letterhead.view', { publishesState: false }),
  tool('calendar', 'Kalender', ['/calendar'], 'meeting.view', { publishesState: false }),
  tool('it-tickets', 'Tiket IT', ['/it/tickets', '/it/tickets/new', '/it/tickets/:id'], 'it_ticket.view', {
    subjects: [{ pattern: '/it/tickets/:id', type: 'it_ticket', params: ['id'] }],
    actions: [RECOMMEND_DECISION],
  }),
  tool('sales-pipeline', 'Pipeline sales', ['/sales/pipeline'], 'sales.pipeline.view', {
    queryKeys: ['tahap'],
  }),
  tool('sales-customers', 'Pelanggan', ['/sales/customers', '/sales/customers/:id'], 'sales.customer.view', {
    queryKeys: ['status', 'channel'],
  }),
  tool('sales-print', 'Cetak dokumen sales', ['/print/sales/:doc/:id'], 'sales.order.view', { publishesState: false }),
  tool('sales-leads', 'Leads', ['/sales/leads'], 'sales.customer.view', {
    queryKeys: ['status', 'lead'],
  }),
  tool('sales-orders', 'Data Sales', ['/sales/orders', '/sales/orders/new', '/sales/orders/:id', '/sales/orders/:id/edit', '/sales/orders/accurate/:id'], 'sales.order.view', {
    queryKeys: ['tab', 'periode', 'channel', 'status'],
  }),
  // Proposers (accurate.write.request) open the page for "Pengajuan ke
  // Accurate" and "Selisih pelanggan" (owner, 3 Oct 2026); a proposal has its own page.
  tool('accurate-batches', 'Data Accurate', ['/data-accurate', '/data-accurate/pengajuan/:id', '/data-accurate/:id'], ['accurate.batch.view', 'sales.master.manage', 'warehouse.accurate.sync', 'procurement.accurate.sync', 'accurate.write.request'], {
    queryKeys: ['status', 'view'],
  }),
  // Movements, or stock from Accurate only (Management Office oversight) — the same as the menu.
  // Open to whoever opens any Warehouse page (navigation.js): the union of the
  // group's entries. Every standard role with a narrower code also reads stock or movements.
  tool('warehouse', 'Warehouse', ['/warehouse', '/warehouse/movements', '/warehouse/stock', '/warehouse/shipping', '/warehouse/operations', '/warehouse/movements/:type/new', '/warehouse/movements/:type/:id', '/warehouse/movements/:type/:id/edit'],
    ['warehouse.movement.view', 'warehouse.stock.view', 'warehouse.recon.view', 'warehouse.checklist.view', 'warehouse.incident.view'], {
    subjects: [
      { pattern: '/warehouse/movements/:type/:id', type: 'warehouse_movement', params: ['type', 'id'] },
      { pattern: '/warehouse/movements/:type/:id/edit', type: 'warehouse_movement', params: ['type', 'id'] },
    ],
    queryKeys: ['tab', 'status', 'q', 'from', 'to', 'page', 'version', 'nomor_so'],
    actions: [
      action('extract_movement_lines', 'Ekstrak baris barang dari dokumen sumber', 'draft', { permission: 'warehouse.movement.create' }),
      action('compare_movement_source', 'Bandingkan barang dengan dokumen sumber', 'read', { permission: 'warehouse.movement.view' }),
      action('recommend_movement_decision', 'Rekomendasikan setujui, revisi, atau tolak', 'controlled_decision', { permission: 'warehouse.movement.approve' }),
    ],
    starters: {
      // Stock questions need warehouse.stock.view; the movement documents (pergerakan_gudang) need
      // warehouse.movement.view — outside the Warehouse division only approved or cancelled ones.
      // One plain starter per level stays: it is answered from what the page publishes, for every role.
      member: [
        { text: 'Barang apa yang stoknya menipis atau habis?', permission: 'warehouse.stock.view' },
        'Ekstrak baris barang dari packing list atau invoice',
        q('Barang masuk dan keluar apa saja minggu ini?', 'pergerakan_gudang'),
      ],
      supervisor: [
        { text: 'SO mana yang stoknya kurang untuk dikirim minggu ini?', permission: 'warehouse.stock.view' },
        'Cari selisih jumlah, satuan, batch, atau kedaluwarsa',
        q('Dokumen pergerakan mana yang menunggu persetujuan?', 'pergerakan_gudang'),
      ],
      head: [
        { text: 'Ringkas gudang hari ini: kiriman, PO yang datang, dan stok minus', permission: 'warehouse.stock.view' },
        'Rangkum riwayat barang keluar bulan ini',
        q('Dokumen pergerakan mana yang ditolak atau dibatalkan bulan ini?', 'pergerakan_gudang'),
      ],
    },
  }),
  tool('it-dashboard', 'Dashboard IT', ['/it/dashboard'], 'it.dashboard.view'),
  tool('devices', 'Perangkat', ['/it/devices', '/it/devices/:id'], 'device.view'),
  tool('subscriptions', 'Langganan software', ['/it/subscriptions', '/it/subscriptions/:id'], 'subscription.view', { actions: [RECOMMEND_DECISION] }),
  // Network data (IP addresses, models, firmware) is a network map: the page never
  // publishes its state to Prakasa AI. The agent tool infrastruktur_it reads status,
  // dates and counts per location only — never addresses, credentials or the layout.
  tool('it-infrastructure', 'Infrastruktur IT', ['/it/infrastructure'], 'it.infra.view', { publishesState: false, queryKeys: ['tab'] }),
  tool('finance', 'Pengajuan pembayaran', ['/finance/payment-requests', '/finance/payment-requests/:id'], ['finance.request', 'finance.view'], {
    actions: [RECOMMEND_DECISION],
  }),
  tool('hr-onboarding', 'Onboarding', ['/hrga/onboarding'], 'hrga.view', { actions: [PROPOSE_TASK] }),
  tool('hr-offboarding', 'Offboarding', ['/hrga/offboarding'], 'hrga.view', { actions: [PROPOSE_TASK] }),
  tool('hr-workflows', 'Workflow HRGA', ['/hrga/workflows/:id'], 'hrga.view', { actions: [RECOMMEND_DECISION] }),
  tool('hr-checklists', 'Template checklist', ['/hrga/checklist-templates'], 'hrga.checklist_template.manage'),
  tool('people-directory', 'Direktori', ['/people/directory', '/people/directory/:key'], 'people.directory.view'),
  // Layanan GA and Operasional GA: the pages publish no state; Prakasa AI reads
  // them through its own tools (ai/agent/tools/ga.js — own requests, room agenda,
  // upkeep/contracts/bills; bill amounts only for Supervisor/Head in a private chat).
  tool('ga-services', 'Layanan GA', ['/ga', '/ga/requests/:id', '/ga/bookings/:id'], 'ga.request.create', { publishesState: false }),
  tool('ga-operations', 'Operasional GA', ['/ga/operations'], 'ga.ops.view', { publishesState: false, queryKeys: ['tab'] }),
  tool('finance-receivables', 'Piutang', ['/finance/receivables', '/coming-soon/finance'], 'finance.receivable.view', { publishesState: false, queryKeys: ['tab'] }),
  tool('finance-payables', 'Utang', ['/finance/payables'], 'finance.payable.view', { publishesState: false, queryKeys: ['tab'] }),
  tool('procurement', 'Procurement', ['/procurement', '/procurement/orders', '/procurement/vendors', '/procurement/reorder', '/coming-soon/procurement'], ['procurement.view', 'procurement.reorder.view'], {
    queryKeys: ['tab', 'state', 'urgency', 'q', 'filter', 'from', 'to', 'page', 'nomor_po', 'kode_pemasok'],
    starters: {
      member: ['PO mana yang terlambat datang, dan dari pemasok siapa?', 'Barang apa saja yang datang hari ini?'],
      supervisor: ['Pemasok mana yang paling sering terlambat 90 hari terakhir?', { text: 'Barang apa yang hari-cukupnya kurang dari 7 hari?', permission: ['procurement.reorder.view', 'warehouse.stock.view'] }],
      head: ['Ringkas PO yang jatuh tempo minggu ini dan risikonya', { text: 'Barang apa yang hari-cukupnya kurang dari 7 hari?', permission: ['procurement.reorder.view', 'warehouse.stock.view'] }],
    },
  }),
  tool('retail-commerce', 'Retail Commerce', ['/retail-commerce', '/retail-commerce/pending', '/coming-soon/retail-commerce'], 'retail.insight.view', { publishesState: false }),
  tool('marketing-insights', 'Produk & channel', ['/marketing/insights', '/coming-soon/marketing'], 'marketing.insight.view', { publishesState: false, queryKeys: ['month', 'tab'] }),
  tool('marketing-campaigns', 'Kampanye', ['/marketing/campaigns'], 'marketing.insight.view', { publishesState: false, queryKeys: ['open'] }),
  // Either permission opens the page: the entity-wide view, or a division
  // Head's view of their own division. Must mirror navigation.js.
  tool('escalations', 'Pusat eskalasi', ['/escalations'], ['management_dashboard.view', 'management_dashboard.division']),
  tool('roadmap', 'Peta program', ['/roadmap'], ['management_dashboard.view', 'management_dashboard.division']),
  tool('targets', 'Target & realisasi', ['/targets'], ['management_dashboard.view', 'management_dashboard.division']),
  tool('management', 'Dashboard manajemen', ['/management'], ['management_dashboard.view', 'management_dashboard.division']),
  // Program 3.3: management only; the page publishes no state (it carries
  // purchase-price estimates and stock values Prakasa AI never reads).
  tool('management-flow', 'Alur & margin', ['/management/flow'], 'management_dashboard.view', { publishesState: false }),
  admin('users', 'Pengguna', ['/admin/users'], 'user.manage', { publishesState: false }),
  admin('workspace-sync', 'Sinkronisasi Workspace', ['/admin/workspace-sync'], 'user.manage', { publishesState: false }),
  admin('entities', 'Entitas', ['/admin/entities'], 'entity.manage'),
  admin('departments', 'Divisi', ['/admin/departments'], 'department.manage'),
  admin('roles', 'Peran', ['/admin/roles'], 'role.manage'),
  admin('permissions', 'Izin akses', ['/admin/permissions'], 'permission.manage'),
  admin('folder-rules', 'Aturan folder', ['/admin/folder-rules'], 'folder_rule.manage'),
  admin('document-types', 'Jenis dokumen', ['/admin/document-types'], 'document_type.manage'),
  admin('signature-rules', 'Aturan tanda tangan', ['/admin/signature-rules'], 'signature_rule.view'),
  admin('integration-logs', 'Log integrasi', ['/admin/integration-logs'], 'integration_log.view'),
  admin('approval-matrix', 'Matriks approval', ['/admin/approval-matrix'], 'approval_matrix.view'),
  admin('signature-precheck', 'Cek awal tanda tangan', ['/admin/signature-precheck'], 'signature_precheck.view'),
  admin('ai-usage', 'Pemakaian AI', ['/admin/ai-usage'], 'ai_command.usage.view'),
  admin('ai-provider-settings', 'Pengaturan penyedia AI', ['/admin/ai-provider-settings'], 'ai.provider.manage', { publishesState: false }),
  admin('accurate-integration', 'Integrasi Accurate', ['/admin/accurate'], 'integration.accurate.manage', { publishesState: false }),
  admin('activity-logs', 'Log aktivitas', ['/activity-logs'], 'activity_log.view'),
]);

const TOOLS_BY_KEY = new Map(TOOLS.map((entry) => [entry.key, entry]));

function splitPath(pathname) {
  return String(pathname || '').split('?')[0].split('#')[0].split('/').filter(Boolean);
}

function matchPattern(pattern, segments) {
  const parts = splitPath(pattern);
  if (parts.length !== segments.length) return null;
  const params = {};
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index].startsWith(':')) {
      params[parts[index].slice(1)] = decodeURIComponent(segments[index]);
    } else if (parts[index] !== segments[index]) {
      return null;
    }
  }
  return params;
}

// Most specific pattern wins: more literal segments beat parameters.
function resolveTool(pathname) {
  const segments = splitPath(pathname);
  let best = null;
  for (const entry of TOOLS) {
    for (const pattern of entry.patterns) {
      const params = matchPattern(pattern, segments);
      if (!params) continue;
      const literals = splitPath(pattern).filter((part) => !part.startsWith(':')).length;
      if (!best || literals > best.literals) best = { tool: entry, pattern, params, literals };
    }
  }
  if (!best) return null;
  const subject = best.tool.subjects.find((entry) => entry.pattern === best.pattern) || null;
  return { tool: best.tool, pattern: best.pattern, params: best.params, subject };
}

const hasPerm = (user, code) => (user?.permissions || []).includes(code);

function canRead(user, entry) {
  if (!entry.readPermission) return true;
  const required = Array.isArray(entry.readPermission) ? entry.readPermission : [entry.readPermission];
  return required.some((code) => hasPerm(user, code));
}

function toolError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function assertToolAccess({ user, tool: entry, operation = 'read' }) {
  if (!entry) throw toolError('Alat tidak dikenal', 404, 'AI_TOOL_UNKNOWN');
  if (!canRead(user, entry)) throw toolError('Anda tidak memiliki akses ke alat ini', 403, 'FORBIDDEN');
  if (operation !== 'read') {
    const found = entry.actions.find((candidate) => candidate.key === operation);
    if (!found) throw toolError('Aksi AI tidak dikenal untuk alat ini', 404, 'AI_TOOL_ACTION_UNKNOWN');
    if (found.permission && !hasPerm(user, found.permission)) {
      throw toolError('Anda tidak memiliki izin untuk aksi ini', 403, 'FORBIDDEN');
    }
  }
  return true;
}

const starterText = (s) => (typeof s === 'string' ? s : s.text);
const holdsAny = (user, codes) => [].concat(codes || []).some((code) => hasPerm(user, code));
// Loaded on first use: agentTools reads this file's TOOLS while it loads.
// eslint-disable-next-line global-require
const agentToolByName = (name) => require('./ai/agent/agentTools').byName.get(name);
// A starter is shown only to a user who can get its answer: one that names the
// agent tool answering it (`tool`) needs that tool's permission (any of them),
// one that names `permission` needs it (any of them); both when both are given.
// Without a user, only plain starters are shown.
function starterAllowed(s, user) {
  if (typeof s === 'string') return true;
  if (!user) return false;
  if (s.tool) {
    const answering = agentToolByName(s.tool);
    if (!answering || (answering.permission && !holdsAny(user, answering.permission))) return false;
  }
  return !s.permission || holdsAny(user, s.permission);
}

// A page with no agent data tool yet (PENDING in moduleCoverage.js) shows only
// the generic starters: its own starters would ask for data Prakasa AI cannot read.
function startersFor(entry, level, user = null) {
  const declared = isPending(entry.key) ? [] : (entry.starters[level] || (level === 'admin' ? entry.starters.head : null) || []);
  const own = declared.filter((s) => starterAllowed(s, user)).map(starterText);
  const generic = [
    `Jelaskan halaman ${entry.title} dan apa yang bisa saya lakukan di sini`,
    'Ringkas data yang sedang terlihat',
    'Cari data yang kosong atau tidak konsisten',
  ];
  const byLevel = {
    member: 'Bantu saya menyiapkan draft untuk langkah berikutnya',
    supervisor: 'Apa yang perlu saya review atau tindak lanjuti?',
    head: 'Apa tren, risiko, atau pengecualian yang perlu saya perhatikan?',
    admin: entry.admin ? 'Jelaskan dampak perubahan konfigurasi di halaman ini' : 'Apa yang perlu saya periksa di sini?',
  };
  return [...own, ...generic, byLevel[level] || byLevel.member].slice(0, 6);
}

// Pages that no longer render (frontend components/navigation.js BLOCKED_ROUTES;
// the browser refuses these routes for every role). Their entry and its agent
// tools stay — the data is still served — but a page that can never be opened
// shows no starters.
const RETIRED_PAGE_ROUTES = Object.freeze(['/approvals', '/admin/approval-delegations', '/documents', '/templates']);
const neverRenders = (entry) => entry.patterns.every((pattern) => RETIRED_PAGE_ROUTES.some((to) => pattern === to || pattern.startsWith(`${to}/`)));

function toolDto(entry, user, level = 'member') {
  const starters = neverRenders(entry) ? [] : startersFor(entry, level, user);
  return {
    key: entry.key,
    title: entry.title,
    patterns: entry.patterns,
    riskTier: entry.riskTier,
    admin: entry.admin,
    // false = the page never tells Prakasa AI what is on screen (not even its title).
    publishesState: entry.publishesState,
    queryKeys: entry.queryKeys,
    subjectTypes: [...new Set(entry.subjects.map((subject) => subject.type))],
    starters,
    // Of those, the ones that start by asking for a file (fromFile above).
    attachStarters: starters.filter((text) => ATTACH_STARTERS.has(text)),
    actions: entry.actions
      .filter((candidate) => !candidate.permission || hasPerm(user, candidate.permission))
      .map((candidate) => ({
        key: candidate.key,
        label: candidate.label,
        riskTier: candidate.riskTier,
        confirmationTier: candidate.confirmationTier,
        executorAvailable: Boolean(candidate.executor),
      })),
  };
}

function listToolsForUser(user, level = 'member') {
  return TOOLS.filter((entry) => canRead(user, entry)).map((entry) => toolDto(entry, user, level));
}

module.exports = {
  RISK_TIERS,
  ROLE_LEVELS,
  TOOLS,
  TOOLS_BY_KEY,
  resolveTool,
  canRead,
  assertToolAccess,
  listToolsForUser,
  toolDto,
  RETIRED_PAGE_ROUTES,
  neverRenders,
  startersFor,
  toolError,
};
