// Which events notify in the app and which also send an email (owner, 1 Oct
// 2026: "tentukan langsung mana fitur yang harus ada notifikasi … dan mana
// yang butuh notifikasi email", for every feature of every division).
//
// The rule of thumb:
//   in-app  — something about YOUR work or YOUR request (assigned to you,
//             your request moved, a comment for you, a due date of yours);
//             NOT the small edits people already see in Project Tracker /
//             the Google Chat Space (moved, reordered, checklist, watchers…).
//   email   — only when someone must DECIDE or ACT and waiting costs the
//             company (approvals, signatures, data that waits for a
//             Supervisor/Head, onboarding/offboarding deadlines, company
//             assets not returned, money to be paid or renewed) — or when the
//             app itself stops working for everyone (AI disconnected).
//             Everything else stays in the app, so email stays worth reading.
//
// An administrator can still switch email on or off per event in
// notification_rules (channel 'email', is_active) — that override wins.
// Unknown events: in the app, no email.

const P = (inApp, email, why) => Object.freeze({ inApp, email, why });

const EVENTS = Object.freeze({
  // ---------------------------------------------------------------- approvals (every division)
  'approval.step_activated': P(true, true, 'Menunggu keputusan Anda'),
  'approval.reminder': P(true, true, 'Approval belum diputuskan'),
  'approval.escalated': P(true, true, 'Approval dinaikkan ke atasan'),
  'approval.decided': P(true, false, 'Hasil keputusan untuk pengaju'),

  // ---------------------------------------------------------------- Accurate data (Sales, RC, Warehouse, Procurement, Finance)
  'accurate.batch_reminder': P(true, true, 'Data Accurate menunggu persetujuan Supervisor/Head'),
  'accurate.batch_escalated': P(true, true, 'Data Accurate lama tidak diputuskan'),

  // ---------------------------------------------------------------- signatures & documents
  'signature.requested': P(true, true, 'Dokumen menunggu tanda tangan Anda'),
  'signature.signed': P(true, false, 'Dokumen Anda sudah ditandatangani'),

  // ---------------------------------------------------------------- Sales & Retail Commerce
  'sales.assigned': P(true, false, 'Pelanggan/leads diserahkan ke Anda'),
  'sales.customer_dormant': P(true, false, 'Pengingat pelanggan tidak order'),
  'sales.invoice_overdue': P(true, false, 'Pengingat faktur lewat jatuh tempo'),

  // ---------------------------------------------------------------- Finance
  'finance.payment_paid': P(true, true, 'Pengajuan pembayaran/reimbursement Anda sudah dibayar'),
  'finance.payment_rejected': P(true, true, 'Pengajuan pembayaran Anda ditolak'),
  'finance.payment_processing': P(true, false, 'Pengajuan Anda sedang diproses Finance'),
  'finance.ready_to_pay': P(true, true, 'Pengajuan disetujui, menunggu dibayar Finance'),

  // ---------------------------------------------------------------- People & Culture: onboarding / offboarding
  'hrga.task_assigned': P(true, true, 'Tugas onboarding/offboarding untuk Anda, ada tenggatnya'),
  'hrga.task_due': P(true, true, 'Tugas onboarding/offboarding jatuh tempo besok'),
  'hrga.task_overdue': P(true, true, 'Tugas onboarding/offboarding terlambat'),
  'hrga.task_unassigned': P(true, false, 'Tugas belum punya penanggung jawab'),
  'hrga.last_day_open': P(true, true, 'Hari terakhir karyawan, akses/aset belum beres'),

  // ---------------------------------------------------------------- People & Culture: IT
  'it_ticket.created': P(true, false, 'Tiket baru (salinan email sudah ke kotak support)'),
  'it_ticket.status_changed': P(true, false, 'Status tiket Anda berubah'),
  'it_ticket.commented': P(true, false, 'Tanggapan baru di tiket'),
  'device.assigned': P(true, false, 'Perangkat diserahkan ke Anda'),
  'license.assigned': P(true, false, 'Lisensi software diberikan ke Anda'),
  'it.device_return_late': P(true, true, 'Perangkat perusahaan belum dikembalikan'),
  'it.subscription_renewal_due': P(true, true, 'Langganan perlu diputuskan perpanjang/berhenti'),
  'it.payment_pending': P(true, true, 'Pembayaran langganan belum dilakukan'),
  'it.invoice_pending': P(true, false, 'Invoice langganan belum dicatat'),
  'it.warranty_expiring': P(true, false, 'Garansi perangkat akan habis'),
  'it.license_idle': P(true, false, 'Lisensi tidak terpakai'),

  // ---------------------------------------------------------------- People & Culture: GA
  'ga.request_new': P(true, false, 'Permintaan GA baru untuk diproses'),
  'ga.request_assigned': P(true, false, 'Permintaan GA ditugaskan ke Anda'),
  'ga.request_status': P(true, false, 'Status permintaan GA Anda berubah'),
  'ga.request_due': P(true, false, 'Permintaan GA jatuh tempo besok'),
  'ga.approval_requested': P(true, true, 'Permintaan GA menunggu persetujuan Anda'),
  'ga.booking_status': P(true, false, 'Status pemesanan ruang Anda berubah'),
  'ga.booking_pending': P(true, false, 'Pemesanan menunggu persetujuan'),
  'ga.vehicle_late': P(true, false, 'Kendaraan terlambat kembali (TrackCar)'),

  // ---------------------------------------------------------------- tasks & Project Tracker
  'task.assigned': P(true, false, 'Tugas untuk Anda'),
  'task.comment': P(true, false, 'Komentar di tugas Anda'),
  'task.comment_added': P(true, false, 'Komentar di tugas Anda'),
  'task.completed': P(true, false, 'Tugas yang Anda ikuti selesai'),
  'task.reopened': P(true, false, 'Tugas dibuka lagi'),
  'task.overdue': P(true, false, 'Tugas Anda lewat tenggat'),
  'task.created': P(false, false, 'Terlihat di papan & Space'),
  'task.updated': P(false, false, 'Perubahan kecil — terlihat di papan'),
  'task.moved': P(false, false, 'Perubahan kecil — terlihat di papan'),
  'task.status_changed': P(false, false, 'Perubahan kecil — terlihat di papan'),
  'task.deleted': P(false, false, 'Tercatat di aktivitas papan'),
  'task.watcher_added': P(false, false, 'Perubahan kecil'),
  'task.watcher_removed': P(false, false, 'Perubahan kecil'),
  'task.dependency_added': P(false, false, 'Perubahan kecil'),
  'task.dependency_removed': P(false, false, 'Perubahan kecil'),
  'task.checklist_added': P(false, false, 'Perubahan kecil'),
  'task.checklist_deleted': P(false, false, 'Perubahan kecil'),
  'task.checklist_completed': P(false, false, 'Perubahan kecil'),
  'task.checklist_reopened': P(false, false, 'Perubahan kecil'),
  'tracker.issue_created': P(true, false, 'Issue untuk Anda'),
  'tracker.comment_added': P(true, false, 'Komentar di issue Anda'),
  'tracker.completed': P(true, false, 'Issue yang Anda buat selesai'),
  'tracker.reopened': P(true, false, 'Issue dibuka lagi'),
  'tracker.issue_moved': P(false, false, 'Sudah diumumkan di Space Google Chat'),
  'tracker.status_changed': P(false, false, 'Sudah diumumkan di Space Google Chat'),
  'tracker.issue_updated': P(false, false, 'Perubahan kecil'),
  'tracker.issue_reordered': P(false, false, 'Perubahan kecil'),
  'tracker.issue_deleted': P(false, false, 'Tercatat di aktivitas project'),
  'tracker.sprint_changed': P(false, false, 'Terlihat di papan sprint'),
  'tracker.ticket_sync_failed': P(false, false, 'Tercatat di aktivitas issue dan terlihat di halaman tiket'),

  // ---------------------------------------------------------------- Prakasa AI (admins)
  'ai.claude_team_limit': P(true, false, 'Batas pemakaian AI hampir habis'),
  'ai.claude_team_logout': P(true, true, 'Prakasa AI terputus untuk semua pengguna'),

  // ---------------------------------------------------------------- Operasional GA, Marketing, Retail Commerce
  'ga_ops.maintenance_due': P(true, false, 'Perawatan berkala jatuh tempo'),
  'ga_ops.contract_ending': P(true, true, 'Kontrak/sewa segera berakhir — perlu keputusan'),
  'ga_ops.bill_overdue': P(true, true, 'Tagihan utilitas lewat jatuh tempo'),
  'marketing.campaign_ended': P(true, false, 'Kampanye berakhir — catat hasilnya'),
});

const DEFAULT = P(true, false, 'Bawaan: di aplikasi saja');

function policyFor(event) {
  return EVENTS[String(event || '')] || DEFAULT;
}

module.exports = { EVENTS, DEFAULT, policyFor };
