const pool = require('../db/pool');
const notif = require('./notification.service');

/**
 * Automation Runner.
 * Dijalankan via cPanel Cron Job (mis. tiap 15 menit).
 * Semua aksi WAJIB kecil dan idempoten supaya aman diulang.
 */
async function runOnce({ ruleId = null } = {}) {
  const where = ['is_active=1', 'deleted_at IS NULL'];
  const args = [];
  if (ruleId) { where.push('id = ?'); args.push(ruleId); }

  const [rules] = await pool.query(
    `SELECT * FROM automation_rules WHERE ${where.join(' AND ')}`, args
  );

  const results = [];
  for (const rule of rules) {
    try {
      const r = await runRule(rule);
      results.push({ ruleId: rule.id, ...r });
    } catch (e) {
      await recordRun(rule.id, 'failed', e.message);
      results.push({ ruleId: rule.id, status: 'failed', message: e.message });
    }
  }
  return results;
}

async function recordRun(ruleId, status, message) {
  await pool.query(
    `UPDATE automation_rules
        SET last_run_at=NOW(), last_run_status=?, last_run_message=?,
            run_count = run_count + 1
      WHERE id=?`, [status, message || null, ruleId]
  );
}

async function log(rule, { status, message, subjectType, subjectId }) {
  await pool.query(
    `INSERT INTO automation_logs
     (automation_rule_id, entity_id, subject_type, subject_id, status, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [rule.id, rule.entity_id, subjectType || null, subjectId || null, status, message || null]
  );
}

async function runRule(rule) {
  const trigger = typeof rule.trigger_config === 'string'
    ? JSON.parse(rule.trigger_config) : rule.trigger_config;
  const action = typeof rule.action_config === 'string'
    ? JSON.parse(rule.action_config) : rule.action_config;

  const scanner = SCANNERS[trigger.scan];
  if (!scanner) {
    await recordRun(rule.id, 'skipped', `Scanner ${trigger.scan} tidak dikenal`);
    return { status: 'skipped', message: 'unknown scanner' };
  }

  const subjects = await scanner({ rule, trigger });
  let acted = 0;

  for (const s of subjects) {
    try {
      await ACTION_HANDLERS[rule.action_type]({ rule, action, subject: s });
      await log(rule, { status: 'success', subjectType: s.type, subjectId: s.id,
                        message: `Action ${rule.action_type} executed` });
      acted++;
    } catch (e) {
      await log(rule, { status: 'failed', subjectType: s.type, subjectId: s.id,
                        message: e.message });
    }
  }

  await recordRun(rule.id, 'success', `${acted} subject(s) acted on`);
  return { status: 'success', acted, subjects: subjects.length };
}

// ============================================================
// SCANNERS — cari subject yang memenuhi trigger
// ============================================================

const SCANNERS = {
  // Task overdue > N hari
  async tasks_overdue_by_days({ rule, trigger }) {
    const days = trigger.days || 3;
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, title, assignee_id AS assigneeId,
              due_date AS dueDate, DATEDIFF(CURDATE(), due_date) AS daysOverdue
         FROM tasks
        WHERE entity_id=? AND deleted_at IS NULL
          AND due_date IS NOT NULL
          AND due_date < DATE_SUB(CURDATE(), INTERVAL ? DAY)
          AND status NOT IN ('done','closed','cancelled')
        LIMIT 200`,
      [rule.entity_id, days]
    );
    return rows.map((r) => ({ type: 'task', ...r }));
  },

  // Approval pending > N hari
  async approvals_pending_days({ rule, trigger }) {
    const days = trigger.days || 3;
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, title, requested_by AS requestedBy,
              created_at AS createdAt, DATEDIFF(CURDATE(), DATE(created_at)) AS daysPending
         FROM approval_requests
        WHERE entity_id=? AND status='pending'
          AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        LIMIT 200`,
      [rule.entity_id, days]
    );
    return rows.map((r) => ({ type: 'approval_request', ...r }));
  },

  // Subscription renewal due
  async subscriptions_expiring({ rule, trigger }) {
    const days = trigger.days || 14;
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, product_name AS productName,
              renewal_date AS renewalDate, pic_user_id AS picUserId,
              DATEDIFF(renewal_date, CURDATE()) AS daysLeft
         FROM software_subscriptions
        WHERE entity_id=? AND deleted_at IS NULL
          AND status IN ('active','expiring')
          AND renewal_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
        LIMIT 200`,
      [rule.entity_id, days]
    );
    return rows.map((r) => ({ type: 'software_subscription', ...r }));
  },

  // Warranty device expiring
  async devices_warranty_expiring({ rule, trigger }) {
    const days = trigger.days || 30;
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, asset_code AS assetCode,
              warranty_end AS warrantyEnd, current_assignee_id AS assigneeId,
              DATEDIFF(warranty_end, CURDATE()) AS daysLeft
         FROM devices
        WHERE entity_id=? AND deleted_at IS NULL
          AND warranty_end IS NOT NULL
          AND warranty_end BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
        LIMIT 200`,
      [rule.entity_id, days]
    );
    return rows.map((r) => ({ type: 'device', ...r }));
  },

  // Onboarding effective_date hari ini → aktifkan
  async onboarding_starting_today({ rule }) {
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, employee_full_name AS employeeFullName,
              employee_user_id AS employeeUserId, workflow_number AS workflowNumber
         FROM hrga_workflows
        WHERE entity_id=? AND workflow_type='onboarding'
          AND status IN ('approved','in_progress')
          AND effective_date = CURDATE()
        LIMIT 200`,
      [rule.entity_id]
    );
    return rows.map((r) => ({ type: 'hrga_workflow', ...r }));
  },

  // Offboarding effective_date hari ini → mulai proses
  async offboarding_starting_today({ rule }) {
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, employee_full_name AS employeeFullName,
              employee_user_id AS employeeUserId, workflow_number AS workflowNumber
         FROM hrga_workflows
        WHERE entity_id=? AND workflow_type='offboarding'
          AND status IN ('approved','in_progress')
          AND effective_date = CURDATE()
        LIMIT 200`,
      [rule.entity_id]
    );
    return rows.map((r) => ({ type: 'hrga_workflow', ...r }));
  },

  // Sample request yang sudah 'ready' > N hari belum delivered
  async sample_ready_not_delivered({ rule, trigger }) {
    const days = trigger.days || 2;
    const [rows] = await pool.query(
      `SELECT w.id, w.entity_id AS entityId, s.product_name AS productName,
              s.customer_id AS customerId, s.requested_by AS requestedBy,
              w.ready_at AS readyAt, DATEDIFF(CURDATE(), DATE(w.ready_at)) AS daysReady
         FROM warehouse_sample_tasks w
         JOIN sales_sample_requests s ON s.id = w.sample_request_id
        WHERE w.entity_id=? AND w.status='ready'
          AND w.ready_at < DATE_SUB(NOW(), INTERVAL ? DAY)
        LIMIT 200`,
      [rule.entity_id, days]
    );
    return rows.map((r) => ({ type: 'warehouse_sample_task', ...r }));
  },

  // Invoice subscription pending upload > N hari
  async invoices_pending_upload({ rule, trigger }) {
    const days = trigger.days || 7;
    const [rows] = await pool.query(
      `SELECT i.id, i.subscription_id AS subscriptionId, s.entity_id AS entityId,
              s.product_name AS productName, s.pic_user_id AS picUserId,
              i.status, i.invoice_date AS invoiceDate,
              DATEDIFF(CURDATE(), i.invoice_date) AS daysOld
         FROM subscription_invoices i
         JOIN software_subscriptions s ON s.id = i.subscription_id
        WHERE s.entity_id=? AND i.status IN ('pending_upload','uploaded')
          AND i.invoice_date < DATE_SUB(CURDATE(), INTERVAL ? DAY)
        LIMIT 200`,
      [rule.entity_id, days]
    );
    return rows.map((r) => ({ type: 'subscription_invoice', ...r }));
  },
};

// ============================================================
// ACTION HANDLERS
// ============================================================

const ACTION_HANDLERS = {
  async create_notification({ rule, action, subject }) {
    const userId = subject.assigneeId || subject.picUserId
      || subject.requestedBy || subject.employeeUserId;
    if (!userId) throw new Error('Tidak ada user penerima notifikasi');
    await notif.create({
      userId, entityId: subject.entityId || rule.entity_id,
      title: action.title || rule.name,
      body: action.body || `${subject.type} #${subject.id}`,
      event: `automation.${rule.id}`,
      subjectType: subject.type, subjectId: subject.id,
      actionUrl: action.actionUrl || null,
    });
  },

  async create_task({ rule, action, subject }) {
    const [t] = await pool.query(
      `INSERT INTO tasks
       (entity_id, department_id, title, description, priority,
        assignee_id, reporter_id, due_date, source_type, source_id)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'automation', ?)`,
      [subject.entityId || rule.entity_id,
       (action.taskTitle || rule.name) + ` (#${subject.id})`,
       action.taskDescription || null,
       action.priority || 'normal',
       action.assigneeUserId || subject.assigneeId || null,
       rule.created_by,
       action.dueInDays ? new Date(Date.now() + action.dueInDays * 86400000)
                          .toISOString().slice(0, 10) : null,
       rule.id]
    );
    return t.insertId;
  },

  async update_status({ rule, action, subject }) {
    const tableMap = {
      task: ['tasks', 'status'],
      approval_request: ['approval_requests', 'status'],
      software_subscription: ['software_subscriptions', 'status'],
      device: ['devices', 'status'],
      hrga_workflow: ['hrga_workflows', 'status'],
      warehouse_sample_task: ['warehouse_sample_tasks', 'status'],
      subscription_invoice: ['subscription_invoices', 'status'],
      finance_workflow: ['finance_workflows', 'status'],
    };
    const map = tableMap[subject.type];
    if (!map) throw new Error(`update_status tidak didukung untuk ${subject.type}`);
    await pool.query(
      `UPDATE ${map[0]} SET ${map[1]}=? WHERE id=?`, [action.newStatus, subject.id]
    );
  },

  async link_records({ rule, action, subject }) {
    await pool.query(
      `INSERT IGNORE INTO cross_division_links
       (entity_id, from_type, from_id, to_type, to_id, relation, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [subject.entityId || rule.entity_id,
       subject.type, subject.id,
       action.toType, action.toId,
       action.relation || 'related', rule.created_by]
    );
  },

  async escalate({ rule, action, subject }) {
    // Kirim notifikasi ke role tertentu (mis. manager)
    if (!action.roleId) throw new Error('action.roleId wajib');
    const [users] = await pool.query(
      `SELECT DISTINCT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
        WHERE ur.role_id = ? AND u.deleted_at IS NULL AND u.status='active'`,
      [action.roleId]
    );
    for (const u of users) {
      await notif.create({
        userId: u.id, entityId: subject.entityId || rule.entity_id,
        title: action.title || `[Eskalasi] ${rule.name}`,
        body: action.body || `Perlu tindakan pada ${subject.type} #${subject.id}`,
        event: `automation.escalate.${rule.id}`,
        subjectType: subject.type, subjectId: subject.id,
      });
    }
  },

  async send_google_chat({ rule, action }) {
    if (!process.env.GOOGLE_CHAT_WEBHOOK_URL) throw new Error('Webhook tidak dikonfigurasi');
    await fetch(process.env.GOOGLE_CHAT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: action.text || rule.name }),
    });
  },

  async create_approval({ rule, action, subject }) {
    const [ap] = await pool.query(
      `INSERT INTO approval_requests
       (entity_id, subject_type, subject_id, title, description,
        approval_type, current_level, status, requested_by)
       VALUES (?, ?, ?, ?, ?, 'level_1', 1, 'pending', ?)`,
      [subject.entityId || rule.entity_id,
       subject.type, subject.id,
       action.title || `[Auto] ${rule.name}`,
       action.description || null, rule.created_by]
    );
    await pool.query(
      `INSERT INTO approval_steps (approval_request_id, level) VALUES (?, 1)`,
      [ap.insertId]
    );
  },
};

module.exports = { runOnce, runRule, SCANNERS, ACTION_HANDLERS };
