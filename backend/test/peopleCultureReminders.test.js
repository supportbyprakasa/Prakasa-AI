const test = require('node:test');
const assert = require('node:assert/strict');
const notif = require('../src/services/notification.service');
const { runOnce } = require('../src/jobs/peopleCultureReminders');

// Daily reminders (wave 2, §2.1.5): due tomorrow/today, overdue on day 1 then
// every 3 days, offboarding last day tomorrow with access/assets open. Every
// notification has a dedupeKey, so a rerun the same day sends nothing twice.

function fakeDb(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, args) {
      calls.push({ sql, args });
      if (/t\.due_date IN \(\?, \?\)/.test(sql)) return [rows.due];
      if (/t\.due_date < \?/.test(sql)) return [rows.late];
      if (/h\.last_working_date = \?/.test(sql)) return [rows.lastDay];
      return [[]];
    },
  };
}

test('reminders: due, overdue on day 1/4/7 only, last day tomorrow — each with a dedupe key', async (t) => {
  const sent = [];
  t.mock.method(notif, 'create', async (n) => { sent.push(n); return sent.length; });
  const late = (id, due) => ({ id, title: `Tugas ${id}`, due_day: due, responsible_user_id: 5, workflow_id: 9, entity_id: 1, employee_full_name: 'Ani', pic: 6 });
  const db = fakeDb({
    due: [{ id: 1, title: 'Meja', due_day: '2026-10-01', responsible_user_id: 5, workflow_id: 9, entity_id: 1, employee_full_name: 'Ani' }],
    late: [late(2, '2026-09-30'), late(3, '2026-09-29'), late(4, '2026-09-27'), late(5, '2026-09-24')],
    lastDay: [{ id: 11, entity_id: 1, employee_full_name: 'Budi', pic: 6, manager_user_id: 8, open_items: 2 }],
  });
  const out = await runOnce({ today: '2026-10-01', db });
  assert.deepEqual(db.calls[0].args, ['2026-10-01', '2026-10-02']);
  const keys = sent.map((n) => n.dedupeKey);
  assert.ok(keys.includes('hrga_task_due:1:2026-10-01:5'));
  // 1 day late → bucket 0 (responsible + PIC), 2 days → nothing, 4 days → bucket 1, 7 days → bucket 2.
  assert.ok(keys.includes('hrga_task_late:2:0:5') && keys.includes('hrga_task_late:2:0:6'));
  assert.ok(!keys.some((k) => k.startsWith('hrga_task_late:3:')));
  assert.ok(keys.includes('hrga_task_late:4:1:5'));
  assert.ok(keys.includes('hrga_task_late:5:2:6'));
  assert.ok(keys.includes('hrga_lastday:11:6') && keys.includes('hrga_lastday:11:8'));
  assert.ok(sent.every((n) => n.actionUrl.startsWith('/hrga/workflows/')), 'internal links only (S11)');
  assert.equal(out.created, sent.length);
  assert.match(db.calls[2].sql, /h\.workflow_type = 'offboarding'/);
  assert.match(db.calls[2].sql, /'access_revoke'/);
});
