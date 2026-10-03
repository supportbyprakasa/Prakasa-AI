const pool = require('../../db/pool');
const { MAX_ITEMS_PER_SOURCE, int, num, round1, scope, escalationItem, byDepartment } = require('../helpers');
const {
  HOLDER_JOINS, HOLDER_NAME, HOLDER_RESIGNED, RESIGN_DAY,
} = require('../../services/deviceHolderSql');
// Infrastructure registers (wave 2, row 2.3): ISP, backup, CCTV, Google Workspace, phone lines.
const infra = require('../itInfraItems');

// IT — tickets, devices and software subscriptions (People & Culture).
//
// Division, per table:
//   it_tickets             → department_id is the REQUESTER's division (the
//                            controller stamps req.user.departmentId on create),
//                            so a Warehouse Head sees their own team's stuck
//                            tickets, and People & Culture sees theirs.
//   devices                → department_id is the division that owns the asset.
//   device_assignments     → department_id is the division the device was lent to.
//   software_subscriptions → department_id is the division that owns the
//                            subscription. Company-wide subscriptions (Google
//                            Workspace…) carry no department and therefore only
//                            appear in the entity-wide view — never pushed onto
//                            a division Head (§6 of the integration doc).
//
// it_tickets and device_assignments have no deleted_at: tickets end in
// closed/cancelled and assignments in returned/lost/transferred instead. The
// device behind an assignment must itself not be soft-deleted.

// ---------------------------------------------------------------- tickets
// Resolution target per priority, in calendar days from the ticket being
// raised. The schema has no SLA column, so the targets live here.
const SLA_DAYS = Object.freeze({ urgent: 1, high: 2, normal: 5, low: 10 });
const SLA_DAYS_SQL = `(CASE t.priority WHEN 'urgent' THEN ${SLA_DAYS.urgent} WHEN 'high' THEN ${SLA_DAYS.high}
  WHEN 'low' THEN ${SLA_DAYS.low} ELSE ${SLA_DAYS.normal} END)`;
const SLA_DEADLINE = `DATE_ADD(t.created_at, INTERVAL ${SLA_DAYS_SQL} DAY)`;
// IT is on the clock only while a ticket is open or being worked on:
// waiting_on_user is with the requester, resolved is done pending closure.
const IT_OWES = "('open', 'in_progress')";
const OPEN_TICKET = "('open', 'in_progress', 'waiting_on_user')";
const TICKET_LATE = `t.status IN ${IT_OWES} AND NOW() > ${SLA_DEADLINE}`;

const CATEGORY_LABEL = {
  device_damage: 'Kerusakan perangkat',
  new_device_request: 'Permintaan perangkat',
  access_software: 'Akses & software',
  network: 'Jaringan',
};
const PRIORITY_LABEL = { urgent: 'mendesak', high: 'tinggi', normal: 'normal', low: 'rendah' };

// ---------------------------------------------------------------- devices
// A device out for repair or maintenance this long leaves someone without a
// working device — two weeks is past any normal service turnaround.
const SERVICE_DAYS = 14;
const IN_SERVICE = "('repair', 'maintenance')";
// When it went into service: the open repair report if there is one (filing a
// repair is what flips a device to 'repair'), else the day its status last
// changed (status_changed_at, rule 14 — an edit of the notes does not restart it).
const SERVICE_SINCE = `COALESCE(
    (SELECT MAX(rl.reported_date) FROM device_repair_logs rl
      WHERE rl.device_id = d.id AND rl.status IN ('reported', 'in_repair')),
    DATE(d.status_changed_at + INTERVAL 7 HOUR))`;

// A device Rusak (broken, not at a vendor) this long is neither repaired nor
// written off — same two weeks as a device stuck at the vendor.
const DAMAGED_DAYS = 14;
const DAMAGED_SINCE = 'DATE(d.status_changed_at + INTERVAL 7 HOUR)';
const DAMAGED_LATE = `d.status = 'damaged' AND ${DAMAGED_SINCE} < DATE_SUB(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), INTERVAL ${DAMAGED_DAYS} DAY)`;
// A leaver keeps their device a few days at most (handover on the last day);
// after that a device still Aktif in the hands of someone who resigned escalates.
const RESIGNED_HOLDER_DAYS = 3;
const RESIGNED_LATE = `${HOLDER_RESIGNED}
  AND ${RESIGN_DAY} < DATE_SUB(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), INTERVAL ${RESIGNED_HOLDER_DAYS} DAY)
  AND NOT EXISTS (
    SELECT 1 FROM device_assignments ra
      JOIN hrga_workflow_tasks ht ON ht.linked_device_assignment_id = ra.id
      JOIN hrga_workflows hw ON hw.id = ht.hrga_workflow_id
     WHERE ra.device_id = d.id AND ra.status = 'active'
       AND hw.deleted_at IS NULL AND hw.workflow_type = 'offboarding'
       AND hw.status IN ('approved', 'in_progress'))`;
// One episode per device and day (id × 100000 + days since 2000-01-01): a
// device repaired and broken again, or handed to someone who resigns later,
// comes back as a new open escalation.
const EPISODE_FACTOR = 100000;
const episodeId = (deviceId, day) => Number(deviceId) * EPISODE_FACTOR + Number(day);
const deviceOfEpisode = (id) => Math.floor(Number(id) / EPISODE_FACTOR);
const PROBLEMATIC = "('damaged', 'retired')";
const DEVICE_STUCK = `d.status IN ${IN_SERVICE} AND ${SERVICE_SINCE} < DATE_SUB(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), INTERVAL ${SERVICE_DAYS} DAY)`;

// ---------------------------------------------------------- subscriptions
// Same notice window as the itReminders job: 30 days before renewal_date it
// flips the subscription to 'expiring' and notifies the PIC. The PIC then has
// until DECISION_LEAD_DAYS before the renewal date to raise a renewal request
// (or cancel); after that the renewal is escalated. Auto-renewing
// subscriptions need no decision.
const RENEWAL_NOTICE_DAYS = 30; // == itReminders "subscription akan renewal (30 hari)"
const DECISION_LEAD_DAYS = 14;
const DECISION_DEADLINE = `DATE_SUB(s.renewal_date, INTERVAL ${DECISION_LEAD_DAYS} DAY)`;
// A renewal request for this cycle — pending (already reported by the
// `approvals` provider while it waits in approval_requests, so it must not be
// reported again here), approved, rejected or completed — is a decision.
const RENEWAL_UNDECIDED = `s.status IN ('active', 'expiring')
  AND s.auto_renew = 0
  AND ${DECISION_DEADLINE} < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)
  AND NOT EXISTS (
    SELECT 1 FROM subscription_renewals r
     WHERE r.subscription_id = s.id
       AND r.status <> 'cancelled'
       AND r.proposed_renewal_date > s.renewal_date)`;

// ------------------------------------------------------ device returns
// Same rule as itReminders "device belum dikembalikan": an active assignment
// past its expected_return_date. A leaver's device is excluded while their
// offboarding is running — the `hrga` provider already reports that return.
const RETURN_LATE = `a.status = 'active'
  AND a.expected_return_date IS NOT NULL
  AND a.expected_return_date < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)
  AND NOT EXISTS (
    SELECT 1 FROM hrga_workflow_tasks ht
      JOIN hrga_workflows hw ON hw.id = ht.hrga_workflow_id
     WHERE ht.linked_device_assignment_id = a.id
       AND hw.deleted_at IS NULL
       AND hw.workflow_type = 'offboarding'
       AND hw.status IN ('approved', 'in_progress'))`;

const located = (row) => (row
  ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null }
  : null);

const deviceName = (row) => [row.brand, row.model].filter(Boolean).join(' ') || row.device_type;

async function ticketsResolved(entityId, period, departmentId) {
  const s = scope(departmentId, 't.department_id');
  const [rows] = await pool.query(
    `SELECT t.department_id,
            COUNT(*) AS resolved,
            AVG(TIMESTAMPDIFF(HOUR, t.created_at, t.resolved_at)) / 24 AS avg_days,
            SUM(t.resolved_at <= ${SLA_DEADLINE}) AS within_sla
       FROM it_tickets t
      WHERE t.entity_id = ?${s.sql}
        AND t.status IN ('resolved', 'closed')
        AND t.resolved_at BETWEEN ? - INTERVAL 7 HOUR AND ? - INTERVAL 7 HOUR
      GROUP BY t.department_id`,
    [entityId, ...s.args, period.start, `${period.end} 23:59:59`]
  );
  return rows;
}

module.exports = {
  key: 'it',
  label: 'IT',
  navPaths: ['/it/tickets', '/it/dashboard', '/it/devices', '/it/subscriptions', '/it/infrastructure'],

  escalations: [
    {
      key: 'it_ticket_overdue',
      label: 'Tiket IT lewat SLA',
      async list(entityId, { departmentId }) {
        const s = scope(departmentId, 't.department_id');
        const [rows] = await pool.query(
          `SELECT t.id, t.title, t.category, t.priority, t.department_id, d.name AS department_name,
                  u.name AS owner_name,
                  ${SLA_DEADLINE} AS since,
                  DATEDIFF(UTC_TIMESTAMP() + INTERVAL 7 HOUR, ${SLA_DEADLINE} + INTERVAL 7 HOUR) AS days_late
             FROM it_tickets t
             LEFT JOIN departments d ON d.id = t.department_id
             LEFT JOIN users u ON u.id = t.requester_id
            WHERE t.entity_id = ?${s.sql}
              AND ${TICKET_LATE}
            ORDER BY days_late DESC, t.id ASC
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args]
        );
        return rows.map((row) => escalationItem({
          sourceId: row.id,
          title: row.title,
          reference: `TIK-${row.id}`,
          context: `${CATEGORY_LABEL[row.category] || row.category} · prioritas ${PRIORITY_LABEL[row.priority] || row.priority}`,
          departmentId: row.department_id,
          departmentName: row.department_name,
          ownerName: row.owner_name,
          daysLate: row.days_late,
          since: row.since,
          link: `/it/tickets/${row.id}`,
        }));
      },
      async locate(id) {
        const [[row]] = await pool.query('SELECT entity_id, department_id FROM it_tickets WHERE id = ? LIMIT 1', [id]);
        return located(row);
      },
    },
    {
      key: 'it_device_in_service',
      label: 'Perangkat tertahan di servis',
      async list(entityId, { departmentId }) {
        const s = scope(departmentId, 'd.department_id');
        const [rows] = await pool.query(
          `SELECT d.id, d.asset_code, d.device_type, d.brand, d.model, d.status,
                  d.department_id, dep.name AS department_name, u.name AS owner_name,
                  ${SERVICE_SINCE} AS since,
                  DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), ${SERVICE_SINCE}) - ${SERVICE_DAYS} AS days_late
             FROM devices d
             LEFT JOIN departments dep ON dep.id = d.department_id
             LEFT JOIN users u ON u.id = d.current_assignee_id
            WHERE d.entity_id = ?${s.sql}
              AND d.deleted_at IS NULL
              AND ${DEVICE_STUCK}
            ORDER BY days_late DESC, d.id ASC
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args]
        );
        return rows.map((row) => escalationItem({
          sourceId: row.id,
          title: deviceName(row),
          reference: row.asset_code,
          context: `${row.status === 'repair' ? 'Dalam perbaikan' : 'Dalam maintenance'} lebih dari ${SERVICE_DAYS} hari`,
          departmentId: row.department_id,
          departmentName: row.department_name,
          ownerName: row.owner_name,
          daysLate: row.days_late,
          since: row.since,
          link: `/it/devices/${row.id}`,
        }));
      },
      async locate(id) {
        const [[row]] = await pool.query(
          'SELECT entity_id, department_id FROM devices WHERE id = ? AND deleted_at IS NULL LIMIT 1',
          [id]
        );
        return located(row);
      },
    },
    {
      key: 'it_device_damaged',
      label: 'Perangkat rusak belum ditangani',
      async list(entityId, { departmentId }) {
        const s = scope(departmentId, 'd.department_id');
        const [rows] = await pool.query(
          `SELECT d.id, d.asset_code, d.device_type, d.brand, d.model, d.serial_number,
                  d.department_id, dep.name AS department_name, loc.name AS location_name,
                  d.status_changed_at AS since,
                  DATEDIFF(${DAMAGED_SINCE}, '2000-01-01') AS since_day,
                  DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), ${DAMAGED_SINCE}) - ${DAMAGED_DAYS} AS days_late
             FROM devices d
             LEFT JOIN departments dep ON dep.id = d.department_id
             LEFT JOIN org_locations loc ON loc.id = d.location_id
            WHERE d.entity_id = ?${s.sql}
              AND d.deleted_at IS NULL
              AND ${DAMAGED_LATE}
            ORDER BY days_late DESC, d.id ASC
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args]
        );
        return rows.map((row) => escalationItem({
          sourceId: episodeId(row.id, row.since_day),
          title: deviceName(row),
          reference: row.asset_code || row.serial_number || null,
          context: `Rusak lebih dari ${DAMAGED_DAYS} hari — perbaiki (kirim ke vendor) atau nyatakan tidak aktif${row.location_name ? ` · ${row.location_name}` : ''}`,
          departmentId: row.department_id,
          departmentName: row.department_name,
          ownerName: null,
          daysLate: row.days_late,
          since: row.since,
          link: `/it/devices/${row.id}`,
        }));
      },
      async locate(id) {
        const [[row]] = await pool.query(
          'SELECT entity_id, department_id FROM devices WHERE id = ? AND deleted_at IS NULL LIMIT 1',
          [deviceOfEpisode(id)]
        );
        return located(row);
      },
    },
    {
      key: 'it_device_resigned_holder',
      label: 'Perangkat di tangan karyawan resign',
      async list(entityId, { departmentId }) {
        const s = scope(departmentId, 'd.department_id');
        const [rows] = await pool.query(
          `SELECT d.id, d.asset_code, d.device_type, d.brand, d.model, d.serial_number,
                  d.department_id, dep.name AS department_name,
                  ${HOLDER_NAME} AS owner_name,
                  ${RESIGN_DAY} AS since,
                  DATEDIFF(${RESIGN_DAY}, '2000-01-01') AS since_day,
                  DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), ${RESIGN_DAY}) - ${RESIGNED_HOLDER_DAYS} AS days_late
             FROM devices d
             LEFT JOIN departments dep ON dep.id = d.department_id
             ${HOLDER_JOINS}
            WHERE d.entity_id = ?${s.sql}
              AND d.deleted_at IS NULL
              AND ${RESIGNED_LATE}
            ORDER BY days_late DESC, d.id ASC
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args]
        );
        return rows.map((row) => escalationItem({
          sourceId: episodeId(row.id, row.since_day),
          title: deviceName(row),
          reference: row.asset_code || row.serial_number || null,
          context: `Pemegang sudah resign lebih dari ${RESIGNED_HOLDER_DAYS} hari — tarik perangkat dan kembalikan`,
          departmentId: row.department_id,
          departmentName: row.department_name,
          ownerName: row.owner_name,
          daysLate: row.days_late,
          since: row.since,
          link: `/it/devices/${row.id}`,
        }));
      },
      async locate(id) {
        const [[row]] = await pool.query(
          'SELECT entity_id, department_id FROM devices WHERE id = ? AND deleted_at IS NULL LIMIT 1',
          [deviceOfEpisode(id)]
        );
        return located(row);
      },
    },
    {
      key: 'it_device_return_late',
      label: 'Perangkat belum dikembalikan',
      async list(entityId, { departmentId }) {
        const s = scope(departmentId, 'a.department_id');
        const [rows] = await pool.query(
          `SELECT a.id, a.device_id, a.department_id, dep.name AS department_name,
                  d.asset_code, d.device_type, d.brand, d.model,
                  u.name AS owner_name, a.expected_return_date AS since,
                  DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), a.expected_return_date) AS days_late
             FROM device_assignments a
             JOIN devices d ON d.id = a.device_id AND d.deleted_at IS NULL
             LEFT JOIN departments dep ON dep.id = a.department_id
             LEFT JOIN users u ON u.id = a.assigned_to
            WHERE a.entity_id = ?${s.sql}
              AND ${RETURN_LATE}
            ORDER BY days_late DESC, a.id ASC
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args]
        );
        return rows.map((row) => escalationItem({
          sourceId: row.id,
          title: deviceName(row),
          reference: row.asset_code,
          context: 'Lewat tanggal pengembalian',
          departmentId: row.department_id,
          departmentName: row.department_name,
          ownerName: row.owner_name,
          daysLate: row.days_late,
          since: row.since,
          link: `/it/devices/${row.device_id}`,
        }));
      },
      async locate(id) {
        const [[row]] = await pool.query(
          `SELECT a.entity_id, a.department_id
             FROM device_assignments a
             JOIN devices d ON d.id = a.device_id AND d.deleted_at IS NULL
            WHERE a.id = ? LIMIT 1`,
          [id]
        );
        return located(row);
      },
    },
    {
      key: 'it_subscription_undecided',
      label: 'Perpanjangan langganan belum diputuskan',
      async list(entityId, { departmentId }) {
        const s = scope(departmentId, 's.department_id');
        const [rows] = await pool.query(
          `SELECT s.id, s.product_name, s.plan_name, DATE_FORMAT(s.renewal_date, '%Y-%m-%d') AS renewal_date,
                  s.department_id,
                  dep.name AS department_name, u.name AS owner_name, v.name AS vendor_name,
                  ${DECISION_DEADLINE} AS since,
                  DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), ${DECISION_DEADLINE}) AS days_late
             FROM software_subscriptions s
             LEFT JOIN departments dep ON dep.id = s.department_id
             LEFT JOIN users u ON u.id = s.pic_user_id
             LEFT JOIN software_vendors v ON v.id = s.vendor_id
            WHERE s.entity_id = ?${s.sql}
              AND s.deleted_at IS NULL
              AND ${RENEWAL_UNDECIDED}
            ORDER BY days_late DESC, s.id ASC
            LIMIT ${MAX_ITEMS_PER_SOURCE}`,
          [entityId, ...s.args]
        );
        return rows.map((row) => escalationItem({
          sourceId: row.id,
          title: [row.product_name, row.plan_name].filter(Boolean).join(' — '),
          reference: row.vendor_name || null,
          context: `Renewal ${row.renewal_date || '-'}, belum ada keputusan perpanjangan`,
          departmentId: row.department_id,
          departmentName: row.department_name,
          ownerName: row.owner_name,
          daysLate: row.days_late,
          since: row.since,
          link: `/it/subscriptions/${row.id}`,
        }));
      },
      async locate(id) {
        const [[row]] = await pool.query(
          'SELECT entity_id, department_id FROM software_subscriptions WHERE id = ? AND deleted_at IS NULL LIMIT 1',
          [id]
        );
        return located(row);
      },
    },
    ...infra.escalations,
  ],

  metrics: [
    {
      key: 'it_tickets_resolved',
      label: 'Tiket IT diselesaikan',
      unit: 'item',
      better: 'higher',
      cumulative: true,
      emptyIsZero: true,
      async actuals(entityId, period, { departmentId }) {
        return byDepartment(await ticketsResolved(entityId, period, departmentId), (r) => int(r.resolved));
      },
    },
    {
      key: 'it_ticket_resolution_days',
      label: 'Rata-rata waktu penyelesaian tiket IT',
      unit: 'hari',
      better: 'lower',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        return byDepartment(await ticketsResolved(entityId, period, departmentId), (r) => {
          const avg = num(r.avg_days);
          return avg == null ? null : round1(avg);
        });
      },
    },
    {
      key: 'it_tickets_within_sla',
      label: 'Tiket IT selesai sesuai SLA',
      unit: '%',
      better: 'higher',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        // A rate over nothing is not 0% — it is unknown.
        return byDepartment(await ticketsResolved(entityId, period, departmentId), (r) => {
          const resolved = int(r.resolved);
          return resolved ? round1((int(r.within_sla) / resolved) * 100) : null;
        });
      },
    },
    ...infra.metrics,
  ],

  kpis: [
    {
      key: 'it_open_tickets',
      label: 'Tiket IT terbuka',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 't.department_id');
        const [[row]] = await pool.query(
          `SELECT SUM(t.status IN ${OPEN_TICKET}) AS open_tickets,
                  SUM(${TICKET_LATE}) AS late
             FROM it_tickets t
            WHERE t.entity_id = ?${s.sql}`,
          [entityId, ...s.args]
        );
        const late = int(row?.late);
        return { value: int(row?.open_tickets), sub: `${late} lewat SLA`, alert: late > 0 };
      },
    },
    {
      // Old dashboard figure devicesInService, unchanged.
      key: 'it_devices_in_service',
      label: 'Perangkat dalam servis',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'd.department_id');
        const [[row]] = await pool.query(
          `SELECT SUM(d.status IN ${IN_SERVICE}) AS in_service,
                  SUM(${DEVICE_STUCK}) AS stuck
             FROM devices d
            WHERE d.entity_id = ?${s.sql} AND d.deleted_at IS NULL`,
          [entityId, ...s.args]
        );
        const stuck = int(row?.stuck);
        return { value: int(row?.in_service), sub: `${stuck} lebih dari ${SERVICE_DAYS} hari`, alert: stuck > 0 };
      },
    },
    {
      // The report's "Problematic Devices": Rusak + Tidak aktif (rule 23). No
      // alarm while the entity has no devices; the alarm is Rusak too long.
      key: 'it_devices_problematic',
      label: 'Perangkat bermasalah',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'd.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS total,
                  SUM(d.status IN ${PROBLEMATIC}) AS problematic,
                  SUM(d.status = 'damaged') AS damaged,
                  SUM(d.status = 'retired') AS retired,
                  SUM(${DAMAGED_LATE}) AS damaged_late
             FROM devices d
            WHERE d.entity_id = ?${s.sql} AND d.deleted_at IS NULL`,
          [entityId, ...s.args]
        );
        const total = int(row?.total);
        if (!total) return { value: 0, sub: 'Belum ada perangkat tercatat', alert: false };
        const late = int(row?.damaged_late);
        return {
          value: int(row?.problematic),
          sub: `${int(row?.damaged)} rusak, ${int(row?.retired)} tidak aktif dari ${total} perangkat${late ? ` · ${late} rusak > ${DAMAGED_DAYS} hari` : ''}`,
          alert: late > 0,
        };
      },
    },
    {
      // Old dashboard figure subsExpiring, unchanged: 'expiring' is the status
      // itReminders sets RENEWAL_NOTICE_DAYS before the renewal date.
      key: 'it_subs_expiring',
      label: 'Langganan akan berakhir',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 's.department_id');
        const [[row]] = await pool.query(
          `SELECT SUM(s.status = 'expiring') AS expiring,
                  SUM(${RENEWAL_UNDECIDED}) AS undecided
             FROM software_subscriptions s
            WHERE s.entity_id = ?${s.sql} AND s.deleted_at IS NULL`,
          [entityId, ...s.args]
        );
        const undecided = int(row?.undecided);
        return { value: int(row?.expiring), sub: `${undecided} belum diputuskan`, alert: undecided > 0 };
      },
    },
    ...infra.kpis,
  ],
};

Object.assign(module.exports, {
  SLA_DAYS, SERVICE_DAYS, RENEWAL_NOTICE_DAYS, DECISION_LEAD_DAYS, DAMAGED_DAYS, RESIGNED_HOLDER_DAYS, EPISODE_FACTOR,
});
