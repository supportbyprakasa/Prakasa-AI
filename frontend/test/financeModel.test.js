import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DOC_CHECK, PAYROLL_NOTE, REQUEST_STATUSES, attachmentTypeLabel, docCheck, financeMoney, historyText, lastDecisionNote,
  requestActions, requestPayload, stepStatusKey, summaryLines, totalOf, workflowTypeLabel,
} from '../src/pages/finance/financeModel.js';
import { STATUS_LABELS, statusTone } from '../src/components/statusTone.js';

const page = (name) => readFileSync(new URL(`../src/pages/finance/${name}`, import.meta.url), 'utf8');

test('amounts read in rupiah; an old request in another currency keeps its code', () => {
  assert.equal(financeMoney(1250000), 'Rp 1.250.000');
  assert.equal(financeMoney('1250000.00', 'IDR'), 'Rp 1.250.000');
  assert.equal(financeMoney(1250.5, 'USD'), 'USD 1.250,5');
  assert.equal(financeMoney(null), '—');
});

test('labels are Indonesian and every status, step and check result has a shared tone', () => {
  assert.equal(workflowTypeLabel('payment_request'), 'Pengajuan pembayaran');
  assert.equal(attachmentTypeLabel('bank_proof'), 'Bukti transfer');
  for (const status of REQUEST_STATUSES) assert.ok(STATUS_LABELS[status], `${status} has a label`);
  for (const { status } of Object.values(DOC_CHECK)) assert.ok(STATUS_LABELS[status], `${status} has a label`);
  for (const s of ['pending', 'approved', 'rejected', 'skipped', 'revision_requested', 'cancelled']) assert.ok(STATUS_LABELS[stepStatusKey(s)], s);
  assert.equal(stepStatusKey('weird'), 'pending');
  assert.equal(statusTone(docCheck('failed').status), 'error');
  assert.equal(statusTone(docCheck('passed').status), 'success');
  assert.equal(docCheck(undefined).label, 'Belum diperiksa');
});

test('the total follows subtotal + tax', () => {
  assert.equal(totalOf('1000000', '110000'), '1110000');
  assert.equal(totalOf('1000', ''), '1000');
  assert.equal(totalOf('', '5'), '');
});

test('a payment needs its payee; the body never carries the entity, division or requester', () => {
  const { errors } = requestPayload({ workflowType: 'payment_request', title: ' ', amount: '', totalAmount: '', taxAmount: '0' }, { create: true });
  assert.deepEqual(Object.keys(errors).sort(), ['amount', 'payeeName', 'title', 'totalAmount']);
  const { body } = requestPayload({
    workflowType: 'payment_request', title: ' Tagihan listrik ', description: 'Referensi: PLN Sep', category: 'Tagihan GA', payeeName: 'PT PLN',
    payeeBank: 'BRI', payeeAccountNumber: '0011', payeeAccountName: '', amount: '1000000', taxAmount: '', totalAmount: '1000000',
    requestedPaymentDate: '2026-10-05', dueDate: '', notes: '',
  }, { create: true });
  assert.deepEqual(body, {
    workflowType: 'payment_request', title: 'Tagihan listrik', description: 'Referensi: PLN Sep', category: 'Tagihan GA', amount: 1000000,
    taxAmount: 0, totalAmount: 1000000, requestedPaymentDate: '2026-10-05', dueDate: null, notes: null,
    payeeName: 'PT PLN', payeeBank: 'BRI', payeeAccountNumber: '0011', payeeAccountName: null,
  });
  for (const key of ['entityId', 'departmentId', 'requestedBy', 'status']) assert.equal(key in body, false, key);
  assert.equal(requestPayload({ workflowType: 'payment_request', title: 'A', payeeName: 'B', amount: '10', totalAmount: '5' }).errors.totalAmount, 'Total tidak boleh lebih kecil dari subtotal');
});

test('a reimbursement never sends a bank account, even one left in the form', () => {
  const { body } = requestPayload({
    workflowType: 'reimbursement', title: 'Taksi', payeeName: '', payeeBank: 'BCA', payeeAccountNumber: '1234567890', payeeAccountName: 'Budi',
    amount: '85000', taxAmount: '0', totalAmount: '85000',
  }, { create: true });
  for (const key of ['payeeName', 'payeeBank', 'payeeAccountNumber', 'payeeAccountName']) assert.equal(key in body, false, key);
  assert.equal(body.workflowType, 'reimbursement');
  assert.match(PAYROLL_NOTE, /rekening payroll karyawan \(data di KantorKu\)/);
  // The form shows the payroll note instead of bank fields for a reimbursement.
  const form = page('PaymentRequestForm.jsx');
  assert.match(form, /employee \? \(\s*<Banner tone="info" title=\{PAYROLL_NOTE\}>/);
});

test('header actions follow what the server allows: one primary, two secondary, the rest in the menu', () => {
  assert.deepEqual(requestActions({ can: { decide: true } }), { primary: ['approve'], secondary: ['decline', 'revise'], menu: [] });
  assert.deepEqual(requestActions({ can: { submit: true, edit: true, check: true, remove: true, cancel: true } }), { primary: ['submit'], secondary: ['edit'], menu: ['remove'] });
  assert.deepEqual(requestActions({ can: { process: true, markPaid: true, cancel: true } }), { primary: ['process'], secondary: ['paid'], menu: ['cancel'] });
  assert.deepEqual(requestActions({ can: { markPaid: true, cancel: true, attach: true } }), { primary: ['paid'], secondary: [], menu: ['cancel'] });
  assert.deepEqual(requestActions({ can: { cancel: true } }), { primary: [], secondary: [], menu: ['cancel'] });
  assert.deepEqual(requestActions({ can: { applyDecision: true } }), { primary: [], secondary: [], menu: ['applyDecision'] });
  assert.deepEqual(requestActions({}), { primary: [], secondary: [], menu: [] });
});

test('history and approval notes read in Indonesian', () => {
  assert.equal(historyText({ action: 'finance.paid', metadata: { accurateReference: 'BKK-01' } }), 'Ditandai dibayar — Nomor bukti di Accurate BKK-01');
  assert.equal(historyText({ action: 'finance.cancelled', metadata: { reason: 'Dobel' } }), 'Dibatalkan — Dobel');
  assert.equal(historyText({ action: 'something.else' }), 'Perubahan');
  assert.equal(lastDecisionNote([{ status: 'revision_requested', note: 'Nota asli' }, { status: 'pending', note: null }]), 'Nota asli');
  assert.equal(lastDecisionNote([]), null);
  assert.deepEqual(summaryLines('Invoice lengkap.\nDokumen opsional belum diunggah: po.\n'), ['Invoice lengkap.', 'Dokumen opsional belum diunggah: po.']);
  assert.deepEqual(summaryLines(null), []);
});

test('the pages carry no Jurnal.id, no "IDR" and no <pre>', () => {
  for (const name of ['PaymentRequests.jsx', 'PaymentRequestDetail.jsx', 'PaymentRequestForm.jsx', 'financeModel.js']) {
    const source = page(name);
    assert.doesNotMatch(source, /Jurnal\.id|jurnal/i, name);
    assert.doesNotMatch(source, /<pre[\s>]/, name);
    assert.doesNotMatch(source, /['"`]IDR /, name);
  }
});
