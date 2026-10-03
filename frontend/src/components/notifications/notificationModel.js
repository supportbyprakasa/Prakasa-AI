import { formatNumber } from '../format.js';
import { safeInAppPath } from '../safeHref.js';

// Notifications that can be acted on in place (program 1.2): a batch of Accurate
// data waiting for this person's decision can be approved straight from its
// notification. Rejecting needs a reason, so it stays on the batch page.
const BATCH_DECISION_EVENTS = new Set(['approval.step_activated', 'accurate.batch_reminder', 'accurate.batch_escalated']);

export function batchDecision(notification) {
  if (!notification || notification.subjectType !== 'approval_request') return null;
  if (!BATCH_DECISION_EVENTS.has(notification.event)) return null;
  const m = /^\/data-accurate\/(\d+)$/.exec(String(notification.actionUrl || ''));
  const approvalId = Number(notification.subjectId);
  if (!m || !Number.isInteger(approvalId) || approvalId <= 0) return null;
  return { approvalId, batchId: Number(m[1]) };
}

// What the person reads when approving from a notification fails.
export function decisionError(status, message) {
  if (status === 409) return 'Batch ini sudah diputuskan.';
  if (status === 403) return 'Anda tidak bisa memutuskan batch ini.';
  return message || 'Persetujuan gagal. Coba lagi dari halaman batch.';
}

// ── labels ───────────────────────────────────────────────────────────────
// The event codes the backend writes into notifications (backend/src, read
// only), grouped by module for the "Jenis" filter. Rows show the label, never
// the code; an unknown code gets a humanised fallback.
export const NOTIFICATION_EVENT_GROUPS = [
  { label: 'Task', icon: 'task_alt', events: [
    ['task.assigned', 'Task ditugaskan ke Anda'],
    ['task.reassigned', 'Task dialihkan'],
    ['task.comment', 'Komentar baru di task'],
    ['task.completed', 'Task selesai'],
    ['task.reopened', 'Task dibuka lagi'],
    ['task.due_soon', 'Task segera jatuh tempo'],
    ['task.overdue', 'Task lewat jatuh tempo'],
  ] },
  { label: 'Persetujuan', icon: 'approval', events: [
    ['approval.step_activated', 'Menunggu persetujuan Anda'],
    ['approval.reminder', 'Pengingat persetujuan'],
    ['approval.escalated', 'Persetujuan dieskalasi'],
    ['approval.approved', 'Pengajuan disetujui'],
    ['approval.rejected', 'Pengajuan ditolak'],
    ['approval.revision_requested', 'Pengajuan perlu revisi'],
  ] },
  { label: 'Data Accurate', icon: 'sync', events: [
    ['accurate.batch_reminder', 'Pengingat batch data Accurate'],
    ['accurate.batch_escalated', 'Batch data Accurate dieskalasi'],
  ] },
  { label: 'Sales', icon: 'storefront', events: [
    ['sales.assigned', 'Data sales ditugaskan ke Anda'],
    ['sales.customer_dormant', 'Pelanggan mulai dormant'],
    ['sales.invoice_overdue', 'Faktur lewat jatuh tempo'],
  ] },
  { label: 'IT', icon: 'computer', events: [
    ['it_ticket.created', 'Tiket IT baru'],
    ['it_ticket.status_changed', 'Status tiket IT berubah'],
    ['it_ticket.commented', 'Komentar baru di tiket IT'],
    ['device.assigned', 'Perangkat diserahkan ke Anda'],
    ['license.assigned', 'Lisensi diberikan ke Anda'],
    ['it.warranty_expiring', 'Garansi perangkat segera berakhir'],
    ['it.device_return_late', 'Pengembalian perangkat terlambat'],
    ['it.subscription_renewal_due', 'Langganan segera diperpanjang'],
    ['it.invoice_pending', 'Tagihan langganan belum diproses'],
    ['it.payment_pending', 'Pembayaran langganan tertunda'],
    ['it.license_idle', 'Lisensi tidak terpakai'],
  ] },
  { label: 'Finance', icon: 'payments', events: [
    ['finance.approved', 'Pengajuan dana disetujui'],
    ['finance.rejected', 'Pengajuan dana ditolak'],
    ['finance.revision_requested', 'Pengajuan dana perlu revisi'],
  ] },
  { label: 'Onboarding & offboarding', icon: 'badge', events: [
    ['hrga.approved', 'Onboarding/offboarding disetujui'],
    ['hrga.rejected', 'Onboarding/offboarding ditolak'],
    ['hrga.revision_requested', 'Onboarding/offboarding perlu revisi'],
    ['hrga.in_progress', 'Onboarding/offboarding berjalan'],
    ['hrga.task_assigned', 'Tugas onboarding/offboarding untuk Anda'],
    ['hrga.task_due', 'Tugas checklist jatuh tempo'],
    ['hrga.task_overdue', 'Tugas checklist lewat tenggat'],
    ['hrga.task_unassigned', 'Tugas belum punya penanggung jawab'],
    ['hrga.last_day_open', 'Hari terakhir: akses/aset belum selesai'],
  ] },
  { label: 'Layanan GA', icon: 'room_service', events: [
    ['ga.request_new', 'Permintaan GA baru'],
    ['ga.request_status', 'Status permintaan GA berubah'],
    ['ga.request_assigned', 'Permintaan GA untuk Anda'],
    ['ga.request_due', 'Permintaan GA jatuh tempo besok'],
    ['ga.approval_requested', 'Layanan GA menunggu persetujuan Anda'],
    ['ga.booking_status', 'Status peminjaman berubah'],
    ['ga.booking_pending', 'Peminjaman kendaraan belum diputuskan'],
    ['ga.vehicle_late', 'Kendaraan belum dikembalikan'],
  ] },
  { label: 'Tanda tangan', icon: 'draw', events: [
    ['signature.requested', 'Permintaan tanda tangan'],
    ['signature.signed', 'Dokumen sudah ditandatangani'],
  ] },
  { label: 'Prakasa AI', icon: 'smart_toy', events: [
    ['ai.claude_team_limit', 'Batas pemakaian Claude Team'],
    ['ai.claude_team_logout', 'Claude Team perlu masuk ulang'],
  ] },
];

const EVENT_LABELS = Object.fromEntries(NOTIFICATION_EVENT_GROUPS.flatMap((g) => g.events));
const EVENT_ICONS = Object.fromEntries(NOTIFICATION_EVENT_GROUPS.flatMap((g) => g.events.map(([code]) => [code, g.icon])));

// What a notification (or a record in search) is about: subject_type codes.
export const SUBJECT_TYPE_LABELS = {
  task: 'Task',
  approval_request: 'Persetujuan',
  ga_request: 'Permintaan GA',
  ga_booking: 'Peminjaman',
  sales_customer: 'Pelanggan',
  sales_lead: 'Lead',
  sales_order: 'Sales order',
  sales_accurate_batch: 'Batch data Accurate',
  sales_accurate_sync: 'Sinkronisasi Accurate',
  it_ticket: 'Tiket IT',
  device: 'Perangkat',
  device_assignment: 'Serah terima perangkat',
  software_subscription: 'Langganan software',
  subscription_license: 'Lisensi langganan',
  subscription_invoice: 'Tagihan langganan',
  subscription_payment: 'Pembayaran langganan',
  finance_workflow: 'Pengajuan dana',
  hrga_workflow: 'Onboarding/offboarding',
  signature_request: 'Tanda tangan',
  document: 'Dokumen',
  ai_provider: 'Prakasa AI',
};

// The subjects a notification can point to, for the "Terkait" filter.
export const NOTIFICATION_SUBJECTS = [
  'task', 'approval_request', 'sales_customer', 'sales_lead', 'sales_order', 'it_ticket', 'device', 'device_assignment',
  'software_subscription', 'subscription_license', 'subscription_invoice', 'subscription_payment',
  'finance_workflow', 'hrga_workflow', 'signature_request', 'ai_provider',
].map((value) => ({ value, label: SUBJECT_TYPE_LABELS[value] }));

// "it_ticket.status_changed" → "It ticket status changed": readable, never a raw code.
export function humanizeCode(code) {
  const text = String(code || '').replace(/[._]+/g, ' ').trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

// Whether an event has a label of its own (an unknown code is shown
// humanised, which is not interface text to translate).
export const hasEventLabel = (code) => Boolean(EVENT_LABELS[code]) || !code;

export function eventLabel(code) {
  return EVENT_LABELS[code] || humanizeCode(code) || 'Notifikasi';
}

export function eventIcon(code) {
  return EVENT_ICONS[code] || 'notifications';
}

export function subjectLabel(code) {
  return SUBJECT_TYPE_LABELS[code] || humanizeCode(code);
}

// Only an in-app path may be opened from a notification or search result.
export function safeInternalPath(url) {
  const s = safeInAppPath(url);
  if (!s || s.includes('://')) return null;
  return s;
}

// Page description: "3 belum dibaca" / "Semua sudah dibaca".
export function unreadSummary(count) {
  const n = Number(count) || 0;
  return n > 0 ? `${formatNumber(n)} belum dibaca` : 'Semua notifikasi sudah dibaca';
}

// "Sampai" before "Dari" is a field error, not a request.
export function dateRangeError(from, to) {
  return from && to && from > to ? 'Tanggal akhir tidak boleh sebelum tanggal awal' : '';
}
