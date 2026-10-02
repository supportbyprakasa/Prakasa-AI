const pool = require('../../db/pool');
const { MAX_ITEMS_PER_SOURCE, int, round1, scope, escalationItem, byDepartment } = require('../helpers');

// HRGA — onboarding & offboarding (People & Culture).
//
// Division: a workflow belongs to hrga_workflows.department_id — the division
// the employee joins or leaves. It is the same attribution its approval request
// carries (submitForApproval copies it into approval_requests.department_id),
// so a workflow never shows under one division here and another in Approval.
// A Warehouse Head therefore sees their own new hire's stuck onboarding. A
// workflow without a department only appears in the entity-wide view (§6).
// Checklist tasks (hrga_workflow_tasks) have no entity or division of their own:
// they always inherit their workflow's.

// Only a running workflow can be late on its checklist. Draft and
// revision_requested sit with the requester, pending_approval is waiting in
// approval_requests and is already reported by the `approvals` provider — so it
// is deliberately not reported a second time here.
const ACTIVE = "('approved', 'in_progress')";
const OPEN_ITEM = "('pending', 'in_progress', 'blocked')";

// Access and asset items of an offboarding must be closed by the employee's last
// day: access left open after someone has gone is a security risk, and an asset
// not handed back by then rarely comes back. Their deadline is therefore the
// earlier of the checklist due date and the last working day.
// Wave 2 adds the app account, numbers, other access and the ID card.
const ACCESS_ASSET = "('account_deactivation', 'app_account_deactivation', 'device_return', 'software_license', 'phone_line_return', 'access_revoke', 'id_card_return')";
const LAST_DAY = 'COALESCE(h.last_working_date, h.effective_date)';

// When one checklist item (alias t) of workflow h is due. Every other item uses
// its own due date, which the checklist template sets.
const ITEM_DEADLINE = `CASE
    WHEN h.workflow_type = 'offboarding' AND t.category IN ${ACCESS_ASSET}
      THEN LEAST(COALESCE(t.due_date, ${LAST_DAY}), ${LAST_DAY})
    ELSE t.due_date
  END`;

// "This workflow has a checklist item past its deadline" — the one definition
// the escalation list, the dashboard sub-line and the on-time metric all share.
const HAS_LATE_ITEM = `EXISTS (
    SELECT 1 FROM hrga_workflow_tasks t
     WHERE t.hrga_workflow_id = h.id
       AND t.status IN ${OPEN_ITEM}
       AND ${ITEM_DEADLINE} < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR))`;

const TYPE_LABEL = { onboarding: 'Onboarding', offboarding: 'Offboarding' };

function lateContext(row) {
  const lateItems = int(row.late_items);
  const lateAccess = int(row.late_access_items);
  if (row.workflow_type === 'offboarding' && lateAccess > 0) {
    return `Hari terakhir ${row.last_day || '-'} sudah lewat — ${lateAccess} akses/aset belum dicabut atau dikembalikan`;
  }
  return `${TYPE_LABEL[row.workflow_type]}: ${lateItems} item checklist lewat tenggat`;
}

// One escalation per workflow (not per checklist item): management follows up
// on "the onboarding of X is late", and one follow-up note covers the workflow.
async function lateWorkflows(entityId, departmentId, workflowType) {
  const s = scope(departmentId, 'h.department_id');
  const [rows] = await pool.query(
    `SELECT h.id, h.workflow_number, h.workflow_type, h.employee_full_name,
            h.department_id, d.name AS department_name,
            COALESCE(pic.name, rq.name) AS owner_name,
            DATE_FORMAT(${LAST_DAY}, '%Y-%m-%d') AS last_day,
            COUNT(*) AS late_items,
            SUM(t.category IN ${ACCESS_ASSET}) AS late_access_items,
            MIN(${ITEM_DEADLINE}) AS since,
            DATEDIFF(DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR), MIN(${ITEM_DEADLINE})) AS days_late
       FROM hrga_workflows h
       JOIN hrga_workflow_tasks t ON t.hrga_workflow_id = h.id
       LEFT JOIN departments d ON d.id = h.department_id
       LEFT JOIN users pic ON pic.id = h.hrga_pic_user_id
       LEFT JOIN users rq ON rq.id = h.requested_by
      WHERE h.entity_id = ?${s.sql}
        AND h.deleted_at IS NULL
        AND h.workflow_type = '${workflowType === 'offboarding' ? 'offboarding' : 'onboarding'}'
        AND h.status IN ${ACTIVE}
        AND t.status IN ${OPEN_ITEM}
        AND ${ITEM_DEADLINE} < DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)
      GROUP BY h.id, h.workflow_number, h.workflow_type, h.employee_full_name, h.department_id,
               d.name, pic.name, rq.name, h.last_working_date, h.effective_date
      ORDER BY days_late DESC, h.id ASC
      LIMIT ${MAX_ITEMS_PER_SOURCE}`,
    [entityId, ...s.args]
  );
  return rows.map((row) => escalationItem({
    sourceId: row.id,
    title: row.employee_full_name,
    reference: row.workflow_number,
    context: lateContext(row),
    departmentId: row.department_id,
    departmentName: row.department_name,
    ownerName: row.owner_name,
    daysLate: row.days_late,
    since: row.since,
    link: `/hrga/workflows/${row.id}`,
  }));
}

// "Resign tanpa offboarding, akses masih terbuka" (wave 2, §2.1.7): a person
// marked resigned more than RESIGNED_ACCESS_DAYS ago, never offboarded, who
// still has an active app account, an assigned licence or an active company
// number. Devices are already it_device_resigned_holder. One episode per resign
// date, so a later resign of a re-hired person is a new item (D15).
const RESIGNED_ACCESS_DAYS = 3;
const EPISODE_FACTOR = 100000;
const WIB_TODAY = 'DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)';

// The company-number register arrives with row 2.3; until its table exists the
// query runs without the number count (one statement either way).
const PHONES_OPEN = `(SELECT COUNT(*) FROM it_phone_lines ln
   WHERE ln.entity_id = p.entity_id AND ln.person_id = p.id AND ln.status = 'active')`;

function resignedAccessSql(departmentId, phones) {
  const s = scope(departmentId, 'x.department_id');
  return {
    sql: `SELECT * FROM (
       SELECT p.id, COALESCE(u.name, p.full_name) AS name, p.resigned_on AS since,
              DATEDIFF(p.resigned_on, '2000-01-01') AS since_day,
              COALESCE(u.department_id, p.department_id) AS department_id, d.name AS department_name,
              (u.id IS NOT NULL AND u.status = 'active' AND u.deleted_at IS NULL) AS account_open,
              (SELECT COUNT(*) FROM subscription_licenses l JOIN software_subscriptions ss ON ss.id = l.subscription_id
                WHERE ss.entity_id = p.entity_id AND p.user_id IS NOT NULL AND l.assigned_to = p.user_id
                  AND l.status IN ('assigned', 'idle')) AS licenses_open,
              ${phones ? PHONES_OPEN : '0'} AS phones_open,
              DATEDIFF(${WIB_TODAY}, p.resigned_on) - ${RESIGNED_ACCESS_DAYS} AS days_late
         FROM people_directory p
         LEFT JOIN users u ON u.id = p.user_id
         LEFT JOIN departments d ON d.id = COALESCE(u.department_id, p.department_id)
        WHERE p.entity_id = ?
          AND p.status = 'resigned' AND p.kind <> 'excluded'
          AND p.resigned_on < ${WIB_TODAY} - INTERVAL ${RESIGNED_ACCESS_DAYS} DAY
          AND NOT EXISTS (SELECT 1 FROM hrga_workflows h
                           WHERE h.entity_id = p.entity_id AND h.person_id = p.id AND h.workflow_type = 'offboarding'
                             AND h.deleted_at IS NULL AND h.status NOT IN ('rejected', 'cancelled'))
     ) x
     WHERE (x.account_open OR x.licenses_open > 0 OR x.phones_open > 0)${s.sql}
     ORDER BY x.days_late DESC, x.id ASC
     LIMIT ${MAX_ITEMS_PER_SOURCE}`,
    args: s.args,
  };
}

async function resignedAccessOpen(entityId, departmentId) {
  let rows;
  try {
    const q = resignedAccessSql(departmentId, true);
    [rows] = await pool.query(q.sql, [entityId, ...q.args]);
  } catch (e) {
    if (e?.code !== 'ER_NO_SUCH_TABLE') throw e;
    const q = resignedAccessSql(departmentId, false);
    [rows] = await pool.query(q.sql, [entityId, ...q.args]);
  }
  return rows.map((row) => {
    const open = [];
    if (Number(row.account_open)) open.push('akun aplikasi aktif');
    if (int(row.licenses_open)) open.push(`${int(row.licenses_open)} lisensi`);
    if (int(row.phones_open)) open.push(`${int(row.phones_open)} nomor perusahaan`);
    return escalationItem({
      sourceId: Number(row.id) * EPISODE_FACTOR + Number(row.since_day),
      title: row.name,
      reference: null,
      context: `Resign tanpa offboarding — masih terbuka: ${open.join(', ')}`,
      departmentId: row.department_id,
      departmentName: row.department_name,
      ownerName: null,
      daysLate: row.days_late,
      since: row.since,
      link: `/people/directory/p${row.id}`,
    });
  });
}

async function locateResignedPerson(id) {
  const [[row]] = await pool.query(
    `SELECT p.entity_id, COALESCE(u.department_id, p.department_id) AS department_id
       FROM people_directory p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ? LIMIT 1`,
    [Math.floor(Number(id) / EPISODE_FACTOR)]
  );
  return row ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null } : null;
}

// "Siap di hari pertama": onboardings starting in the period, approved by
// their join date, whose IT and GA items were all done (or skipped) by then.
async function readyOnDayOne(entityId, period, departmentId) {
  const s = scope(departmentId, 'h.department_id');
  const [rows] = await pool.query(
    `SELECT h.department_id, COUNT(*) AS started,
            SUM(NOT EXISTS (
              SELECT 1 FROM hrga_workflow_tasks t
               WHERE t.hrga_workflow_id = h.id AND t.owner_group IN ('it', 'ga')
                 AND NOT (t.status = 'skipped'
                          OR (t.status = 'completed' AND DATE(t.completed_at + INTERVAL 7 HOUR) <= h.join_date))
            )) AS ready
       FROM hrga_workflows h
      WHERE h.entity_id = ?${s.sql}
        AND h.deleted_at IS NULL AND h.workflow_type = 'onboarding'
        AND h.status IN ('approved', 'in_progress', 'completed')
        AND h.join_date BETWEEN ? AND ?
        AND h.join_date <= ${WIB_TODAY}
        AND h.approved_at IS NOT NULL AND DATE(h.approved_at + INTERVAL 7 HOUR) <= h.join_date
      GROUP BY h.department_id`,
    [entityId, ...s.args, period.start, period.end]
  );
  return rows;
}

async function locateWorkflow(id) {
  const [[row]] = await pool.query(
    'SELECT entity_id, department_id FROM hrga_workflows WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [id]
  );
  return row ? { entityId: Number(row.entity_id), departmentId: row.department_id != null ? Number(row.department_id) : null } : null;
}

// Workflows of one type completed in the period, per division, with how many
// finished every checklist item by its deadline (the same deadline as above).
async function completedInPeriod(entityId, period, departmentId, workflowType) {
  const s = scope(departmentId, 'h.department_id');
  const [rows] = await pool.query(
    `SELECT h.department_id,
            COUNT(*) AS completed,
            SUM(NOT EXISTS (
              SELECT 1 FROM hrga_workflow_tasks t
               WHERE t.hrga_workflow_id = h.id
                 AND t.status <> 'skipped'
                 AND ${ITEM_DEADLINE} IS NOT NULL
                 AND (t.completed_at IS NULL OR DATE(t.completed_at + INTERVAL 7 HOUR) > ${ITEM_DEADLINE})
            )) AS on_time
       FROM hrga_workflows h
      WHERE h.entity_id = ?${s.sql}
        AND h.deleted_at IS NULL
        AND h.workflow_type = ?
        AND h.status = 'completed'
        AND h.completed_at BETWEEN ? - INTERVAL 7 HOUR AND ? - INTERVAL 7 HOUR
      GROUP BY h.department_id`,
    [entityId, ...s.args, workflowType, period.start, `${period.end} 23:59:59`]
  );
  return rows;
}

// The old dashboard figures (onboardingActive / offboardingActive), unchanged,
// plus how many of those are late — one query for both cards.
async function activeCounts(entityId, departmentId) {
  const s = scope(departmentId, 'h.department_id');
  const [[row]] = await pool.query(
    `SELECT SUM(h.workflow_type = 'onboarding' AND h.status IN ${ACTIVE}) AS onboarding_active,
            SUM(h.workflow_type = 'offboarding' AND h.status IN ${ACTIVE}) AS offboarding_active,
            SUM(h.workflow_type = 'onboarding' AND h.status IN ${ACTIVE} AND ${HAS_LATE_ITEM}) AS onboarding_late,
            SUM(h.workflow_type = 'offboarding' AND h.status IN ${ACTIVE} AND ${HAS_LATE_ITEM}) AS offboarding_late
       FROM hrga_workflows h
      WHERE h.entity_id = ?${s.sql} AND h.deleted_at IS NULL`,
    [entityId, ...s.args]
  );
  return row || {};
}

module.exports = {
  key: 'hrga',
  label: 'Onboarding & Offboarding',
  // Checklist templates are the configuration of this same module (they define
  // the items every onboarding/offboarding starts with), not a process with
  // deadlines of their own — so the route is claimed here rather than exempted.
  // The directory (wave 1, row 1.1) is People & Culture's own register: what
  // management needs from it is how many app accounts P&C has not reviewed yet.
  navPaths: ['/hrga/onboarding', '/hrga/offboarding', '/hrga/checklist-templates', '/people/directory'],

  escalations: [
    {
      key: 'hrga_onboarding_late',
      label: 'Onboarding lewat tenggat',
      list: (entityId, { departmentId }) => lateWorkflows(entityId, departmentId, 'onboarding'),
      locate: locateWorkflow,
    },
    {
      key: 'hrga_offboarding_late',
      label: 'Offboarding lewat tenggat',
      list: (entityId, { departmentId }) => lateWorkflows(entityId, departmentId, 'offboarding'),
      locate: locateWorkflow,
    },
    {
      key: 'hrga_resigned_access_open',
      label: 'Resign tanpa offboarding, akses masih terbuka',
      list: (entityId, { departmentId }) => resignedAccessOpen(entityId, departmentId),
      locate: locateResignedPerson,
    },
  ],

  metrics: [
    {
      key: 'hrga_ready_on_day_one',
      label: 'Siap di hari pertama',
      unit: '%',
      better: 'higher',
      cumulative: false,
      emptyIsZero: false,
      async actuals(entityId, period, { departmentId }) {
        return byDepartment(await readyOnDayOne(entityId, period, departmentId), (r) => {
          const started = int(r.started);
          return started ? round1((int(r.ready) / started) * 100) : null;
        });
      },
    },
    {
      key: 'hrga_onboarding_on_time',
      label: 'Onboarding selesai tepat waktu',
      unit: '%',
      better: 'higher',
      cumulative: false,
      async actuals(entityId, period, { departmentId }) {
        // A rate over nothing is not 0% — it is unknown.
        return byDepartment(await completedInPeriod(entityId, period, departmentId, 'onboarding'), (r) => {
          const completed = int(r.completed);
          return completed ? round1((int(r.on_time) / completed) * 100) : null;
        });
      },
    },
    {
      key: 'hrga_offboarding_completed',
      label: 'Offboarding selesai',
      unit: 'item',
      better: 'higher',
      cumulative: true,
      emptyIsZero: true,
      async actuals(entityId, period, { departmentId }) {
        return byDepartment(await completedInPeriod(entityId, period, departmentId, 'offboarding'), (r) => int(r.completed));
      },
    },
  ],

  kpis: [
    {
      // Active app accounts of the division without a directory row yet (rule 13).
      // Informational: an unreviewed account still counts as an employee, so no alarm.
      key: 'hrga_directory_unreviewed',
      label: 'Akun belum ditinjau People & Culture',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const s = scope(departmentId, 'u.department_id');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) AS active_accounts, SUM(p.id IS NULL) AS unreviewed
             FROM users u
             LEFT JOIN people_directory p ON p.entity_id = u.entity_id AND p.user_id = u.id
            WHERE u.entity_id = ?${s.sql}
              AND u.deleted_at IS NULL AND u.status = 'active'`,
          [entityId, ...s.args]
        );
        return { value: int(row?.unreviewed), sub: `dari ${int(row?.active_accounts)} akun aktif`, alert: false };
      },
    },
    {
      key: 'hrga_onboarding_active',
      label: 'Onboarding berjalan',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const row = await activeCounts(entityId, departmentId);
        const late = int(row.onboarding_late);
        return { value: int(row.onboarding_active), sub: `${late} lewat tenggat`, alert: late > 0 };
      },
    },
    {
      key: 'hrga_offboarding_active',
      label: 'Offboarding berjalan',
      unit: 'item',
      async value(entityId, { departmentId }) {
        const row = await activeCounts(entityId, departmentId);
        const late = int(row.offboarding_late);
        return { value: int(row.offboarding_active), sub: `${late} lewat tenggat`, alert: late > 0 };
      },
    },
  ],
};
