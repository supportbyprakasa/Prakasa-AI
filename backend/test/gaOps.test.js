const test = require('node:test');
const assert = require('node:assert/strict');
const { pool, dbReady, inRolledBackTransaction, makeUser, makeLocation, departmentId } = require('./fixtures/gaDb');
const ops = require('../src/services/gaOps.service');
const ga = require('../src/management/providers/ga');
const { schemas } = require('../src/routes/ga.routes');

// Operasional GA (migration 114): upkeep schedules with history, contracts
// and utility bills, owned by People & Culture and reported to management.

test.after(() => pool.end());

const SKIP = 'no database with migration 114';
const ready = async () => (await dbReady()) && (await pool.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'ga_utility_bills'"))[0][0].n > 0;
const wibToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

test('route bodies are strict: no entity, department or version smuggled into a create', () => {
  const { maintenance, bills } = schemas.opsSchemas;
  assert.equal(maintenance.create.safeParse({ locationId: 1, category: 'ac', name: 'AC', intervalDays: 90, entityId: 2 }).success, false);
  assert.equal(maintenance.create.safeParse({ locationId: 1, category: 'ac', name: 'AC', intervalDays: 90 }).success, true);
  assert.equal(maintenance.update.safeParse({ name: 'AC' }).success, false, 'an edit needs the version');
  assert.equal(bills.create.safeParse({ locationId: 1, utility: 'water', period: '2026-13', amount: 5 }).success, false);
  assert.equal(schemas.maintenanceLogBody.safeParse({ doneOn: '2026-10-01', result: 'ok' }).success, true);
});

test('db: recording upkeep moves the schedule; an overdue item escalates for People & Culture only', async (t) => {
  if (!(await ready())) return t.skip(SKIP);
  await inRolledBackTransaction(t, async (conn) => {
    const loc = await makeLocation(conn);
    const pc = await makeUser(conn, { name: 'GA', division: 'people_culture', roles: ['people_culture.supervisor'] });
    const pcDept = await departmentId(conn, 'people_culture');
    const salesDept = await departmentId(conn, 'sales');
    const today = wibToday();

    const id = await ops.createRow(conn, { entityId: 1, userId: pc.id, key: 'maintenance', body: { locationId: loc, category: 'ac', name: 'AC ruang rapat', intervalDays: 90, nextDueOn: ops.addDays(today, -5) } });
    const item = await ops.getRow(conn, 1, 'maintenance', id);
    assert.equal(item.departmentId, pcDept);
    assert.equal(item.overdue, true);

    const list = await ga.escalations.find((e) => e.key === 'ga_maintenance_overdue').list(1, { departmentId: pcDept });
    const esc = list.find((x) => Math.floor(x.sourceId / ga.EPISODE_FACTOR) === id);
    assert.ok(esc, 'escalates in the P&C division');
    assert.equal(esc.link, `/ga/operations?tab=maintenance&open=${id}`);
    assert.ok(esc.daysLate >= 5);
    assert.equal((await ga.escalations.find((e) => e.key === 'ga_maintenance_overdue').list(1, { departmentId: salesDept })).some((x) => Math.floor(x.sourceId / ga.EPISODE_FACTOR) === id), false);

    await ops.addMaintenanceLog(conn, { entityId: 1, userId: pc.id, itemId: id, doneOn: today, result: 'ok', cost: 350000 });
    const after = await ops.getRow(conn, 1, 'maintenance', id);
    assert.equal(after.lastDoneOn, today);
    assert.equal(after.nextDueOn, ops.addDays(today, 90));
    assert.equal(after.overdue, false);
    const logs = await ops.listMaintenanceLogs(conn, 1, id);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].onTime, false, 'done after the date it was due');

    const period = { start: today, end: today };
    assert.equal((await ga.metrics.find((m) => m.key === 'ga_upkeep_done').actuals(1, period, { departmentId: pcDept })).get(pcDept), 1);
    assert.equal((await ga.metrics.find((m) => m.key === 'ga_upkeep_on_time').actuals(1, period, { departmentId: pcDept })).get(pcDept), 0);

    await assert.rejects(ops.addMaintenanceLog(conn, { entityId: 1, userId: pc.id, itemId: id, doneOn: ops.addDays(today, 1) }), (e) => e.code === 'DATE_IN_FUTURE');
    await assert.rejects(ops.getRow(conn, 2, 'maintenance', id).then((r) => { if (!r) throw Object.assign(new Error('x'), { code: 'NOT_FOUND' }); }), (e) => e.code === 'NOT_FOUND', 'another entity never sees it');

    // The activity log never carries money.
    const [logRows] = await conn.query("SELECT metadata FROM activity_logs WHERE subject_type = 'ga_maintenance_item' AND subject_id = ?", [id]);
    assert.ok(logRows.length >= 2);
    for (const r of logRows) assert.doesNotMatch(JSON.stringify(r.metadata), /350000/);
  });
});

test('db: a contract escalates from its notice date; a bill is unique per meter and month and escalates when overdue', async (t) => {
  if (!(await ready())) return t.skip(SKIP);
  await inRolledBackTransaction(t, async (conn) => {
    const loc = await makeLocation(conn);
    const pc = await makeUser(conn, { name: 'GA', division: 'people_culture', roles: ['people_culture.supervisor'] });
    const pcDept = await departmentId(conn, 'people_culture');
    const today = wibToday();

    const c = await ops.createRow(conn, { entityId: 1, userId: pc.id, key: 'contracts', body: { kind: 'cleaning', vendorName: 'PT Bersih Selalu', endOn: ops.addDays(today, 30), noticeDays: 60, monthlyCost: 9000000 } });
    const contract = await ops.getRow(conn, 1, 'contracts', c);
    assert.equal(contract.ending, true);
    const ending = await ga.escalations.find((e) => e.key === 'ga_contract_ending').list(1, { departmentId: pcDept });
    const item = ending.find((x) => Math.floor(x.sourceId / ga.EPISODE_FACTOR) === c);
    assert.ok(item);
    assert.doesNotMatch(JSON.stringify(item), /9000000/, 'no money in management');
    await assert.rejects(
      ops.createRow(conn, { entityId: 1, userId: pc.id, key: 'contracts', body: { kind: 'security', vendorName: 'X', startOn: '2026-05-01', endOn: '2026-04-01' } }),
      (e) => e.code === 'CONTRACT_INVALID',
    );

    const b = await ops.createRow(conn, { entityId: 1, userId: pc.id, key: 'bills', body: { locationId: loc, utility: 'electricity', customerNumber: '5123 45', period: '2026-08', amount: 2500000, dueOn: ops.addDays(today, -3) } });
    await assert.rejects(
      ops.createRow(conn, { entityId: 1, userId: pc.id, key: 'bills', body: { locationId: loc, utility: 'electricity', customerNumber: '5123 45 ', period: '2026-08', amount: 1 } }),
      (e) => e.code === 'BILL_EXISTS',
    );
    const overdue = await ga.escalations.find((e) => e.key === 'ga_bill_overdue').list(1, { departmentId: pcDept });
    assert.ok(overdue.some((x) => x.sourceId === b));

    const bill = await ops.getRow(conn, 1, 'bills', b);
    await assert.rejects(ops.updateRow(conn, { entityId: 1, userId: pc.id, key: 'bills', id: b, body: { version: bill.version + 1, paidOn: today } }), (e) => e.code === 'VERSION_CONFLICT');
    await ops.updateRow(conn, { entityId: 1, userId: pc.id, key: 'bills', id: b, body: { version: bill.version, paidOn: today } });
    assert.equal((await ops.getRow(conn, 1, 'bills', b)).status, 'paid');
    const after = await ga.escalations.find((e) => e.key === 'ga_bill_overdue').list(1, { departmentId: pcDept });
    assert.equal(after.some((x) => x.sourceId === b), false, 'paid closes it');

    const summary = await ops.summary(conn, 1);
    assert.ok(summary.contractsEnding >= 1);
  });
});

test('db: GA ops reminders — due upkeep in the app, ending contract and overdue bill by policy, once per week', async (t) => {
  if (!(await ready())) return t.skip(SKIP);
  const jobs = require('../src/jobs/gaOpsReminders');
  await inRolledBackTransaction(t, async (conn) => {
    const loc = await makeLocation(conn);
    const pc = await makeUser(conn, { name: 'GA Lead', division: 'people_culture', roles: ['people_culture.supervisor'] });
    const today = wibToday();
    const m = await ops.createRow(conn, { entityId: 1, userId: pc.id, key: 'maintenance', body: { locationId: loc, category: 'apar', name: 'APAR lobi', intervalDays: 180, nextDueOn: ops.addDays(today, 3) } });
    await ops.createRow(conn, { entityId: 1, userId: pc.id, key: 'contracts', body: { kind: 'security', vendorName: 'PT Aman', endOn: ops.addDays(today, 20), noticeDays: 30 } });
    await ops.createRow(conn, { entityId: 1, userId: pc.id, key: 'bills', body: { locationId: loc, utility: 'water', period: '2026-08', amount: 900000, dueOn: ops.addDays(today, -2) } });
    const first = await jobs.runOnce({ today, db: conn });
    assert.ok(first.created >= 3);
    const [rows] = await conn.query("SELECT event FROM notifications WHERE user_id = ? AND event LIKE 'ga_ops.%'", [pc.id]);
    assert.deepEqual([...new Set(rows.map((r) => r.event))].sort(), ['ga_ops.bill_overdue', 'ga_ops.contract_ending', 'ga_ops.maintenance_due']);
    const again = await jobs.runOnce({ today, db: conn });
    const [rows2] = await conn.query("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND event LIKE 'ga_ops.%'", [pc.id]);
    assert.equal(Number(rows2[0].n), rows.length, 'a rerun the same day sends nothing twice');
    assert.ok(m);
    assert.ok(again.created >= 0);
  });
});
