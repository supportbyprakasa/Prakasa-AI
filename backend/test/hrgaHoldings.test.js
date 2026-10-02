const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/db/pool');
const svc = require('../src/services/hrgaWorkflow.service');

// "Buat offboarding" shows what the picked person still holds before submitting.
const user = { sub: 3, entityId: 1, permissions: ['hrga.view', 'hrga.manage'] };

function fakeDb(t, { directoryRow = null, account = { id: 40 } } = {}) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, args = []) => {
    const text = String(sql);
    calls.push({ sql: text, args });
    if (/FROM people_directory WHERE id = \?/.test(text)) return [[{ id: args[0], user_id: 40 }]];
    if (/FROM people_directory WHERE entity_id = \? AND user_id = \?/.test(text)) return [[directoryRow].filter(Boolean)];
    if (/FROM users WHERE id = \?/.test(text)) return [[account].filter(Boolean)];
    if (/FROM device_assignments/.test(text)) return [[{ assignmentId: 1, deviceId: 9, name: 'Lenovo ThinkPad (PFN-LT-01)' }]];
    if (/FROM subscription_licenses/.test(text)) return [[{ licenseId: 2, subscriptionId: 5, productName: 'Google Workspace' }]];
    if (/information_schema\.tables/.test(text)) return [[{ n: 1 }]];
    if (/FROM it_phone_lines/.test(text)) return [[{ id: 4, label: '0812-0000-0000' }]];
    return [[]];
  });
  return calls;
}

test('a directory person: devices, licences and company numbers, scoped to the company', async (t) => {
  const calls = fakeDb(t);
  const h = await svc.holdingsForKey(user, 'p12');
  assert.deepEqual([h.devices.length, h.licenses.length, h.phoneLines.length], [1, 1, 1]);
  for (const c of calls.filter((x) => /people_directory|device_assignments|subscription|it_phone_lines/.test(x.sql) && !/information_schema/.test(x.sql))) assert.ok(c.args.includes(1), `entity bound: ${c.sql.slice(0, 60)}`);
});

test('an account without a directory row: what is assigned to the account, no phone line', async (t) => {
  fakeDb(t);
  const h = await svc.holdingsForKey(user, 'u40');
  assert.deepEqual([h.devices.length, h.licenses.length, h.phoneLines.length], [1, 1, 0]);
});

test('an account of another company, or a bad key, shows nothing / is refused', async (t) => {
  fakeDb(t, { account: null });
  assert.deepEqual(await svc.holdingsForKey(user, 'u99'), { devices: [], licenses: [], phoneLines: [] });
  await assert.rejects(svc.holdingsForKey(user, 'x1'), (e) => e.status === 400);
});

test('the holdings lookup is for whoever may create an offboarding (hrga.request)', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/hrga.routes.js'), 'utf8');
  assert.match(routes, /router\.get\('\/holdings', requirePermission\('hrga\.request'\)/);
});
