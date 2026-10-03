const pool = require('../../db/pool');
const { MAX_ITEMS_PER_SOURCE, int, round1, scope, escalationItem, byDepartment } = require('../helpers');
const { REQUEST_TYPE_LABELS } = require('../../services/gaRules');
const {
  MAINTENANCE_OVERDUE, MAINTENANCE_DUE_SOON, CONTRACT_DECISION_ON, CONTRACT_ENDING, BILL_OVERDUE,
} = require('../../services/gaOps.service');
const {
  MAINTENANCE_CATEGORY_LABELS, CONTRACT_KIND_LABELS, UTILITY_LABELS, MAINTENANCE_SOON_DAYS,
} = require('../../config/gaOps');

// Layanan GA (People & Culture wave 2, row 2.2; docs/rancangan-people-culture-g2.md §3.6)
// and Operasional GA (migration 114: upkeep, contracts, utility bills).
//
// Division: a request or booking belongs to the requester's division at the
// time it was made (ga_requests.department_id / ga_bookings.department_id) —
// a Warehouse Head sees their own team's overdue requests and late vehicles.
// GA itself (People & Culture) works them; the management view is about whose
// requests are waiting. Records without a division appear only entity-wide.
//
// Time targets (SLA) are stored per request when its clock starts (gaRules),
// so "overdue" is simply due_at in the past while the request is still open.

const OPEN = "('open', 'in_progress')";
const TODAY_WIB = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';

async function overdueRequests(entityId, { departmentId }) {
  const s = scope(departmentId, 'r.department_id');
  const [rows] = await pool.query(
    `SELECT r.id, r.request_number, r.request_type, r.title, r.department_id, d.name AS department_name,
            COALESCE(au.name, ru.name) AS owner_name, r.due_at,
            DATEDIFF(${TODAY_WIB}, DATE(r.due_at + INTERVAL 7 HOUR)) AS days_late
       FROM ga_requests r
       LEFT JOIN departments d ON d.id = r.department_id
       LEFT JOIN users au ON au.id = r.assigned_to
       LEFT JOIN users ru ON ru.id = r.requester_user_id
      WHERE r.entity_id = ?${s.sql}
        AND r.status IN ${OPEN}
        AND r.due_at < UTC_TIMESTAMP()
      ORDER BY r.due_at ASC, r.id ASC
      LIMIT ${MAX_ITEMS_PER_SOURCE}`,
    [entityId, ...s.args],
  );
  return rows.map((r) => escalationItem({
    sourceId: r.id,
    title: r.title,
    reference: r.request_number,
    context: `${REQUEST_TYPE_LABELS[r.request_type] || 'Permintaan'} lewat target waktu`,
    departmentId: r.department_id,
    departmentName: r.department_name,
    ownerName: r.owner_name,
    daysLate: r.days_late,
    since: r.due_at,
    link: `/ga/requests/${r.id}`,
  }));
}

// ---------------------------------------------------------------- Operasional GA
// Upkeep, contracts and utility bills (migration 114) belong to the People &
// Culture division (department_id set by the service), so a P&C Head sees
// them and other Heads do not. Never an amount of money: the management
// views are seen by every Head.
//
// Episodes (id × 100000 + days since 2000-01-01): the next upkeep cycle or a
// renewed contract is a new open escalation, not the old one marked done.
const EPISODE_FACTOR = 100000;
const episodeId = (id, day) => Number(id) * EPISODE_FACTOR + Number(day);
const rowOfEpisode = (id) => Math.floor(Number(id) / EPISODE_FACTOR);
const opsLink = (tab, id) => `/ga/operations?tab=${tab}&open=${id}`;

async function maintenanceOverdue(entityId, { departmentId }) {
  const s = scope(departmentId, 'm.department_id');
  const [rows] = await pool.query(
    `SELECT m.id, m.name, m.category, m.department_id, d.name AS department_name, loc.name AS location_name,
            DATE_FORMAT(m.next_due_on, '%Y-%m-%d') AS due_on, m.next_due_on AS since,
            DATEDIFF(m.next_due_on, '2000-01-01') AS due_day,
            DATEDIFF(${TODAY_WIB}, m.next_due_on) AS days_late
       FROM ga_maintenance_items m
       LEFT JOIN departments d ON d.id = m.department_id
       LEFT JOIN org_locations loc ON loc.entity_id = m.entity_id AND loc.id = m.location_id
      WHERE m.entity_id = ?${s.sql}
        AND ${MAINTENANCE_OVERDUE('m')}
      ORDER BY m.next_due_on ASC, m.id ASC
      LIMIT ${MAX_ITEMS_PER_SOURCE}`,
    [entityId, ...s.args],
  );
  return rows.map((r) => escalationItem({
    sourceId: episodeId(r.id, r.due_day),
    title: r.name,
    reference: r.location_name || null,
    context: `${MAINTENANCE_CATEGORY_LABELS[r.category] || 'Perawatan'} — jadwal ${r.due_on}, belum dicatat selesai`,
    departmentId: r.department_id,
    departmentName: r.department_name,
    daysLate: r.days_late,
    since: r.since,
    link: opsLink('maintenance', r.id),
  }));
}

async function contractsEnding(entityId, { departmentId }) {
  const s = scope(departmentId, 'c.department_id');
  const [rows] = await pool.query(
    `SELECT c.id, c.vendor_name, c.kind, c.department_id, d.name AS department_name,
            DATE_FORMAT(c.end_on, '%Y-%m-%d') AS end_on, ${CONTRACT_DECISION_ON('c')} AS since,
            DATEDIFF(c.end_on, '2000-01-01') AS end_day,
            DATEDIFF(${TODAY_WIB}, ${CONTRACT_DECISION_ON('c')}) AS days_late
       FROM ga_contracts c
       LEFT JOIN departments d ON d.id = c.department_id
      WHERE c.entity_id = ?${s.sql}
        AND ${CONTRACT_ENDING('c')}
      ORDER BY c.end_on ASC, c.id ASC
      LIMIT ${MAX_ITEMS_PER_SOURCE}`,
    [entityId, ...s.args],
  );
  return rows.map((r) => escalationItem({
    sourceId: episodeId(r.id, r.end_day),
    title: r.vendor_name,
    reference: CONTRACT_KIND_LABELS[r.kind] || null,
    referenceLabel: true,
    context: `Kontrak berakhir ${r.end_on} — putuskan perpanjang atau ganti vendor`,
    departmentId: r.department_id,
    departmentName: r.department_name,
    daysLate: r.days_late,
    since: r.since,
    link: opsLink('contracts', r.id),
  }));
}

async function billsOverdue(entityId, { departmentId }) {
  const s = scope(departmentId, 'b.department_id');
  const [rows] = await pool.query(
    `SELECT b.id, b.utility, b.period, b.department_id, d.name AS department_name, loc.name AS location_name,
            DATE_FORMAT(b.due_on, '%Y-%m-%d') AS due_on, b.due_on AS since,
            DATEDIFF(${TODAY_WIB}, b.due_on) AS days_late
       FROM ga_utility_bills b
       LEFT JOIN departments d ON d.id = b.department_id
       LEFT JOIN org_locations loc ON loc.entity_id = b.entity_id AND loc.id = b.location_id
      WHERE b.entity_id = ?${s.sql}
        AND ${BILL_OVERDUE('b')}
      ORDER BY b.due_on ASC, b.id ASC
      LIMIT ${MAX_ITEMS_PER_SOURCE}`,
    [entityId, ...s.args],
  );
  return rows.map((r) => escalationItem({
    sourceId: r.id,
    title: `${UTILITY_LABELS[r.utility] || 'Utilitas'} ${r.period}`,
    reference: r.location_name || null,
    context: `Jatuh tempo ${r.due_on}, belum dibayar — ajukan pembayaran ke Finance`,
    departmentId: r.department_id,
    departmentName: r.department_name,
    daysLate: r.days_late,
    since: r.since,
    link: opsLink('bills', r.id),
  }));
}

// Upkeep recorded in the period, per division: count and on time (done on or
// before the date it was due when recorded).
async function upkeepInPeriod(entityId, period, departmentId) {
  const s = scope(departmentId, 'm.department_id');
  const [rows] = await pool.query(
    `SELECT m.department_id, COUNT(*) AS done, SUM(g.due_on IS NULL OR g.done_on <= g.due_on) AS on_time
       FROM ga_maintenance_logs g
       JOIN ga_maintenance_items m ON m.entity_id = g.entity_id AND m.id = g.item_id
      WHERE g.entity_id = ?${s.sql}
        AND g.done_on BETWEEN ? AND ?
      GROUP BY m.department_id`,
    [entityId, ...s.args, period.start, period.end],
  );
  return rows;
}

const locator = (table) => async (id) => {
  const [[row]] = await pool.query(`SELECT entity_id, department_id FROM ${table} WHERE id = ? LIMIT 1`, [id]);
  return row ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null } : null;
};

// Requests finished in the period, per division: count, on time, and the
// average days from the clock start to done.
async function doneInPeriod(entityId, period, departmentId) {
  const s = scope(departmentId, 'r.department_id');
  const [rows] = await pool.query(
    `SELECT r.department_id,
            COUNT(*) AS done,
            SUM(r.done_at <= r.due_at) AS on_time,
            AVG(TIMESTAMPDIFF(MINUTE, r.clock_started_at, r.done_at)) / 1440 AS avg_days
       FROM ga_requests r
      WHERE r.entity_id = ?${s.sql}
        AND r.status = 'done'
        AND r.done_at BETWEEN ? - INTERVAL 7 HOUR AND ? - INTERVAL 7 HOUR
      GROUP BY r.department_id`,
    [entityId, ...s.args, period.start, `${period.end} 23:59:59`],
  );
  return rows;
}

// No alarm (and no zero that reads like a result) while the entity has never
// used Layanan GA.
async function hasGaData(entityId) {
  const [[row]] = await pool.query(
    `SELECT (EXISTS (SELECT 1 FROM ga_requests WHERE entity_id = ?)
          OR EXISTS (SELECT 1 FROM ga_bookings WHERE entity_id = ?)) AS any_data`,
    [entityId, entityId],
  );
  return Boolean(Number(row?.any_data));
}

module.exports = {
  key: 'ga',
  label: 'Layanan GA',
  navPaths: ['/ga', '/ga/operations'],

  escalations: [
    {
      key: 'ga_request_overdue',
      label: 'Permintaan GA lewat target',
      list: overdueRequests,
      locate: locator('ga_requests'),
    },
    {
      key: 'ga_maintenance_overdue',
      label: 'Perawatan berkala lewat jadwal',
      list: maintenanceOverdue,
      locate: (id) => locator('ga_maintenance_items')(rowOfEpisode(id)),
    },
    {
      key: 'ga_contract_ending',
      label: 'Kontrak GA segera berakhir',
      list: contractsEnding,
      locate: (id) => locator('ga_contracts')(rowOfEpisode(id)),
    },
    {
      key: 'ga_bill_overdue',
      label: 'Tagihan utilitas lewat jatuh tempo',
      list: billsOverdue,
      locate: locator('ga_utility_bills'),
    },
  ],

  metrics: [
    {
      key: 'ga_requests_done',
      label: 'Permintaan GA selesai',
      unit: 'item',
      better: 'higher',
      cumulative: true,
      emptyIsZero: true,
      async actuals(entityId, period, { departmentId }) {
        return byDepartment(await doneInPeriod(entityId, period, departmentId), (r) => int(r.done));
      },
    },
    {
      key: 'ga_requests_on_time',
      label: 'Permintaan GA selesai tepat waktu',
      unit: '%',
      better: 'higher',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        // A rate over nothing is not 0% — it is unknown.
        return byDepartment(await doneInPeriod(entityId, period, departmentId), (r) => {
          const done = int(r.done);
          return done ? round1((int(r.on_time) / done) * 100) : null;
        });
      },
    },
    {
      key: 'ga_resolution_days',
      label: 'Rata-rata hari penyelesaian GA',
      unit: 'hari',
      better: 'lower',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        return byDepartment(await doneInPeriod(entityId, period, departmentId), (r) => (
          r.avg_days == null ? null : round1(Number(r.avg_days))
        ));
      },
    },
    {
      key: 'ga_upkeep_done',
      label: 'Perawatan berkala selesai',
      unit: 'item',
      better: 'higher',
      cumulative: true,
      emptyIsZero: true,
      async actuals(entityId, period, { departmentId }) {
        return byDepartment(await upkeepInPeriod(entityId, period, departmentId), (r) => int(r.done));
      },
    },
    {
      key: 'ga_upkeep_on_time',
      label: 'Perawatan berkala tepat jadwal',
      unit: '%',
      better: 'higher',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        return byDepartment(await upkeepInPeriod(entityId, period, departmentId), (r) => {
          const done = int(r.done);
          return done ? round1((int(r.on_time) / done) * 100) : null;
        });
      },
    },
  ],

  kpis: [
    {
      key: 'ga_open_requests',
      label: 'Permintaan GA berjalan',
      unit: 'item',
      async value(entityId, { departmentId }) {
        if (!(await hasGaData(entityId))) return { value: null, sub: 'Belum ada permintaan GA', alert: false };
        const s = scope(departmentId, 'r.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS open_count, SUM(r.due_at < UTC_TIMESTAMP()) AS late
             FROM ga_requests r
            WHERE r.entity_id = ?${s.sql} AND r.status IN ${OPEN}`,
          [entityId, ...s.args],
        );
        const late = int(row?.late);
        return { value: int(row?.open_count), sub: `${late} lewat target`, alert: late > 0 };
      },
    },
    {
      key: 'ga_upkeep_overdue',
      label: 'Perawatan lewat jadwal',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'm.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS total, SUM(${MAINTENANCE_OVERDUE('m')}) AS overdue, SUM(${MAINTENANCE_DUE_SOON('m')}) AS soon
             FROM ga_maintenance_items m
            WHERE m.entity_id = ?${s.sql} AND m.status = 'active'`,
          [entityId, ...s.args],
        );
        if (!int(row?.total)) return { value: null, sub: 'Belum ada jadwal perawatan', alert: false };
        const overdue = int(row?.overdue);
        return { value: overdue, sub: `${int(row?.soon)} jatuh tempo ${MAINTENANCE_SOON_DAYS} hari ke depan`, alert: overdue > 0 };
      },
    },
  ],
};

module.exports.EPISODE_FACTOR = EPISODE_FACTOR;
