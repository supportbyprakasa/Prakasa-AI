import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KPI_DEFS, buildLineChart, deltaPercent, deltaTrend, formatCompact, formatDay, formatDelta,
  formatDuration, formatNumber, formatPercent, isValidCustomRange, kpiTiles, labelIndices,
  niceCeil, niceTicks, setupSteps, withShares, channelLabel, deviceLabel,
} from '../src/pages/google/analyticsModel.js';

test('number, percent, compact and date formatting (id-ID)', () => {
  assert.equal(formatNumber(1234567), '1.234.567');
  assert.equal(formatNumber('12.6'), '13');
  assert.equal(formatNumber(undefined), '0');
  assert.equal(formatPercent(0.4567), '45,7%');
  assert.equal(formatPercent(0), '0,0%');
  assert.equal(formatCompact(950), '950');
  assert.equal(formatCompact(1200), '1,2 rb');
  assert.equal(formatCompact(3_400_000), '3,4 jt');
  assert.equal(formatDay('2026-09-21'), '21 Sep');
  assert.equal(formatDay('2026-08-01', true), '1 Agu 2026');
  assert.equal(formatDay('bad'), '');
});

test('duration formatting', () => {
  assert.equal(formatDuration(0), '0 dtk');
  assert.equal(formatDuration(45.4), '45 dtk');
  assert.equal(formatDuration(125), '2 mnt 05 dtk');
  assert.equal(formatDuration(3720), '1 jam 02 mnt');
  assert.equal(formatDuration(-5), '0 dtk');
});

test('delta % vs previous period', () => {
  assert.equal(deltaPercent(150, 100), 50);
  assert.equal(deltaPercent(50, 100), -50);
  assert.equal(deltaPercent(0, 0), 0);
  assert.equal(deltaPercent(10, 0), null); // nothing to compare with
  assert.equal(formatDelta(12.345), '+12,3%');
  assert.equal(formatDelta(-4), '−4,0%');
  assert.equal(formatDelta(0.01), '0%');
  assert.equal(formatDelta(null), 'Baru');
});

test('trend: up is good except where lower is better (bounce rate)', () => {
  assert.equal(deltaTrend(10), 'good');
  assert.equal(deltaTrend(-10), 'bad');
  assert.equal(deltaTrend(10, true), 'bad');
  assert.equal(deltaTrend(-10, true), 'good');
  assert.equal(deltaTrend(0), 'flat');
  assert.equal(deltaTrend(null), 'none');
});

test('kpiTiles shapes every KPI in a fixed order, even when missing', () => {
  const tiles = kpiTiles([
    { key: 'bounceRate', value: 0.3, previous: 0.4 },
    { key: 'avgEngagementTime', value: 90, previous: 60 },
  ]);
  assert.deepEqual(tiles.map((t) => t.key), KPI_DEFS.map((d) => d.key));
  const bounce = tiles.find((t) => t.key === 'bounceRate');
  assert.equal(bounce.value, '30,0%');
  assert.equal(bounce.trend, 'good');
  assert.equal(tiles.find((t) => t.key === 'avgEngagementTime').value, '1 mnt 30 dtk');
  assert.equal(tiles.find((t) => t.key === 'sessions').deltaLabel, '0%');
});

test('nice axis scaling', () => {
  assert.equal(niceCeil(7), 10);
  assert.equal(niceCeil(23), 25);
  assert.equal(niceCeil(0.3), 0.5);
  assert.deepEqual(niceTicks(100), [0, 25, 50, 75, 100]);
  assert.deepEqual(niceTicks(101), [0, 50, 100, 150]);
  assert.deepEqual(niceTicks(3), [0, 1, 2, 3]);
  assert.deepEqual(niceTicks(0), [0, 1]); // flat-zero data still gets an axis
  for (const max of [1, 9, 37, 480, 12345]) {
    const ticks = niceTicks(max);
    assert.ok(ticks[ticks.length - 1] >= max, `top tick covers ${max}`);
    assert.ok(ticks.length >= 2 && ticks.length <= 6, `tick count for ${max}`);
  }
});

test('x label indices are evenly spread and include the last day', () => {
  assert.deepEqual(labelIndices(5, 7), [0, 1, 2, 3, 4]);
  const idx = labelIndices(28, 7);
  assert.equal(idx[0], 0);
  assert.equal(idx[idx.length - 1], 27);
  assert.ok(idx.length <= 7);
  assert.deepEqual(labelIndices(0, 7), []);
});

test('line chart geometry maps values into the plot area', () => {
  const points = [
    { date: '2026-09-01', activeUsers: 0, sessions: 0 },
    { date: '2026-09-02', activeUsers: 50, sessions: 100 },
    { date: '2026-09-03', activeUsers: 100, sessions: 80 },
  ];
  const pad = { top: 10, right: 10, bottom: 20, left: 40 };
  const chart = buildLineChart(points, { width: 250, height: 130, pad });
  // plot: x 40..240, y 10..110, top tick 100
  assert.equal(chart.x(0), 40);
  assert.equal(chart.x(2), 240);
  assert.equal(chart.y(0), 110);
  assert.equal(chart.y(100), 10);
  assert.equal(chart.lines[0].path, 'M40,110 L140,60 L240,10');
  assert.deepEqual(chart.lines[1].end, { x: 240, y: 30 });
  assert.equal(chart.yTicks[0].y, 110);
  assert.equal(chart.xLabels[2].label, '3 Sep');
  assert.equal(chart.indexAt(0), 0);
  assert.equal(chart.indexAt(130), 1);
  assert.equal(chart.indexAt(999), 2);
  const single = buildLineChart([points[1]], { width: 250, height: 130, pad });
  assert.equal(single.x(0), 140);
});

test('bar list shares and labels', () => {
  const rows = withShares([{ label: 'Direct', value: 75 }, { label: 'Referral', value: 25 }], channelLabel);
  assert.deepEqual(rows.map((r) => [r.label, r.share, r.bar]), [['Langsung', 75, 100], ['Rujukan', 25, (25 / 75) * 100]]);
  assert.deepEqual(withShares([]), []);
  assert.equal(deviceLabel('mobile'), 'Seluler');
  assert.equal(channelLabel('Something New'), 'Something New');
});

test('setup checklist marks the blocking step', () => {
  const states = (reason) => setupSteps(reason).map((s) => s.state);
  assert.deepEqual(states('NOT_CONFIGURED'), ['todo', 'waiting', 'waiting']);
  assert.deepEqual(states('API_DISABLED'), ['done', 'todo', 'waiting']);
  assert.deepEqual(states('NO_ACCESS'), ['done', 'done', 'todo']);
  assert.deepEqual(states('NO_PROPERTIES'), ['done', 'done', 'todo']);
});

test('custom range validation on the client mirrors the server', () => {
  assert.equal(isValidCustomRange('2026-09-01', '2026-09-10', '2026-09-28'), true);
  assert.equal(isValidCustomRange('2026-09-10', '2026-09-01', '2026-09-28'), false);
  assert.equal(isValidCustomRange('2026-09-01', '2026-10-01', '2026-09-28'), false);
  assert.equal(isValidCustomRange('', '2026-09-01', '2026-09-28'), false);
});
