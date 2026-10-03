import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityDetails, activityLabel, isDueToday, isOverdue, mergeAssignees, taskDate, taskStatusLabel,
  TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS, validateTaskForm,
} from '../src/components/tasks/taskModel.js';

const NOW = new Date(2026, 8, 30, 10, 0, 0);

test('overdue and due-today follow the local calendar day and ignore finished tasks', () => {
  assert.equal(isOverdue({ dueDate: '2026-09-29', status: 'open' }, NOW), true);
  assert.equal(isOverdue({ dueDate: '2026-09-29', status: 'done' }, NOW), false);
  assert.equal(isOverdue({ dueDate: '2026-09-30', status: 'open' }, NOW), false);
  assert.equal(isDueToday({ dueDate: '2026-09-30T00:00:00.000Z', status: 'in_progress' }, NOW), true);
  assert.equal(isDueToday({ dueDate: null, status: 'open' }, NOW), false);
});

test('task wording is Indonesian and priorities use the shared labels', () => {
  assert.equal(taskStatusLabel('in_progress'), 'Dikerjakan');
  assert.equal(taskStatusLabel('completed'), 'Tuntas');
  assert.ok(TASK_STATUS_OPTIONS.some((o) => o.value === 'cancelled' && o.label === 'Dibatalkan'));
  assert.deepEqual(TASK_PRIORITY_OPTIONS.map((o) => o.label), ['Rendah', 'Normal', 'Tinggi', 'Mendesak']);
  assert.equal(taskDate('2026-09-30'), '30 Sep 2026');
  assert.equal(taskDate(null), '');
});

test('the assignee filter keeps people seen earlier, sorted by name', () => {
  const first = mergeAssignees([], [{ assigneeId: 7, assigneeName: 'Rina' }, { assigneeId: 3, assigneeName: 'Budi' }, { assigneeId: null }]);
  assert.deepEqual(first.map((o) => o.label), ['Budi', 'Rina']);
  const next = mergeAssignees(first, [{ assigneeId: 7, assigneeName: 'Rina' }]);
  assert.equal(next.length, 2);
  assert.equal(mergeAssignees(next, [{ assigneeId: 9 }]).find((o) => o.value === '9').label, 'Pengguna #9');
});

test('form errors land on the field that is wrong', () => {
  assert.deepEqual(validateTaskForm({ title: '  ' }), { title: 'Judul wajib diisi.' });
  assert.ok(validateTaskForm({ title: 'A', startDate: '2026-10-02', dueDate: '2026-10-01' }).dueDate);
  assert.ok(validateTaskForm({ title: 'A', assigneeId: '1.5' }).assigneeId);
  assert.ok(validateTaskForm({ title: 'A', progressPercent: '101' }).progressPercent);
  assert.deepEqual(validateTaskForm({ title: 'A', assigneeId: '', progressPercent: '40' }), {});
});

test('activity reads as sentences without internal ids', () => {
  assert.equal(activityLabel('task.watcher_added'), 'Pemantau ditambahkan');
  assert.equal(activityLabel('task.something_new'), 'Something new');
  assert.deepEqual(activityDetails({ from: 'open', to: 'in_progress' }), ['Terbuka → Dikerjakan']);
  assert.deepEqual(activityDetails({ fields: ['title', 'dueDate', 'mystery'] }), ['Diubah: judul, jatuh tempo']);
  assert.deepEqual(activityDetails({ fromColumnId: 3, toColumnId: 4, commentId: 9 }), []);
  assert.deepEqual(activityDetails(null), []);
});
