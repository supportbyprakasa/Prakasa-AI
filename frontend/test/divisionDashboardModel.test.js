import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionItems, headline, kpiGroups, motionSeries, overdueRows, targetProgress, trendCards } from '../src/pages/management/divisionDashboardModel.js';

// Dashboard divisi: the six sections of the one dashboard template.

const months = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
  .map((key, i) => ({ key, label: key, partial: i === 11 }));
const metric = (key, values, extra = {}) => ({ provider: 'it', providerLabel: 'IT', key, label: key, unit: 'item', better: 'higher', values, targets: values.map(() => null), ...extra });

test('section 1: KPIs group by module, the division\'s own modules first', () => {
  const groups = kpiGroups([
    { provider: 'approvals', providerLabel: 'Approval', key: 'a' },
    { provider: 'sales', providerLabel: 'Sales', key: 'b' },
    { provider: 'sales', providerLabel: 'Sales', key: 'c' },
  ]);
  assert.deepEqual(groups.map((g) => [g.provider, g.kpis.length]), [['sales', 2], ['approvals', 1]]);
});

test('section 2: open escalations per source become red bars; empty sources are left out', () => {
  const items = attentionItems({ total: 5, bySource: [{ key: 'it_ticket', label: 'Tiket IT', count: 4 }, { key: 'ga', label: 'GA', count: 1 }, { key: 'x', label: 'X', count: 0 }] });
  assert.deepEqual(items, [
    { key: 'it_ticket', label: 'Tiket IT', value: 4, display: '4', tone: 'error' },
    { key: 'ga', label: 'GA', value: 1, display: '1', tone: 'error' },
  ]);
  assert.deepEqual(attentionItems(null), []);
});

test('sections 3 and 4: the motion chart needs movement, a trend card needs two months', () => {
  const flat = metric('flat', [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
  const moving = metric('moving', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const zero = metric('zero', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(trendCards([flat, moving, zero]).map((m) => m.key), ['flat', 'moving']);
  assert.deepEqual(motionSeries([flat, moving, zero]).map((m) => m.key), ['it.moving']);
});

test('section 5: progress is the last complete month against its target; "lower is better" counts under the target as met', () => {
  const sold = metric('sold', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 80, 3], { targets: Array(10).fill(null).concat([100, 100]) });
  const late = metric('late', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 2, 9], { better: 'lower', unit: 'hari', targets: Array(10).fill(null).concat([3, 3]) });
  const over = metric('over', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 6, 9], { better: 'lower', unit: 'hari', targets: Array(10).fill(null).concat([3, 3]) });
  const noTarget = metric('none', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const noValue = metric('nov', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, null, 12], { targets: Array(10).fill(null).concat([5, 5]) });
  const out = targetProgress([sold, late, over, noTarget, noValue], months);
  assert.equal(out.month, '2026-09', 'the running month is never judged');
  assert.deepEqual(out.items.map((i) => [i.key, i.value, i.display, i.tone, i.met]), [
    ['it.over', 50, '50%', 'error', false],
    ['it.sold', 80, '80%', 'warning', false],
    ['it.late', 100, '100%', 'success', true],
  ]);
  assert.equal(out.items[1].note, '80 dari target 100');
  assert.deepEqual(targetProgress([sold], []), { month: null, items: [] });
});

test('section 6: the overdue rows get a stable id for the grid', () => {
  const rows = overdueRows({ top: [{ source: 'it_ticket', title: 'A', daysLate: 3 }, { source: 'it_ticket', title: 'B', daysLate: 1 }] });
  assert.deepEqual(rows.map((r) => r.id), ['it_ticket-0', 'it_ticket-1']);
  assert.deepEqual(overdueRows(undefined), []);
});

test('a trend card leads with the last complete month and compares it with the one before', () => {
  const head = headline(metric('m', [null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 4]), months);
  assert.deepEqual([head.value, head.month, head.prevMonth, head.change, head.direction, head.good, head.running], [12, '2026-09', '2026-08', 3, 'up', true, 4]);
});
