import test from 'node:test';
import assert from 'node:assert/strict';
import { batchDecision, decisionError } from '../src/components/notifications/notificationModel.js';

const waiting = { event: 'accurate.batch_reminder', subjectType: 'approval_request', subjectId: 910, actionUrl: '/data-accurate/10' };

test('a waiting Accurate batch can be approved from its notification', () => {
  assert.deepEqual(batchDecision(waiting), { approvalId: 910, batchId: 10 });
  assert.deepEqual(batchDecision({ ...waiting, event: 'approval.step_activated' }), { approvalId: 910, batchId: 10 });
  assert.deepEqual(batchDecision({ ...waiting, event: 'accurate.batch_escalated', subjectId: '911' }), { approvalId: 911, batchId: 10 });
});

test('anything else offers no approve button', () => {
  assert.equal(batchDecision({ ...waiting, actionUrl: '/approvals/910' }), null, 'another kind of approval');
  assert.equal(batchDecision({ ...waiting, event: 'approval.approved' }), null, 'already decided');
  assert.equal(batchDecision({ ...waiting, subjectType: 'task' }), null);
  assert.equal(batchDecision({ ...waiting, subjectId: null }), null);
  assert.equal(batchDecision(null), null);
});

test('a failed approval says why in plain words', () => {
  assert.equal(decisionError(409), 'Batch ini sudah diputuskan.');
  assert.equal(decisionError(403), 'Anda tidak bisa memutuskan batch ini.');
  assert.equal(decisionError(500, 'Server sibuk'), 'Server sibuk');
});

test('event codes read as Indonesian labels, unknown ones are humanised', async () => {
  const { eventLabel, eventIcon, subjectLabel, NOTIFICATION_EVENT_GROUPS } = await import('../src/components/notifications/notificationModel.js');
  assert.equal(eventLabel('approval.step_activated'), 'Menunggu persetujuan Anda');
  assert.equal(eventLabel('task.assigned'), 'Task ditugaskan ke Anda');
  assert.equal(eventLabel('warehouse.movement_submitted'), 'Warehouse movement submitted');
  assert.equal(eventLabel(''), 'Notifikasi');
  assert.equal(eventIcon('it_ticket.created'), 'computer');
  assert.equal(eventIcon('unknown.event'), 'notifications');
  assert.equal(subjectLabel('approval_request'), 'Persetujuan');
  assert.equal(subjectLabel('some_new_thing'), 'Some new thing');
  const codes = NOTIFICATION_EVENT_GROUPS.flatMap((g) => g.events.map(([code]) => code));
  assert.equal(new Set(codes).size, codes.length, 'every event code is listed once');
  assert.ok(NOTIFICATION_EVENT_GROUPS.every((g) => g.events.every(([code, label]) => /^[a-z_]+\.[a-z_]+$/.test(code) && label && label[0] === label[0].toUpperCase())));
});

test('only in-app paths open; the header and the date range read plainly', async () => {
  const { safeInternalPath, unreadSummary, dateRangeError } = await import('../src/components/notifications/notificationModel.js');
  assert.equal(safeInternalPath('/data-accurate/12'), '/data-accurate/12');
  assert.equal(safeInternalPath(' /tasks/4 '), '/tasks/4');
  assert.equal(safeInternalPath('//evil.example'), null);
  assert.equal(safeInternalPath('https://evil.example'), null);
  assert.equal(safeInternalPath('/x?next=https://evil.example'), null);
  assert.equal(safeInternalPath(null), null);
  assert.equal(unreadSummary(3), '3 belum dibaca');
  assert.equal(unreadSummary(1250), '1.250 belum dibaca');
  assert.equal(unreadSummary(0), 'Semua notifikasi sudah dibaca');
  assert.equal(dateRangeError('2026-09-30', '2026-09-01'), 'Tanggal akhir tidak boleh sebelum tanggal awal');
  assert.equal(dateRangeError('2026-09-01', '2026-09-30'), '');
  assert.equal(dateRangeError('2026-09-01', ''), '');
});
