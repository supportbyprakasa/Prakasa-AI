import test from 'node:test';
import assert from 'node:assert/strict';
import { areaPath, compactMoney, delta, formatMetric, linePath, motionScores, niceScale, rankScores, seriesPoints } from '../src/components/charts/chartModel.js';
import { headline, kpiGroups, motionSeries, trendCards } from '../src/pages/management/divisionDashboardModel.js';

// Dashboard charts and the division dashboard layout.

test('values read with their unit; rupiah shortens on charts', () => {
  assert.equal(compactMoney(1250000000), 'Rp 1,3 M');
  assert.equal(compactMoney(350000000), 'Rp 350 jt');
  assert.equal(formatMetric(87.25, '%'), '87,3%');
  assert.equal(formatMetric(2.5, 'hari'), '2,5 hari');
  assert.equal(formatMetric(1234, 'item'), '1.234');
  assert.equal(formatMetric(null, 'item'), '—');
});

test('scale includes zero and rounds to friendly steps; a missing month breaks the line', () => {
  const s = niceScale([12, 47, null, 30]);
  assert.equal(s.min, 0);
  assert.ok(s.max >= 47 && s.max <= 60);
  assert.deepEqual(s.ticks.slice(0, 2), [0, s.ticks[1]]);
  const pts = seriesPoints([10, null, 20, 30], { width: 300, height: 100, scale: { min: 0, max: 40 } });
  assert.equal(pts[1].y, null);
  assert.equal(linePath(pts).split('M').length - 1, 2, 'two segments');
  assert.match(areaPath(pts, 100), /Z$/);
});

test('delta: up is good for "higher", bad for "lower"', () => {
  assert.deepEqual(delta([1, null, 4, 6], 'higher'), { last: 6, prev: 4, change: 2, direction: 'up', good: true });
  assert.equal(delta([5, 3], 'lower').good, true);
  assert.equal(delta([null, 7]).change, null);
});

test('motion chart: vs target when set, else vs the best month; "lower is better" turned around; capped at 150', () => {
  const series = [
    { key: 'a', label: 'Pendapatan', unit: 'rupiah', better: 'higher', values: [50, 100, 80], targets: [null, null, 40] },
    { key: 'b', label: 'Hari kirim', unit: 'hari', better: 'lower', values: [4, 2, 8], targets: [] },
  ];
  const m0 = motionScores(series, 0);
  assert.deepEqual(m0.map((s) => [s.key, s.score, s.basis]), [['a', 50, 'best'], ['b', 50, 'best']]);
  const m2 = motionScores(series, 2);
  assert.deepEqual(m2.map((s) => [s.key, s.score, s.basis]), [['a', 150, 'target'], ['b', 25, 'best']]);
  assert.deepEqual(rankScores(m2).map((s) => s.key), ['a', 'b']);
});

test('the page: own modules first, trends need two months, the race needs movement', () => {
  const groups = kpiGroups([{ provider: 'approvals', providerLabel: 'Approval', key: 'p' }, { provider: 'sales', providerLabel: 'Sales', key: 'r' }]);
  assert.deepEqual(groups.map((g) => g.provider), ['sales', 'approvals']);
  const metrics = [
    { provider: 'sales', key: 'rev', label: 'Pendapatan', values: [1, 2, 3, null], targets: [] },
    { provider: 'sales', key: 'flat', label: 'Datar', values: [5, 5, 5, 5], targets: [] },
    { provider: 'approvals', key: 'one', label: 'Satu', values: [null, null, null, 2], targets: [] },
    { provider: 'approvals', key: 'zero', label: 'Nol', values: [0, 0, 0, 0], targets: [] },
  ];
  assert.deepEqual(trendCards(metrics).map((m) => m.key), ['flat', 'rev']);
  assert.deepEqual(motionSeries(metrics).map((m) => m.key), ['sales.rev']);
});

test('a trend card leads with the last complete month, not the month still running', () => {
  const months = [{ label: 'Agu 2026' }, { label: 'Sep 2026' }, { label: 'Okt 2026' }];
  const h = headline({ values: [63, 76, 0], better: 'higher' }, months);
  assert.deepEqual([h.value, h.month, h.prevMonth, h.change, h.good, h.running, h.runningMonth], [76, 'Sep 2026', 'Agu 2026', 13, true, 0, 'Okt 2026']);
  assert.equal(headline({ values: [5, 3, null], better: 'lower' }, months).good, true);
});
