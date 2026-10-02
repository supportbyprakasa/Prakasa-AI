const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../src/services/flowRules');

// Program 3.3: the one definition of the flow rules (flowRules.js).

test('stepStats: median, average and p90 (nearest rank); negatives and junk dropped', () => {
  assert.deepEqual(rules.stepStats([3, 0, 1, 10, 0]), { count: 5, avgDays: 2.8, medianDays: 1, p90Days: 10 });
  // MySQL hands DATEDIFF back as numbers, sums as strings: both are read.
  assert.deepEqual(rules.stepStats(['4', 2, null, -1, 'x', undefined, NaN]), { count: 2, avgDays: 3, medianDays: 3, p90Days: 4 });
  assert.deepEqual(rules.stepStats([1, 2, 3, 4]), { count: 4, avgDays: 2.5, medianDays: 2.5, p90Days: 4 });
  assert.deepEqual(rules.stepStats([]), { count: 0, avgDays: null, medianDays: null, p90Days: null });
  assert.deepEqual(rules.stepStats(null), { count: 0, avgDays: null, medianDays: null, p90Days: null });
  const ten = rules.stepStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(ten.p90Days, 9);
});

test('parsePeriod: presets counted on the WIB calendar, default 3 months', () => {
  const today = '2026-09-30';
  assert.deepEqual(rules.parsePeriod({ preset: 'month' }, today), { from: '2026-09-01', to: '2026-09-30', preset: 'month' });
  assert.deepEqual(rules.parsePeriod({ preset: 'prev' }, today), { from: '2026-08-01', to: '2026-08-31', preset: 'prev' });
  assert.deepEqual(rules.parsePeriod({ preset: '3m' }, today), { from: '2026-07-01', to: '2026-09-30', preset: '3m' });
  assert.deepEqual(rules.parsePeriod({}, today), { from: '2026-07-01', to: '2026-09-30', preset: '3m' });
  assert.deepEqual(rules.parsePeriod({ preset: 'ytd' }, today), { from: '2026-01-01', to: '2026-09-30', preset: 'ytd' });
  // Year boundaries.
  assert.deepEqual(rules.parsePeriod({ preset: 'prev' }, '2027-01-15'), { from: '2026-12-01', to: '2026-12-31', preset: 'prev' });
  assert.deepEqual(rules.parsePeriod({ preset: '3m' }, '2027-02-10'), { from: '2026-12-01', to: '2027-02-10', preset: '3m' });
  assert.deepEqual(rules.parsePeriod({ preset: 'prev' }, '2028-03-01'), { from: '2028-02-01', to: '2028-02-29', preset: 'prev' });
});

test('parsePeriod: an explicit range is used as given; bad ranges are 400', () => {
  assert.deepEqual(rules.parsePeriod({ from: '2026-02-03', to: '2026-05-04' }), { from: '2026-02-03', to: '2026-05-04', preset: null });
  const bad = (input, pattern) => assert.throws(() => rules.parsePeriod(input, '2026-09-30'), (e) => e.status === 400 && e.code === 'VALIDATION_ERROR' && pattern.test(e.message));
  bad({ from: '2026-05-04', to: '2026-02-03' }, /sebelum/);
  bad({ from: '2025-01-01', to: '2026-09-30' }, /366 hari/);
  bad({ from: '2026-02-30', to: '2026-03-01' }, /YYYY-MM-DD/);
  bad({ from: '2026-02-01' }, /YYYY-MM-DD/);
  bad({ preset: 'week' }, /tidak dikenal/);
  assert.doesNotThrow(() => rules.parsePeriod({ from: '2026-01-01', to: '2027-01-01' }));
});

test('every SQL fragment spells today in WIB and never takes the session date', () => {
  for (const sql of [rules.notBilledSql('f'), rules.notBilledRecentSql('f'), rules.TODAY]) {
    assert.doesNotMatch(sql, /CURDATE|NOW\(\)|CURRENT_DATE/);
  }
  assert.match(rules.notBilledSql('f'), /DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\) - INTERVAL 2 DAY/);
});

test('a surat jalan without faktur is judged only while the mirror can judge it', () => {
  const sql = rules.notBilledSql('f');
  assert.match(sql, /f\.stage = 'shipped'/);
  // The same hold as wh_so_fulfilment_accurate.judged: a waiting Sales batch may carry the faktur.
  assert.match(sql, /f\.data_through IS NULL OR f\.delivered_on \+ INTERVAL 2 DAY < f\.data_through/);
  assert.doesNotMatch(sql, /INTERVAL 30 DAY/, 'the page lists older ones too');
  assert.match(rules.notBilledRecentSql('f'), /f\.delivered_on >= DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\) - INTERVAL 30 DAY/);
});

test('no second definition of late shipping lives in the flow rules (owner decision: warehouse_so_late only)', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/services/flowRules'), 'utf8').split('\n')
    .filter((line) => !line.trim().startsWith('//')).join('\n');
  for (const name of ['shippableSql', 'soDueSql', 'soOpenSql', 'soLateSql', 'soStaleSql', 'SHIP_DAYS', 'SHIP_GRACE_DAYS', 'EPISODE_FACTOR', 'wh_so_open']) {
    assert.ok(!src.includes(name), `${name} must not be defined in flowRules`);
    assert.equal(rules[name], undefined, name);
  }
});

test('thresholds are the decided ones', () => {
  assert.equal(rules.BILL_GRACE_DAYS, 2);
  assert.equal(rules.BILL_WINDOW_DAYS, 30);
  assert.equal(rules.SLOW_DAYS, 60);
  assert.equal(rules.DEAD_DAYS, 90);
  assert.equal(rules.LOW_COVERAGE_PCT, 80);
  assert.deepEqual([...rules.PRESETS], ['month', 'prev', '3m', 'ytd']);
});
