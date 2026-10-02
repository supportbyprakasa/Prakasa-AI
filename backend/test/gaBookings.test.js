const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const {
  pool, serialized, dbReady, inRolledBackTransaction, makeUser, makeLocation, makeResource, asUser, at, tag,
} = require('./fixtures/gaDb');
const { buildDbConnectionConfig, SESSION_TIME_ZONE_SQL } = require('../src/db/connectionConfig');
const rules = require('../src/services/gaRules');
const bookings = require('../src/services/gaBookings.service');
const reminders = require('../src/services/gaReminders.service');
const { schemas } = require('../src/routes/ga.routes');
const approvals = require('../src/controllers/approvals.controller');

// Layanan GA — Peminjaman ruang/kendaraan (§3.2, §3.7, decision 19, D9–D11).

test.after(() => pool.end());

const SKIP = 'no database with migration 109';
const code = (expected) => (error) => {
  assert.equal(error.code, expected, `${error.code}: ${error.message}`);
  return true;
};

async function decide(approvalId, user, action, note = null) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  let thrown = null;
  await approvals.decide({ entityScope: { entityId: user.entityId }, params: { id: approvalId }, body: { action, note }, user }, res, (e) => { thrown = e; });
  if (thrown) throw thrown;
  return res;
}

// ------------------------------------------------------------------ pure rules

const NOW = new Date('2026-10-01T03:00:00Z'); // 10.00 WIB
const t = (iso) => new Date(iso);

test('overlap matrix: half-open intervals; touching bookings do not clash', () => {
  const slot = { startsAt: t('2026-10-02T09:00:00+07:00'), endsAt: t('2026-10-02T10:00:00+07:00'), now: NOW };
  const ex = (start, end, status = 'confirmed') => ({ startsAt: t(`2026-10-02T${start}:00+07:00`), endsAt: t(`2026-10-02T${end}:00+07:00`), status });
  assert.equal(rules.blocksSlot(ex('08:00', '09:00'), slot), false, 'ends when the new one starts');
  assert.equal(rules.blocksSlot(ex('10:00', '11:00'), slot), false, 'starts when the new one ends');
  assert.equal(rules.blocksSlot(ex('08:00', '09:15'), slot), true);
  assert.equal(rules.blocksSlot(ex('09:45', '11:00'), slot), true);
  assert.equal(rules.blocksSlot(ex('09:15', '09:30'), slot), true, 'inside');
  assert.equal(rules.blocksSlot(ex('08:00', '11:00'), slot), true, 'around');
  for (const status of ['rejected', 'cancelled', 'expired', 'returned']) {
    assert.equal(rules.blocksSlot(ex('09:00', '10:00', status), slot), false, status);
  }
  assert.equal(rules.blocksSlot(ex('09:00', '10:00', 'pending_approval'), slot), true, 'a pending vehicle booking holds the slot');
});

test('a pending booking whose start passed is ignored; a vehicle in use holds until now', () => {
  const pastPending = { startsAt: t('2026-10-01T09:00:00+07:00'), endsAt: t('2026-10-01T12:00:00+07:00'), status: 'pending_approval' };
  assert.equal(rules.blocksSlot(pastPending, { startsAt: t('2026-10-01T10:30:00+07:00'), endsAt: t('2026-10-01T11:00:00+07:00'), now: NOW }), false);
  const overdue = { startsAt: t('2026-10-01T06:00:00+07:00'), endsAt: t('2026-10-01T08:00:00+07:00'), status: 'in_use' };
  assert.equal(rules.blocksSlot(overdue, { startsAt: t('2026-10-01T09:00:00+07:00'), endsAt: t('2026-10-01T09:30:00+07:00'), now: NOW }), true, 'still out at 10.00');
  assert.equal(rules.blocksSlot(overdue, { startsAt: t('2026-10-01T10:15:00+07:00'), endsAt: t('2026-10-01T11:00:00+07:00'), now: NOW }), false, 'after now is free');
});

test('booking window: 15-minute steps, not in the past, 90 days ahead, room ≤ 12 h, vehicle ≤ 7 days', () => {
  const p = (kind, s, e) => rules.bookingWindowProblem({ kind, startsAt: t(s), endsAt: t(e), now: NOW })?.code || null;
  assert.equal(p('room', '2026-10-01T11:00:00+07:00', '2026-10-01T12:00:00+07:00'), null);
  assert.equal(p('room', '2026-10-01T11:10:00+07:00', '2026-10-01T12:00:00+07:00'), 'BOOKING_STEP');
  assert.equal(p('room', '2026-10-01T12:00:00+07:00', '2026-10-01T12:00:00+07:00'), 'BOOKING_TIME_INVALID');
  assert.equal(p('room', '2026-10-01T09:45:00+07:00', '2026-10-01T11:00:00+07:00'), null, '15 minutes of grace');
  assert.equal(p('room', '2026-10-01T09:30:00+07:00', '2026-10-01T11:00:00+07:00'), 'BOOKING_IN_PAST');
  assert.equal(p('room', '2026-12-31T09:00:00+07:00', '2026-12-31T10:00:00+07:00'), 'BOOKING_TOO_FAR');
  assert.equal(p('room', '2026-10-02T07:00:00+07:00', '2026-10-02T19:15:00+07:00'), 'BOOKING_TOO_LONG');
  assert.equal(p('room', '2026-10-02T07:00:00+07:00', '2026-10-02T19:00:00+07:00'), null);
  assert.equal(p('vehicle', '2026-10-02T07:00:00+07:00', '2026-10-09T07:00:00+07:00'), null);
  assert.equal(p('vehicle', '2026-10-02T07:00:00+07:00', '2026-10-09T07:15:00+07:00'), 'BOOKING_TOO_LONG');
});

test('booking body is strict and times must carry an offset', () => {
  const base = { resourceId: 1, startsAt: '2026-10-02T09:00:00+07:00', endsAt: '2026-10-02T10:00:00+07:00', purpose: 'Rapat' };
  assert.ok(schemas.bookingBody.safeParse(base).success);
  assert.equal(schemas.bookingBody.safeParse({ ...base, startsAt: '2026-10-02 09:00' }).success, false);
  assert.equal(schemas.bookingBody.safeParse({ ...base, status: 'confirmed' }).success, false);
  assert.equal(schemas.bookingBody.safeParse({ ...base, entityId: 2 }).success, false);
  assert.equal(schemas.bookingBody.safeParse({ ...base, requesterUserId: 2 }).success, false);
  assert.equal(schemas.resourceCreate.safeParse({ kind: 'room', name: 'R', locationId: 1, password: 'x' }).success, false);
});

// ------------------------------------------------------------------ database

test('db: a free room is confirmed at once; an overlapping one is refused with time + division only; touching is fine', async (t2) => {
  if (!(await dbReady())) return t2.skip(SKIP);
  await inRolledBackTransaction(t2, async (conn) => {
    const loc = await makeLocation(conn);
    const room = await makeResource(conn, { kind: 'room', locationId: loc });
    const a = await makeUser(conn, { name: 'Sales A', division: 'sales', roles: ['sales.member'] });
    const b = await makeUser(conn, { name: 'Gudang B', division: 'warehouse', roles: ['warehouse.member'] });
    const first = await bookings.createBooking(a.user, { resourceId: room, startsAt: at(1, '09:00'), endsAt: at(1, '10:00'), purpose: 'Rapat klien' });
    assert.equal(first.status, 'confirmed');
    assert.match(first.bookingNumber, /^PJM-\d{6}-\d{4}$/);
    assert.equal(first.approvalRequestId, null);
    await assert.rejects(
      bookings.createBooking(b.user, { resourceId: room, startsAt: at(1, '09:30'), endsAt: at(1, '10:30'), purpose: 'Briefing' }),
      (e) => {
        assert.equal(e.code, 'BOOKING_CONFLICT');
        assert.equal(e.status, 409);
        assert.deepEqual(Object.keys(e.details.clash).sort(), ['departmentName', 'endsAt', 'startsAt']);
        assert.equal(e.details.clash.departmentName, 'Sales');
        assert.ok(!JSON.stringify(e.details).includes('Rapat klien'), 'never the purpose');
        return true;
      },
    );
    const touching = await bookings.createBooking(b.user, { resourceId: room, startsAt: at(1, '10:00'), endsAt: at(1, '11:00'), purpose: 'Briefing' });
    assert.equal(touching.status, 'confirmed');
    await assert.rejects(bookings.createBooking(b.user, { resourceId: room, startsAt: at(1, '10:00'), endsAt: at(1, '11:00'), purpose: 'x', destination: 'Bandung' }), code('VALIDATION_ERROR'));
    await conn.query('UPDATE ga_resources SET is_active = 0 WHERE id = ?', [room]);
    await assert.rejects(bookings.createBooking(b.user, { resourceId: room, startsAt: at(2, '10:00'), endsAt: at(2, '11:00'), purpose: 'x' }), code('RESOURCE_INACTIVE'));
  });
});

test('db: vehicles are borrowed in TrackCar — no vehicle resource, no vehicle booking', async (t2) => {
  if (!(await dbReady())) return t2.skip(SKIP);
  await inRolledBackTransaction(t2, async (conn) => {
    const loc = await makeLocation(conn);
    const staff = await makeUser(conn, { name: 'Staf', division: 'sales', roles: ['sales.member'] });
    const head = await makeUser(conn, { name: 'Kepala P&C', division: 'people_culture', roles: ['people_culture.head'] });
    await assert.rejects(
      bookings.createResource(head.user, { kind: 'vehicle', name: 'Avanza', locationId: loc, plateNumber: 'B 1234 XYZ' }),
      code('VEHICLES_IN_TRACKCAR'),
    );
    // Even a vehicle row that already exists can never be booked here.
    const [car] = await conn.query(
      "INSERT INTO ga_resources (entity_id, location_id, kind, name, plate_number, is_active, created_by) VALUES (1, ?, 'vehicle', 'Mobil lama', 'B 1 UJI', 1, ?)",
      [loc, head.id],
    );
    await assert.rejects(
      bookings.createBooking(staff.user, { resourceId: car.insertId, startsAt: at(2, '08:00'), endsAt: at(2, '17:00'), purpose: 'Kunjungan' }),
      code('VEHICLES_IN_TRACKCAR'),
    );
  });
});

test('db: the agenda masks other people’s bookings for non-processors; WIB day boundaries 23:30–00:30', async (t2) => {
  if (!(await dbReady())) return t2.skip(SKIP);
  await inRolledBackTransaction(t2, async (conn) => {
    const loc = await makeLocation(conn);
    const room = await makeResource(conn, { kind: 'room', locationId: loc });
    const a = await makeUser(conn, { name: 'A', division: 'sales', roles: ['sales.member'] });
    const b = await makeUser(conn, { name: 'B', division: 'warehouse', roles: ['warehouse.member'] });
    const ga = await makeUser(conn, { name: 'GA', division: 'people_culture', roles: ['people_culture.member'] });
    const night = await bookings.createBooking(a.user, { resourceId: room, startsAt: at(3, '23:30'), endsAt: at(4, '00:30'), purpose: 'Wawancara kandidat' });
    const day3 = at(3, '00:00');
    const day4 = at(4, '00:00');
    const day5 = at(5, '00:00');
    const seenByB = await bookings.listBookings(b.user, { from: day3, to: day4, resourceId: room });
    assert.equal(seenByB.length, 1);
    assert.deepEqual(Object.keys(seenByB[0]).sort(), ['departmentName', 'endsAt', 'id', 'masked', 'resourceId', 'resourceKind', 'startsAt']);
    assert.equal(seenByB[0].masked, true);
    assert.equal(seenByB[0].id, null);
    assert.ok(!JSON.stringify(seenByB).includes('Wawancara'));
    assert.equal((await bookings.listBookings(b.user, { from: day4, to: day5, resourceId: room })).length, 1, 'also on the next WIB day');
    assert.equal((await bookings.listBookings(a.user, { from: day3, to: day4, resourceId: room }))[0].purpose, 'Wawancara kandidat', 'own booking in full');
    assert.equal((await bookings.listBookings(ga.user, { from: day3, to: day4, resourceId: room }))[0].purpose, 'Wawancara kandidat', 'GA sees all');
    assert.equal(night.startsAt, at(3, '23:30'));
    await assert.rejects(bookings.getBooking(b.user, night.id), code('NOT_FOUND'));
    await assert.rejects(bookings.listBookings(b.user, { from: day3, to: at(40, '00:00') }), code('RANGE_TOO_LONG'));
    // Cancel: someone else cannot; the requester can before the start.
    await assert.rejects(bookings.cancelBooking(b.user, night.id, { reason: 'x' }), code('NOT_FOUND'));
    assert.equal((await bookings.cancelBooking(a.user, night.id, { reason: 'Diundur' })).status, 'cancelled');
  });
});

// ------------------------------------------------------------------ concurrency (D9)
//
// Two sessions must see the same room, so the room and its location are a
// committed fixture created here and deleted at the end (no service writes, no
// logs). Every booking runs inside its own transaction that is ROLLED BACK.

async function withCommittedRoom(fn) {
  return serialized(() => committedRoom(fn));
}

async function committedRoom(fn) {
  const setup = await mysql.createConnection(buildDbConnectionConfig());
  await setup.query(SESSION_TIME_ZONE_SQL);
  let locId = null;
  let roomId = null;
  try {
    const [loc] = await setup.query('INSERT INTO org_locations (entity_id, name) VALUES (1, ?)', [`[UJI] Paralel ${tag()}`]);
    locId = loc.insertId;
    const [room] = await setup.query("INSERT INTO ga_resources (entity_id, location_id, kind, name) VALUES (1, ?, 'room', ?)", [locId, `[UJI] Ruang paralel ${tag()}`]);
    roomId = room.insertId;
    const [[u]] = await setup.query(
      `SELECT u.id FROM users u WHERE u.entity_id = 1 AND u.status = 'active' AND u.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id
                       JOIN permissions p ON p.id = rp.permission_id AND p.code = 'ga.request.create' WHERE ur.user_id = u.id)
        ORDER BY u.id LIMIT 1`,
    );
    const user = await asUser(setup, u.id);
    return await fn({ roomId, user });
  } finally {
    const [[left]] = await setup.query('SELECT COUNT(*) AS n FROM ga_bookings WHERE resource_id = ?', [roomId || 0]);
    if (roomId) await setup.query('DELETE FROM ga_resources WHERE id = ?', [roomId]);
    if (locId) await setup.query('DELETE FROM org_locations WHERE id = ?', [locId]);
    await setup.end();
    assert.equal(Number(left.n), 0, 'no booking was committed');
  }
}

async function session(lockWaitSeconds) {
  const conn = await mysql.createConnection(buildDbConnectionConfig());
  await conn.query(SESSION_TIME_ZONE_SQL);
  await conn.query('SET SESSION innodb_lock_wait_timeout = ?', [lockWaitSeconds]);
  await conn.beginTransaction();
  return conn;
}
async function close(conn) {
  try { await conn.rollback(); } catch { /* ignore */ }
  try { await conn.query('SELECT RELEASE_ALL_LOCKS()'); } catch { /* ignore */ }
  await conn.end();
}

test('db concurrency: 20 parallel bookings of one slot on separate connections — exactly one gets it', async (t2) => {
  if (!(await dbReady())) return t2.skip(SKIP);
  await withCommittedRoom(async ({ roomId, user }) => {
    const conns = await Promise.all(Array.from({ length: 20 }, () => session(2)));
    try {
      const body = { resourceId: roomId, startsAt: at(5, '09:00'), endsAt: at(5, '10:00'), purpose: 'Rapat paralel' };
      // Every transaction stays open until all 20 have an answer: the winner
      // keeps the room's row lock, so the others cannot slip past the check.
      const results = await Promise.allSettled(conns.map((conn) => bookings.createBooking(user, body, { conn })));
      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r) => r.status === 'rejected');
      assert.equal(won.length, 1, JSON.stringify(lost.map((r) => r.reason?.code)));
      assert.equal(lost.length, 19);
      for (const r of lost) assert.ok(['BOOKING_BUSY', 'BOOKING_CONFLICT'].includes(r.reason.code), r.reason.code);
    } finally {
      await Promise.all(conns.map(close));
    }
  });
});

test('db concurrency: a second booking waits for the first transaction’s lock, then sees the room free after its rollback', async (t2) => {
  if (!(await dbReady())) return t2.skip(SKIP);
  await withCommittedRoom(async ({ roomId, user }) => {
    const a = await session(10);
    const b = await session(10);
    try {
      const body = { resourceId: roomId, startsAt: at(6, '13:00'), endsAt: at(6, '14:00'), purpose: 'Rapat' };
      const first = await bookings.createBooking(user, body, { conn: a });
      assert.ok(first.id);
      let settled = false;
      const second = bookings.createBooking(user, { ...body, startsAt: at(6, '13:30'), endsAt: at(6, '14:30') }, { conn: b })
        .finally(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 600));
      assert.equal(settled, false, 'B is blocked on the room row while A holds it');
      // As shared.transaction() does: end the transaction, then free the
      // numbering lock (a session lock, held until after commit/rollback).
      await a.rollback();
      await a.query('SELECT RELEASE_ALL_LOCKS()');
      const out = await second;
      assert.ok(out.id, 'after A rolled back, B checked the latest state and got the room');
    } finally {
      await close(a);
      await close(b);
    }
  });
});
