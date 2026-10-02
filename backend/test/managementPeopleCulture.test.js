const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { validateProvider } = require('../src/management/contract');
const hrga = require('../src/management/providers/hrga');
const it = require('../src/management/providers/it');

// People & Culture reports into management through two providers: HRGA
// (onboarding / offboarding) and IT (tickets, devices, subscriptions).

const PERIOD = { start: '2026-09-01', end: '2026-09-30' };
const EPISODE_SOURCES = new Set([
  'it_device_damaged', 'it_device_resigned_holder',
  // Onboarding/offboarding (wave 2, row 2.1).
  'hrga_resigned_access_open',
  // IT infrastructure registers (wave 2, row 2.3).
  'it_isp_contract_ending', 'it_backup_unverified', 'it_cctv_offline',
]);
const ESCALATION_FIELDS = [
  'sourceId', 'title', 'reference', 'context', 'departmentId', 'departmentName',
  'ownerName', 'severity', 'daysLate', 'since', 'link',
].sort();

// Rows each source's SQL is answered with, keyed by the table it reads.
const ROWS = {
  hrga_onboarding_late: {
    id: 21, workflow_number: 'ONB-202609-0001', workflow_type: 'onboarding', employee_full_name: 'Ani Lestari',
    department_id: 9, department_name: 'Warehouse', owner_name: 'Rina HR', last_day: null,
    late_items: 2, late_access_items: 0, since: '2026-09-20', days_late: 9,
  },
  hrga_offboarding_late: {
    id: 22, workflow_number: 'OFF-202609-0001', workflow_type: 'offboarding', employee_full_name: 'Budi Santoso',
    department_id: 9, department_name: 'Warehouse', owner_name: 'Rina HR', last_day: '2026-09-10',
    late_items: 2, late_access_items: 1, since: '2026-09-10', days_late: 19,
  },
  hrga_resigned_access_open: {
    id: 46, name: 'Dewi Kartika', since: '2026-09-20', since_day: '9759', department_id: 9, department_name: 'Warehouse',
    account_open: 1, licenses_open: '1', phones_open: '0', days_late: '8',
  },
  it_ticket_overdue: {
    id: 31, title: 'Printer gudang mati', category: 'device_damage', priority: 'high',
    department_id: 9, department_name: 'Warehouse', owner_name: 'Budi', since: '2026-09-26T08:00:00Z', days_late: 3,
  },
  it_device_in_service: {
    id: 41, asset_code: 'LP-0041', device_type: 'laptop', brand: 'Dell', model: 'Latitude', status: 'repair',
    department_id: 6, department_name: 'People & Culture', owner_name: 'Wahyudi', since: '2026-09-01', days_late: 14,
  },
  it_device_damaged: {
    id: 43, asset_code: null, serial_number: 'SN-43', device_type: 'monitor', brand: null, model: 'LG 24MK600',
    department_id: 6, department_name: 'People & Culture', location_name: 'PFN Office',
    since: '2026-09-01T03:00:00Z', since_day: '9740', days_late: '16',
  },
  it_device_resigned_holder: {
    id: 44, asset_code: 'LAP/PFN/2024/002', serial_number: 'SN-44', device_type: 'laptop', brand: null, model: 'IdeaPad Slim 5',
    department_id: 6, department_name: 'People & Culture', owner_name: 'Rudi Hartono',
    since: '2026-09-20', since_day: '9759', days_late: '8',
  },
  it_device_return_late: {
    id: 51, device_id: 42, asset_code: 'LP-0042', device_type: 'laptop', brand: null, model: null,
    department_id: 6, department_name: 'People & Culture', owner_name: 'Sari', since: '2026-09-25', days_late: 4,
  },
  it_subscription_undecided: {
    id: 61, product_name: 'Figma', plan_name: 'Professional', renewal_date: '2026-10-09',
    department_id: 6, department_name: 'People & Culture', owner_name: 'Wahyudi', vendor_name: 'Figma Inc',
    since: '2026-09-25', days_late: 4,
  },
};

// Route each statement to its fixture by what it reads. `calls` records the SQL
// and arguments so a test can prove the division filter reached the database.
// IT infrastructure registers (wave 2, row 2.3), routed before everything else.
const INFRA_ROWS = {
  it_isp_contract_ending: {
    id: 71, provider_name: 'Biznet', is_backup: 0, department_id: 6, department_name: 'People & Culture',
    location_name: 'PFN Office', contract_end: '2026-10-20', since: '2026-09-20', end_day: '9789', days_late: '11',
  },
  it_backup_unverified: {
    id: 72, data_scope: 'Folder Finance', frequency: 'daily', last_result: 'failed', department_id: 6,
    department_name: 'People & Culture', failing: 1, since: '2026-09-28', since_day: '9767', days_late: '3',
  },
  it_cctv_offline: {
    id: 73, status: 'offline', camera_count: 18, cameras_offline: 18, department_id: 6, department_name: 'People & Culture',
    location_name: 'PFN Office', since: '2026-09-25T02:00:00Z', since_day: '9764', days_late: '4',
  },
  it_gws_review_overdue: {
    id: 74, reviewed_on: '2026-06-01', department_id: 6, department_name: 'People & Culture', since: '2026-08-30', days_late: '32',
  },
};
function infraQuery(sql) {
  if (/FROM it_isp_links l/.test(sql) && /contract_end - INTERVAL/.test(sql) && /AS end_day/.test(sql)) return [[INFRA_ROWS.it_isp_contract_ending]];
  if (/FROM it_backup_jobs b/.test(sql) && /AS since_day/.test(sql)) return [[INFRA_ROWS.it_backup_unverified]];
  if (/FROM it_cctv_systems c/.test(sql) && /AS since_day/.test(sql)) return [[INFRA_ROWS.it_cctv_offline]];
  if (/FROM it_gws_reviews g/.test(sql) && /AS days_late/.test(sql)) return [[INFRA_ROWS.it_gws_review_overdue]];
  if (/FROM it_backup_checks k/.test(sql)) return [[{ department_id: 6, checks: '12' }, { department_id: null, checks: '1' }]];
  if (/FROM it_cctv_systems c/.test(sql)) return [[{ total: '1', cameras: '18', not_online: '1' }]];
  if (/FROM it_isp_links l/.test(sql)) return [[{ total: '2', mbps: '150', without_backup: '1' }]];
  if (/FROM it_backup_jobs b/.test(sql)) return [[{ active: '1', healthy: '0', late: '1' }]];
  if (/FROM it_gws_reviews g/.test(sql)) return [[{ reviewed_on: '2026-06-01', flags: '2' }]];
  if (/FROM it_phone_lines p/.test(sql)) return [[{ total: '3', active: '2', spare: '1' }]];
  return null;
}

function fakeQuery(calls) {
  return async (sql, args) => {
    calls.push({ sql, args });
    const infra = infraQuery(sql);
    if (infra) return infra;
    if (/FROM hrga_workflows h\s+JOIN hrga_workflow_tasks/.test(sql)) {
      return [[/AND h\.workflow_type = 'offboarding'/.test(sql) ? ROWS.hrga_offboarding_late : ROWS.hrga_onboarding_late]];
    }
    if (/AS licenses_open/.test(sql)) return [[ROWS.hrga_resigned_access_open]];
    if (/AS started/.test(sql) && /owner_group IN \('it', 'ga'\)/.test(sql)) {
      return [[{ department_id: 9, started: 4, ready: 3 }, { department_id: null, started: 1, ready: 1 }]];
    }
    if (/SUM\(h\.workflow_type = 'onboarding'/.test(sql)) {
      return [[{ onboarding_active: '4', offboarding_active: '2', onboarding_late: '1', offboarding_late: '0' }]];
    }
    if (/FROM hrga_workflows h/.test(sql) && /completed_at BETWEEN/.test(sql)) {
      return [[{ department_id: 9, completed: 4, on_time: 3 }, { department_id: null, completed: 1, on_time: 1 }]];
    }
    if (/FROM it_tickets t/.test(sql) && /resolved_at BETWEEN/.test(sql)) {
      return [[{ department_id: 9, resolved: 5, avg_days: '1.2345', within_sla: 4 }, { department_id: 6, resolved: 0, avg_days: null, within_sla: 0 }]];
    }
    if (/SUM\(t\.status IN/.test(sql)) return [[{ open_tickets: '7', late: '2' }]];
    if (/AS in_service/.test(sql)) return [[{ in_service: '3', stuck: '1' }]];
    if (/AS problematic/.test(sql)) return [[{ total: '69', problematic: '7', damaged: '4', retired: '3', damaged_late: '1' }]];
    if (/AS active_accounts/.test(sql)) return [[{ active_accounts: '33', unreviewed: '12' }]];
    if (/FROM devices d/.test(sql) && /d\.status = 'damaged' AND/.test(sql)) return [[ROWS.it_device_damaged]];
    if (/FROM devices d/.test(sql) && /hp\.status = 'resigned'/.test(sql)) return [[ROWS.it_device_resigned_holder]];
    if (/AS expiring/.test(sql)) return [[{ expiring: '5', undecided: '0' }]];
    if (/FROM it_tickets t/.test(sql)) return [[ROWS.it_ticket_overdue]];
    if (/FROM device_assignments a/.test(sql)) return [[ROWS.it_device_return_late]];
    if (/FROM devices d/.test(sql)) return [[ROWS.it_device_in_service]];
    if (/FROM software_subscriptions s/.test(sql)) return [[ROWS.it_subscription_undecided]];
    return [[]];
  };
}

async function runEverything(provider, departmentId) {
  for (const e of provider.escalations) await e.list(1, { departmentId });
  for (const m of provider.metrics) await m.actuals(1, PERIOD, { departmentId });
  for (const k of provider.kpis) await k.value(1, { departmentId });
}

for (const provider of [hrga, it]) {
  const prefix = `${provider.key}_`;

  test(`${provider.key}: satisfies the management contract with prefixed keys`, () => {
    assert.doesNotThrow(() => validateProvider(provider));
    const keys = [...provider.escalations, ...provider.metrics, ...provider.kpis].map((x) => x.key);
    for (const key of keys) assert.ok(key.startsWith(prefix), `${key} is prefixed ${prefix}`);
    assert.ok(provider.escalations.length && provider.metrics.length && provider.kpis.length);
  });

  test(`${provider.key}: every escalation maps rows to the Pusat Eskalasi shape`, async (t) => {
    t.mock.method(pool, 'query', fakeQuery([]));
    for (const source of provider.escalations) {
      const items = await source.list(1, { departmentId: null });
      assert.equal(items.length, 1, source.key);
      const [item] = items;
      assert.deepEqual(Object.keys(item).sort(), ESCALATION_FIELDS, source.key);
      assert.ok(['medium', 'high'].includes(item.severity), source.key);
      assert.equal(item.severity, item.daysLate >= 14 ? 'high' : 'medium', source.key);
      assert.ok(item.link && item.link.startsWith('/'), `${source.key} links inside the app`);
      assert.equal(typeof item.sourceId, 'number');
      assert.ok(item.title && item.title !== '(tanpa judul)', source.key);
      assert.ok(!Number.isNaN(Date.parse(item.since)), `${source.key} has a since date`);
    }
  });

  test(`${provider.key}: locate returns the record's entity and division, or null`, async (t) => {
    const calls = [];
    t.mock.method(pool, 'query', async (sql, args) => {
      calls.push({ sql, args });
      return args[0] === 404 ? [[]] : [[{ entity_id: 1, department_id: 9 }]];
    });
    // Episode sources carry the record id × 100000 + the day the episode began.
    const idOf = (source, id) => (EPISODE_SOURCES.has(source.key) ? id * 100000 + 9759 : id);
    for (const source of provider.escalations) {
      assert.deepEqual(await source.locate(idOf(source, 5)), { entityId: 1, departmentId: 9 }, source.key);
      assert.equal(await source.locate(idOf(source, 404)), null, source.key);
    }
    t.mock.method(pool, 'query', async () => [[{ entity_id: '1', department_id: null }]]);
    for (const source of provider.escalations) {
      assert.deepEqual(await source.locate(idOf(source, 5)), { entityId: 1, departmentId: null }, `${source.key} keeps a missing division null`);
    }
    for (const c of calls) {
      if (/FROM (hrga_workflows|devices|software_subscriptions) WHERE/.test(c.sql)) {
        assert.match(c.sql, /deleted_at IS NULL/, 'a soft-deleted record cannot be followed up');
      }
    }
  });

  test(`${provider.key}: a division Head is filtered in SQL on every query`, async (t) => {
    const calls = [];
    t.mock.method(pool, 'query', fakeQuery(calls));
    await runEverything(provider, 9);
    const expected = provider.escalations.length + provider.metrics.length + provider.kpis.length;
    assert.equal(calls.length, expected, 'one query per capability');
    for (const c of calls) {
      assert.match(c.sql, /[a-z]\.department_id = \?/, 'carries the division filter');
      assert.equal(c.args[0], 1, 'entity first');
      assert.equal(c.args[1], 9, 'then the caller\'s division');
      assert.match(c.sql, /\.entity_id = \?/, 'scoped to the entity');
    }
  });

  test(`${provider.key}: the entity-wide view has no division filter`, async (t) => {
    const calls = [];
    t.mock.method(pool, 'query', fakeQuery(calls));
    await runEverything(provider, null);
    assert.ok(calls.length > 0);
    for (const c of calls) {
      assert.doesNotMatch(c.sql, /department_id = \?/);
      assert.equal(c.args[0], 1);
      assert.ok(!c.args.includes(9) && !c.args.includes(null));
    }
  });

  test(`${provider.key}: metrics return a Map keyed by division`, async (t) => {
    t.mock.method(pool, 'query', fakeQuery([]));
    for (const metric of provider.metrics) {
      const result = await metric.actuals(1, PERIOD, { departmentId: null });
      assert.ok(result instanceof Map, metric.key);
      for (const key of result.keys()) assert.equal(typeof key, 'number', `${metric.key} keys are division ids`);
      assert.ok(!result.has(null), `${metric.key} drops records without a division`);
    }
  });

  test(`${provider.key}: KPIs return { value, sub, alert }`, async (t) => {
    t.mock.method(pool, 'query', fakeQuery([]));
    for (const kpi of provider.kpis) {
      const result = await kpi.value(1, { departmentId: null });
      assert.deepEqual(Object.keys(result).sort(), ['alert', 'sub', 'value'], kpi.key);
      assert.equal(typeof result.value, 'number');
      assert.equal(typeof result.sub, 'string');
      assert.equal(typeof result.alert, 'boolean');
    }
  });
}

// ------------------------------------------------------------------ HRGA

test('hrga: a resign without offboarding with access still open is one episode per resign date (wave 2)', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const source = hrga.escalations.find((e) => e.key === 'hrga_resigned_access_open');
  assert.ok(source.key.length <= 32);
  const [item] = await source.list(1, { departmentId: 9 });
  assert.equal(item.sourceId, 46 * 100000 + 9759);
  assert.equal(item.link, '/people/directory/p46');
  assert.match(item.context, /akun aplikasi aktif, 1 lisensi/);
  const [{ sql, args }] = calls;
  assert.deepEqual(args, [1, 9], 'entity bound first, then the division');
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM hrga_workflows h/);
  assert.match(sql, /h\.status NOT IN \('rejected', 'cancelled'\)/);
  assert.match(sql, /p\.kind <> 'excluded'/);
  assert.match(sql, /resigned_on < DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\) - INTERVAL 3 DAY/);
  // Before row 2.3's register exists the same query runs without the number count.
  const missing = Object.assign(new Error('no table'), { code: 'ER_NO_SUCH_TABLE' });
  let n = 0;
  t.mock.method(pool, 'query', async (s) => { n += 1; if (/it_phone_lines/.test(s)) throw missing; return [[]]; });
  assert.deepEqual(await source.list(1, { departmentId: null }), []);
  assert.equal(n, 2);
});

test('hrga: "Siap di hari pertama" counts onboardings approved by the join date whose IT and GA items were done by then', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const metric = hrga.metrics.find((m) => m.key === 'hrga_ready_on_day_one');
  const result = await metric.actuals(1, PERIOD, { departmentId: null });
  assert.equal(result.get(9), 75);
  const [{ sql }] = calls;
  assert.match(sql, /DATE\(h\.approved_at \+ INTERVAL 7 HOUR\) <= h\.join_date/);
  assert.match(sql, /DATE\(t\.completed_at \+ INTERVAL 7 HOUR\) <= h\.join_date/);
});

test('hrga: claims onboarding, offboarding, their checklist templates and the directory', () => {
  assert.deepEqual(hrga.navPaths, ['/hrga/onboarding', '/hrga/offboarding', '/hrga/checklist-templates', '/people/directory']);
});

test('hrga: accounts not reviewed by People & Culture are a KPI without an alarm (rule 13)', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const kpi = hrga.kpis.find((k) => k.key === 'hrga_directory_unreviewed');
  assert.deepEqual(await kpi.value(1, { departmentId: null }), { value: 12, sub: 'dari 33 akun aktif', alert: false });
  const [{ sql }] = calls;
  assert.match(sql, /LEFT JOIN people_directory p ON p\.entity_id = u\.entity_id AND p\.user_id = u\.id/);
  assert.match(sql, /u\.deleted_at IS NULL AND u\.status = 'active'/);
  assert.match(sql, /SUM\(p\.id IS NULL\) AS unreviewed/);
});

test('hrga: an offboarding with access still open after the last day says so', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const [off] = await hrga.escalations.find((e) => e.key === 'hrga_offboarding_late').list(1, { departmentId: null });
  assert.equal(off.link, '/hrga/workflows/22');
  assert.equal(off.reference, 'OFF-202609-0001');
  assert.equal(off.severity, 'high', '19 days after the last day');
  assert.match(off.context, /2026-09-10/);
  assert.match(off.context, /akses\/aset/);
  const [on] = await hrga.escalations.find((e) => e.key === 'hrga_onboarding_late').list(1, { departmentId: null });
  assert.equal(on.link, '/hrga/workflows/21');
  assert.match(on.context, /2 item checklist/);
});

test('hrga: only running workflows escalate — approval waits are the approvals provider\'s', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  // Workflow escalations only; hrga_resigned_access_open is about people never offboarded.
  for (const source of hrga.escalations.filter((e) => e.key !== 'hrga_resigned_access_open')) await source.list(1, { departmentId: null });
  for (const c of calls) {
    assert.match(c.sql, /h\.status IN \('approved', 'in_progress'\)/);
    assert.doesNotMatch(c.sql, /pending_approval/);
    assert.match(c.sql, /h\.deleted_at IS NULL/);
  }
});

test('hrga: KPIs preserve the old dashboard numbers onboardingActive / offboardingActive', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const onboarding = await hrga.kpis.find((k) => k.key === 'hrga_onboarding_active').value(1, { departmentId: null });
  const offboarding = await hrga.kpis.find((k) => k.key === 'hrga_offboarding_active').value(1, { departmentId: null });
  assert.deepEqual(onboarding, { value: 4, sub: '1 lewat tenggat', alert: true });
  assert.deepEqual(offboarding, { value: 2, sub: '0 lewat tenggat', alert: false });
  const [sql] = calls.map((c) => c.sql);
  assert.match(sql, /SUM\(h\.workflow_type = 'onboarding' AND h\.status IN \('approved', 'in_progress'\)\) AS onboarding_active/);
  assert.match(sql, /SUM\(h\.workflow_type = 'offboarding' AND h\.status IN \('approved', 'in_progress'\)\) AS offboarding_active/);
  assert.match(sql, /h\.deleted_at IS NULL/);
});

test('hrga: on-time rate is a percentage per division; completions count', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const rate = await hrga.metrics.find((m) => m.key === 'hrga_onboarding_on_time').actuals(1, PERIOD, { departmentId: null });
  assert.deepEqual([...rate], [[9, 75]]);
  const done = await hrga.metrics.find((m) => m.key === 'hrga_offboarding_completed').actuals(1, PERIOD, { departmentId: null });
  assert.deepEqual([...done], [[9, 4]]);
});

// -------------------------------------------------------------------- IT

test('it: escalation links point at the ticket, device and subscription pages', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const link = async (key) => (await it.escalations.find((e) => e.key === key).list(1, { departmentId: null }))[0];
  const ticket = await link('it_ticket_overdue');
  assert.equal(ticket.link, '/it/tickets/31');
  assert.match(ticket.context, /prioritas tinggi/);
  const device = await link('it_device_in_service');
  assert.equal(device.link, '/it/devices/41');
  assert.equal(device.title, 'Dell Latitude');
  assert.equal(device.severity, 'high');
  const lent = await link('it_device_return_late');
  assert.equal(lent.link, '/it/devices/42', 'a late return opens the device, not the assignment id');
  assert.equal(lent.title, 'laptop');
  const sub = await link('it_subscription_undecided');
  assert.equal(sub.link, '/it/subscriptions/61');
  assert.match(sub.context, /2026-10-09/);
});

test('it: a ticket\'s division is its requester\'s; waiting on the user stops the SLA clock', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await it.escalations.find((e) => e.key === 'it_ticket_overdue').list(1, { departmentId: 9 });
  const [{ sql }] = calls;
  assert.match(sql, /t\.department_id = \?/);
  assert.match(sql, /t\.status IN \('open', 'in_progress'\)/);
  assert.doesNotMatch(sql, /waiting_on_user/);
});

test('it: a renewal already requested is not reported again', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await it.escalations.find((e) => e.key === 'it_subscription_undecided').list(1, { departmentId: null });
  const [{ sql }] = calls;
  assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM subscription_renewals r/);
  assert.match(sql, /s\.auto_renew = 0/);
  assert.match(sql, /s\.deleted_at IS NULL/);
  assert.match(sql, new RegExp(`INTERVAL ${it.DECISION_LEAD_DAYS} DAY`));
});

test('it: a leaver\'s late device return is left to the running offboarding', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await it.escalations.find((e) => e.key === 'it_device_return_late').list(1, { departmentId: null });
  const [{ sql }] = calls;
  assert.match(sql, /ht\.linked_device_assignment_id = a\.id/);
  assert.match(sql, /d\.deleted_at IS NULL/);
});

test('it: thresholds agree with the itReminders job', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const reminders = fs.readFileSync(path.join(__dirname, '../src/jobs/itReminders.js'), 'utf8');
  assert.match(reminders, new RegExp(`renewal_date BETWEEN DATE\\(UTC_TIMESTAMP\\(\\) \\+ INTERVAL 7 HOUR\\) AND DATE_ADD\\(DATE\\(UTC_TIMESTAMP\\(\\) \\+ INTERVAL 7 HOUR\\), INTERVAL ${it.RENEWAL_NOTICE_DAYS} DAY\\)`));
  assert.ok(it.DECISION_LEAD_DAYS < it.RENEWAL_NOTICE_DAYS, 'the PIC is reminded before the decision is overdue');
  assert.match(reminders, /a\.expected_return_date < DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\)/, 'late return = same rule as the reminder');
});

test('it: KPIs preserve devicesInService and subsExpiring and add open tickets', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const value = async (key) => it.kpis.find((k) => k.key === key).value(1, { departmentId: null });
  assert.deepEqual(await value('it_devices_in_service'), { value: 3, sub: `1 lebih dari ${it.SERVICE_DAYS} hari`, alert: true });
  assert.deepEqual(await value('it_subs_expiring'), { value: 5, sub: '0 belum diputuskan', alert: false });
  assert.deepEqual(await value('it_open_tickets'), { value: 7, sub: '2 lewat SLA', alert: true });
  const [devices, subs] = calls.map((c) => c.sql);
  assert.match(devices, /SUM\(d\.status IN \('repair', 'maintenance'\)\) AS in_service/);
  assert.match(devices, /d\.deleted_at IS NULL/);
  assert.match(subs, /SUM\(s\.status = 'expiring'\) AS expiring/);
  assert.match(subs, /s\.deleted_at IS NULL/);
});

test('it: resolution time is in days (1 decimal), SLA rate unknown without tickets', async (t) => {
  t.mock.method(pool, 'query', fakeQuery([]));
  const metric = (key) => it.metrics.find((m) => m.key === key);
  assert.equal(metric('it_ticket_resolution_days').unit, 'hari');
  assert.equal(metric('it_ticket_resolution_days').better, 'lower');
  assert.deepEqual([...await metric('it_ticket_resolution_days').actuals(1, PERIOD, { departmentId: null })], [[9, 1.2], [6, null]]);
  assert.deepEqual([...await metric('it_tickets_resolved').actuals(1, PERIOD, { departmentId: null })], [[9, 5], [6, 0]]);
  assert.deepEqual([...await metric('it_tickets_within_sla').actuals(1, PERIOD, { departmentId: null })], [[9, 80], [6, null]]);
});

// ------------------------------------------------------ IT assets (wave 1)

test('it: a device Rusak more than 14 days escalates once per episode (rule 14)', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const [item] = await it.escalations.find((e) => e.key === 'it_device_damaged').list(1, { departmentId: 6 });
  assert.equal(item.sourceId, 43 * 100000 + 9740, 'device id × 100000 + the day it became Rusak');
  assert.equal(item.link, '/it/devices/43');
  assert.equal(item.reference, 'SN-43', 'no asset number: the serial identifies it');
  assert.equal(item.daysLate, 16);
  assert.equal(item.severity, 'high');
  assert.match(item.context, /Rusak lebih dari 14 hari/);
  const [{ sql, args }] = calls;
  assert.deepEqual(args, [1, 6]);
  assert.match(sql, /d\.status = 'damaged' AND DATE\(d\.status_changed_at \+ INTERVAL 7 HOUR\) < DATE_SUB\(DATE\(UTC_TIMESTAMP\(\) \+ INTERVAL 7 HOUR\), INTERVAL 14 DAY\)/);
  assert.match(sql, /d\.deleted_at IS NULL/);
  assert.equal(it.DAMAGED_DAYS, 14);
});

test('it: a device still held by someone resigned more than 3 days escalates per resign day (rules 10, 23)', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const [item] = await it.escalations.find((e) => e.key === 'it_device_resigned_holder').list(1, { departmentId: null });
  assert.equal(item.sourceId, 44 * 100000 + 9759);
  assert.equal(item.ownerName, 'Rudi Hartono');
  assert.equal(item.reference, 'LAP/PFN/2024/002');
  assert.equal(item.link, '/it/devices/44');
  const [{ sql, args }] = calls;
  assert.deepEqual(args, [1]);
  // The resign day is never NULL: entered/imported date, else the row's creation day, else the account's change.
  assert.match(sql, /COALESCE\(hp\.resigned_on, DATE\(hp\.created_at \+ INTERVAL 7 HOUR\)/);
  assert.match(sql, /hp\.status = 'resigned' OR hacc\.status = 'inactive' OR hacc\.deleted_at IS NOT NULL/);
  assert.match(sql, /hp\.kind IS NULL OR hp\.kind <> 'excluded'/, 'excluded people never escalate');
  assert.match(sql, /INTERVAL 3 DAY/);
  assert.match(sql, /d\.status = 'assigned'/, 'only a device that is Aktif has a holder');
  assert.match(sql, /hw\.workflow_type = 'offboarding'/, 'a running offboarding already reports it');
  assert.equal(it.RESIGNED_HOLDER_DAYS, 3);
});

test('it: problematic devices = Rusak + Tidak aktif, and no alarm while there are no devices (rule 23)', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  const kpi = it.kpis.find((k) => k.key === 'it_devices_problematic');
  assert.deepEqual(await kpi.value(1, { departmentId: null }), {
    value: 7, sub: '4 rusak, 3 tidak aktif dari 69 perangkat · 1 rusak > 14 hari', alert: true,
  });
  assert.match(calls[0].sql, /SUM\(d\.status IN \('damaged', 'retired'\)\) AS problematic/);
  t.mock.method(pool, 'query', async () => [[{ total: '0', problematic: null, damaged: null, retired: null, damaged_late: null }]]);
  assert.deepEqual(await kpi.value(1, { departmentId: null }), { value: 0, sub: 'Belum ada perangkat tercatat', alert: false });
  // Strings from mysql2 are numbers here, never concatenated text.
  t.mock.method(pool, 'query', async () => [[{ total: '5', problematic: '2', damaged: '2', retired: '0', damaged_late: '0' }]]);
  assert.deepEqual(await kpi.value(1, { departmentId: null }), { value: 2, sub: '2 rusak, 0 tidak aktif dari 5 perangkat', alert: false });
});

test('it: time in service counts from the status change, not from any later edit (rule 14)', async (t) => {
  const calls = [];
  t.mock.method(pool, 'query', fakeQuery(calls));
  await it.escalations.find((e) => e.key === 'it_device_in_service').list(1, { departmentId: null });
  assert.match(calls[0].sql, /DATE\(d\.status_changed_at \+ INTERVAL 7 HOUR\)/);
  assert.doesNotMatch(calls[0].sql, /updated_at/);
});

test('it: episode keys fit escalation_followups.source (32 chars)', () => {
  for (const source of it.escalations) assert.ok(source.key.length <= 32, source.key);
});
