const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const quality = require('../src/services/accurateQuality.service');
const batches = require('../src/services/salesAccurateBatches.service');
const ctrl = require('../src/controllers/salesAccurate.controller');
const accurate = require('../src/management/providers/accurate');

// "Perlu dibereskan di Accurate" (program 1.4): read-only checks over approved
// Accurate data, each bound to the company and scoped to the division.

const writes = (calls) => calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(c.sql));

test('every check reads only this company, and only the division asked for', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return /COUNT\(\*\) AS n/.test(sql) ? [[{ n: 0 }]] : [[]]; });
  const out = await quality.list(7, { departmentId: 3 });
  assert.deepEqual(out.map((c) => c.key), ['stock_minus', 'stock_mismatch', 'transfer_not_received', 'future_date', 'so_stale', 'unit_names']);
  assert.equal(writes(calls).length, 0);
  for (const { sql, args } of calls) {
    const binds = (sql.match(/\?/g) || []).length;
    assert.equal(args.length, binds, sql);
    assert.equal(args.at(-1), 3, 'the division filter');
    if (!/COUNT\(\*\)/.test(sql)) assert.match(sql, /ORDER BY ABS\(q\.value\) DESC/, 'worst first, whatever the sign');
    assert.equal(args.slice(0, -1).every((a) => a === 7), true, `every other bind is the company: ${sql}`);
    assert.match(sql, /WHERE q\.department_id = \?/);
  }
});

test('the Management Office sees every division; each check says what to fix in Accurate', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    calls.push({ sql, args });
    if (/COUNT\(\*\) AS n/.test(sql)) return [[{ n: /trans_date > / .test(sql) ? 1 : 0 }]];
    if (/trans_date > /.test(sql)) return [[{ ref: 'SI9', name: 'Faktur', detail: '2026-12-03', value: '65' }]];
    return [[]];
  });
  const out = await quality.list(7);
  const future = out.find((c) => c.key === 'future_date');
  assert.deepEqual(future.rows, [{ ref: 'SI9', name: 'Faktur', detail: '2026-12-03', value: 65 }]);
  assert.equal(future.count, 1);
  assert.match(future.label, /lebih dari 7 hari/);
  for (const c of out) assert.ok(c.fix.length > 20, c.key);
  assert.ok(calls.every((c) => !/q\.department_id = \?/.test(c.sql)), 'no division filter');
  assert.match(calls.find((c) => /trans_date > /.test(c.sql)).sql, /DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\) \+ INTERVAL 7 DAY/, 'a planned delivery tomorrow is not a typo');
});

test('the page scopes the checks like the batches: own division, or all for management', async (t) => {
  t.mock.method(batches, 'divisionFilter', async (user) => (user.sub === 1 ? 3 : null));
  const seen = [];
  t.mock.method(quality, 'list', async (entityId, opts) => { seen.push([entityId, opts]); return []; });
  const run = (user) => new Promise((resolve, reject) => {
    ctrl.qualityList({ user }, { status() { return this; }, json: resolve }, reject);
  });
  await run({ sub: 1, entityId: 9 });
  await run({ sub: 2, entityId: 9 });
  assert.deepEqual(seen, [[9, { departmentId: 3 }], [9, { departmentId: null }]]);
});

test('management counts every finding in one query, scoped by division', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args) => { calls.push({ sql, args }); return [[{ k: 'stock_minus', n: 12 }, { k: 'future_date', n: 1 }]]; });
  const kpi = accurate.kpis.find((k) => k.key === 'accurate_to_fix');
  const v = await kpi.value(7, { departmentId: 3 });
  assert.equal(calls.length, 1);
  assert.deepEqual(v, { value: 13, sub: '12 stok minus · 1 tanggal lebih dari 7 hari ke depan', alert: true });
  assert.equal(calls[0].args.filter((a) => a === 3).length, quality.CHECKS.length, 'every check filtered to the division');
});
