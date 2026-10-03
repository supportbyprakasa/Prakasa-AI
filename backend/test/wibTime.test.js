const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { todayWib, wibClock } = require('../src/utils/wibTime');
const { buildDbConnectionConfig, SESSION_TIME_ZONE_SQL } = require('../src/db/connectionConfig');

test('the WIB day turns at midnight Jakarta, not midnight UTC', () => {
  assert.equal(todayWib(Date.parse('2026-09-29T16:59:59Z')), '2026-09-29'); // 23.59 WIB
  assert.equal(todayWib(Date.parse('2026-09-29T17:00:00Z')), '2026-09-30'); // 00.00 WIB
  assert.equal(todayWib(Date.parse('2026-12-31T20:00:00Z')), '2027-01-01'); // new year, 03.00 WIB
});

test('the WIB clock reads Jakarta wall time through its UTC fields', () => {
  const clock = wibClock(Date.parse('2026-09-30T23:30:00Z')); // 06.30 WIB on 1 October
  assert.equal(clock.getUTCMonth() + 1, 10);
  assert.equal(clock.getUTCDate(), 1);
  assert.equal(clock.getUTCHours(), 6);
});

test('database sessions run in UTC, matching the driver', () => {
  assert.equal(buildDbConnectionConfig({ DB_HOST: 'h', DB_USER: 'u', DB_NAME: 'n' }).timezone, 'Z');
  assert.equal(SESSION_TIME_ZONE_SQL, "SET time_zone = '+00:00'");
});

// A session in UTC makes CURDATE() the UTC date, a day behind WIB from 00.00 to
// 07.00. Every calendar day in SQL is spelled out in WIB instead.
test('no SQL takes the session date for a business day', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
          if (/CURDATE\(\)|CURRENT_DATE\b|DATE\(NOW\(\)\)|new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/.test(line)) {
            offenders.push(`${path.relative(path.join(__dirname, '..'), full)}:${i + 1}`);
          }
        });
      }
    }
  };
  walk(path.join(__dirname, '..', 'src'));
  assert.deepEqual(offenders, []);
});

// MySQL 9.6 reads CAST(NULLIF(JSON_UNQUOTE(...), 'null') AS DATE) as the integer
// 2026 and returns NULL (found in 086, fixed in 087): a JSON date is read with
// JSON_VALUE(... RETURNING DATE).
test('no view casts a JSON text to a date through NULLIF', () => {
  const dir = path.join(__dirname, '..', 'migrations');
  const offenders = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && f !== '086_procurement_views.sql')
    .filter((f) => {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      return /CAST\(NULLIF\(JSON_UNQUOTE\([^;]*?\)\s*AS\s+DATE/i.test(sql);
    });
  assert.deepEqual(offenders, []);
});
