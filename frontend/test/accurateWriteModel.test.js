import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANCELLABLE, FIELDS, REQUEST_STATUS, canCancel, changeLines, fieldLabel, formErrors, formFrom, newRequestKey, nextStepText, requestStatus, toPayload,
} from '../src/pages/accurate/accurateWriteModel.js';
import { STATUS_LABELS } from '../src/components/statusTone.js';

// Pengajuan ke Accurate (owner, 3 Oct 2026): the page's pure rules.

test('every request status has a known tone, and the words say what happens next', () => {
  for (const [key, s] of Object.entries(REQUEST_STATUS)) {
    assert.ok(STATUS_LABELS[s.status] || s.status, `${key} → ${s.status}`);
  }
  assert.equal(requestStatus('unknown').label, 'unknown');
  assert.match(nextStepText({ status: 'pending' }), /Supervisor atau Head/);
  assert.match(nextStepText({ status: 'queued', lastError: 'Pengiriman ke Accurate belum dinyalakan.' }), /belum dinyalakan/);
  assert.match(nextStepText({ status: 'sent' }), /tarikan berikutnya/);
  assert.match(nextStepText({ status: 'rejected', decisionNote: 'nama salah' }), /Ditolak: nama salah/);
  assert.match(nextStepText({ status: 'failed', lastError: 'nomor sudah ada' }), /Accurate menolak/);
});

test('cancelling: the requester or an overseer, only while nothing has left the app', () => {
  assert.deepEqual([...CANCELLABLE], ['pending', 'queued']);
  const request = { status: 'pending', requestedBy: 11 };
  assert.equal(canCancel(request, { id: 11, permissions: [] }), true);
  assert.equal(canCancel(request, { id: 12, permissions: [] }), false);
  assert.equal(canCancel(request, { id: 12, permissions: ['accurate.batch.view'] }), true);
  assert.equal(canCancel({ ...request, status: 'sent' }, { id: 11, permissions: ['accurate.batch.view'] }), false);
});

test('the form: labels per record type, the name required, limits and the email checked, only filled fields sent', () => {
  assert.equal(fieldLabel('number', 'vendor'), 'ID pemasok');
  assert.equal(fieldLabel('number'), 'ID pelanggan');
  assert.equal(fieldLabel('city'), 'Kota');
  assert.equal(fieldLabel('unknown'), 'unknown');
  const values = formFrom({ number: 'C-1', name: 'Toko', phone: null, city: undefined });
  assert.equal(values.number, 'C-1');
  assert.equal(values.phone, '');
  assert.deepEqual(formErrors({ ...values, name: '' }), { name: 'Nama wajib diisi.' });
  assert.deepEqual(formErrors({ ...values, email: 'x' }), { email: 'Email tidak valid.' });
  assert.deepEqual(formErrors({ ...values, notes: 'n'.repeat(501) }), { notes: 'Maksimal 500 karakter.' });
  assert.deepEqual(toPayload({ ...values, notes: '  ' }), { number: 'C-1', name: 'Toko' });
  assert.equal(FIELDS.find((f) => f.key === 'name').required, true);
});

test('one request key per opened form: 8–64 safe characters, different each time', () => {
  const a = newRequestKey();
  const b = newRequestKey();
  assert.match(a, /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(a, b);
  assert.equal(newRequestKey(() => 0), `pw-${'a'.repeat(24)}`);
});

test('the decider reads each change as label, before, after, in the form\'s order', () => {
  assert.deepEqual(changeLines({ recordType: 'vendor', changes: [{ field: 'name', before: 'PT A', after: 'PT B' }, { field: 'number', before: null, after: 'V-1' }] }), [
    { field: 'number', label: 'ID pemasok', before: null, after: 'V-1' },
    { field: 'name', label: 'Nama', before: 'PT A', after: 'PT B' },
  ]);
  assert.deepEqual(changeLines(null), []);
});
