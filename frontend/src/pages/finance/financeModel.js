// Pure helpers for the Finance payment request pages: labels, amounts, the
// request body with its field checks, and which actions a request offers.
// No React, so it is unit-tested (test/financeModel.test.js).
import { formatMoney, formatQty } from '../../components/format.js';

export const WORKFLOW_TYPES = [
  { value: 'payment_request', label: 'Pengajuan pembayaran' },
  { value: 'reimbursement', label: 'Reimbursement' },
];
export const workflowTypeLabel = (type) => WORKFLOW_TYPES.find((w) => w.value === type)?.label || type || '';

// A reimbursement pays an employee, whose bank account the app never stores
// (owner rule): it goes to the payroll account kept in KantorKu.
export const PAYROLL_NOTE = 'Dibayar ke rekening payroll karyawan (data di KantorKu)';

// The statuses a request goes through, in order (tones and labels from
// components/statusTone.js).
export const REQUEST_STATUSES = [
  'draft', 'pending_approval', 'revision_requested', 'approved', 'processing', 'paid', 'rejected', 'cancelled',
];

// Document check outcome → statusTone key + Indonesian label.
export const DOC_CHECK = {
  not_run: { status: 'pending', label: 'Belum diperiksa' },
  passed: { status: 'verified', label: 'Lengkap' },
  warning: { status: 'needs_review', label: 'Lengkap, ada catatan' },
  failed: { status: 'failed', label: 'Belum lengkap' },
};
export const docCheck = (value) => DOC_CHECK[value] || DOC_CHECK.not_run;

export const ATTACHMENT_TYPES = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'receipt', label: 'Kuitansi/nota' },
  { value: 'quotation', label: 'Penawaran harga' },
  { value: 'po', label: 'PO' },
  { value: 'bank_proof', label: 'Bukti transfer' },
  { value: 'tax_doc', label: 'Dokumen pajak' },
  { value: 'other', label: 'Lainnya' },
];
export const attachmentTypeLabel = (type) => ATTACHMENT_TYPES.find((a) => a.value === type)?.label || type || '';
export const ATTACHMENT_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const PAYEE_TYPES = { vendor: 'Pemasok', employee: 'Karyawan', other: 'Lainnya' };

// Rupiah through the shared formatter ("Rp 1.234.567"); an old request in
// another currency keeps its code ("USD 1.250,5").
export function financeMoney(value, currency = 'IDR') {
  if (!currency || currency === 'IDR') return formatMoney(value);
  const text = formatQty(value);
  return text === '—' ? text : `${currency} ${text}`;
}

// Subtotal + tax, as the total is filled in until someone types their own.
export function totalOf(amount, tax) {
  const a = Number(amount);
  const t = Number(tax || 0);
  if (amount === '' || amount === null || amount === undefined || !Number.isFinite(a) || !Number.isFinite(t)) return '';
  return String(Math.round((a + t) * 100) / 100);
}

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const amount = (value) => (value === '' || value === null || value === undefined ? NaN : Number(value));

/**
 * The form (strings) → { body } or { errors: { field: message } }. A
 * reimbursement never sends bank fields; a payment needs its payee. `create`
 * adds the type (the server sets the entity, the division and the requester).
 */
export function requestPayload(form, { create = false } = {}) {
  const employee = form.workflowType === 'reimbursement';
  const errors = {};
  if (!text(form.title)) errors.title = 'Isi judul pengajuan';
  if (!employee && !text(form.payeeName)) errors.payeeName = 'Isi nama penerima';
  if (!(amount(form.amount) >= 0)) errors.amount = 'Isi subtotal';
  if (form.taxAmount !== '' && form.taxAmount !== undefined && !(amount(form.taxAmount) >= 0)) errors.taxAmount = 'Pajak tidak boleh minus';
  if (!(amount(form.totalAmount) >= 0)) errors.totalAmount = 'Isi total';
  else if (amount(form.totalAmount) < amount(form.amount)) errors.totalAmount = 'Total tidak boleh lebih kecil dari subtotal';
  if (Object.keys(errors).length) return { errors };
  const body = {
    title: text(form.title),
    description: text(form.description),
    category: text(form.category),
    amount: amount(form.amount),
    taxAmount: Number(form.taxAmount || 0),
    totalAmount: amount(form.totalAmount),
    requestedPaymentDate: form.requestedPaymentDate || null,
    dueDate: form.dueDate || null,
    notes: text(form.notes),
  };
  if (!employee) {
    Object.assign(body, {
      payeeName: text(form.payeeName),
      payeeBank: text(form.payeeBank),
      payeeAccountNumber: text(form.payeeAccountNumber),
      payeeAccountName: text(form.payeeAccountName),
    });
  }
  return { body: create ? { workflowType: form.workflowType, ...body } : body };
}

// The document check notes as lines (the server joins them with line breaks).
export const summaryLines = (summary) => String(summary || '').split(/\n+/).map((p) => p.trim()).filter(Boolean);

/**
 * The header actions of a request, from what the server says the caller may
 * do (`can`): at most one primary and two secondary buttons; the rest in ⋮.
 * The document check lives on its own card, not in the header.
 */
export function requestActions(request) {
  const can = request?.can || {};
  const primary = [];
  const secondary = [];
  const menu = [];
  if (can.decide) {
    primary.push('approve');
    secondary.push('decline', 'revise');
  } else if (can.submit) {
    primary.push('submit');
  } else if (can.process) {
    primary.push('process');
    secondary.push('paid');
  } else if (can.markPaid) {
    primary.push('paid');
  }
  if (can.edit && secondary.length < 2) secondary.push('edit');
  else if (can.edit) menu.push('edit');
  if (can.applyDecision) menu.push('applyDecision');
  if (can.remove) menu.push('remove');
  else if (can.cancel) menu.push('cancel');
  return { primary, secondary, menu };
}

const HISTORY_LABELS = {
  'finance.create': 'Draf dibuat',
  'finance.update': 'Pengajuan diubah',
  'finance.attachment': 'Lampiran ditambahkan',
  'finance.attachment.upload': 'Lampiran ditambahkan',
  'finance.document_check': 'Dokumen diperiksa',
  'finance.submit': 'Diajukan untuk persetujuan',
  'finance.submit_approval': 'Diajukan untuk persetujuan',
  'finance.approved': 'Disetujui',
  'finance.rejected': 'Ditolak',
  'finance.revision_requested': 'Diminta revisi',
  'finance.processing': 'Diproses Finance',
  'finance.paid': 'Ditandai dibayar',
  'finance.cancelled': 'Dibatalkan',
  'finance.decision_denied': 'Keputusan ditolak sistem',
};
export const historyLabel = (action) => HISTORY_LABELS[action] || 'Perubahan';

/** One history line: the label and, when there is one, the note or reason. */
export function historyText(entry) {
  const meta = entry?.metadata || {};
  const detail = meta.reason || meta.note || (meta.accurateReference ? `Nomor bukti di Accurate ${meta.accurateReference}` : null);
  return detail ? `${historyLabel(entry?.action)} — ${detail}` : historyLabel(entry?.action);
}

/**
 * The same line in parts for <Mixed separator=" — ">: the label is interface
 * text; a reason or note is what a user typed (record data, never translated).
 */
export function historyParts(entry) {
  const meta = entry?.metadata || {};
  const typed = meta.reason || meta.note;
  const detail = typed ? { text: typed, data: true } : (meta.accurateReference ? `Nomor bukti di Accurate ${meta.accurateReference}` : null);
  return detail ? [historyLabel(entry?.action), detail] : [historyLabel(entry?.action)];
}

// An approval step's status → statusTone key (the shared table has them all).
export const stepStatusKey = (status) => (['pending', 'approved', 'rejected', 'skipped', 'revision_requested', 'cancelled'].includes(status) ? status : 'pending');

/** The latest decided note of the approval (the reason a request came back). */
export function lastDecisionNote(steps) {
  const decided = (steps || []).filter((s) => s.note && s.status !== 'pending');
  return decided.length ? decided[decided.length - 1].note : null;
}
