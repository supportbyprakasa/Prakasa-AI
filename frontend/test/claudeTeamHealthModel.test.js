import test from 'node:test';
import assert from 'node:assert/strict';
import { seatHealth } from '../src/pages/admin/claudeTeamHealthModel.js';

test('the seat reads as normal, nearly full, paused or logged out', () => {
  const base = { loggedIn: true, rateType: 'seven_day', utilization: 0.52, resetsAt: '2026-10-05T07:00:00Z', queue: { running: 1, waiting: 0, concurrent: 2 } };
  const normal = seatHealth(base);
  assert.equal(normal.tone, 'success');
  assert.equal(normal.pct, 52);
  assert.equal(normal.windowLabel, 'Batas mingguan');
  assert.equal(seatHealth({ ...base, rateType: 'overage' }).windowLabel, 'Batas pemakaian', 'an unknown window is named in words, not by its code');
  assert.match(normal.resetsAt, /WIB$/);
  assert.equal(normal.queue, '1 berjalan · 0 menunggu (maks 2 bersamaan)');
  assert.equal(seatHealth({ ...base, utilization: 0.86 }).tone, 'warning');
  assert.match(seatHealth({ ...base, cooldownUntil: '2026-10-01T07:00:00Z' }).headline, /^Kuota habis — dijeda sampai/);
  assert.equal(seatHealth({ ...base, loggedIn: false }).tone, 'error');
  assert.equal(seatHealth(null), null);
  assert.match(seatHealth({ ...base, reachable: false }).headline, /Runner tidak terjangkau/);
});
