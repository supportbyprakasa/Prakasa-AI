const pool = require('../db/pool');
const { ok } = require('../utils/response');
const logger = require('../utils/logger');
const { gaCards } = require('../services/gaWorkSummary.service');

const has = (user, code) => (user.permissions || []).includes(code);
const PER_CARD_ITEMS = 3;

// Approval steps the caller can decide right now (direct approver, one of their
// roles, or an escalation target). Delegations are intentionally not included.
const MY_PENDING_STEP = `EXISTS (
  SELECT 1 FROM approval_requests ar
    JOIN approval_steps s ON s.approval_request_id = ar.id
   WHERE ar.id = %ID% AND ar.status = 'pending' AND s.status = 'pending' AND s.activated_at IS NOT NULL
     AND (s.approver_user_id = ? OR s.escalated_to_user_id = ?
          OR s.approver_role_id IN (SELECT role_id FROM user_roles WHERE user_id = ?))
)`;
const pendingStepFor = (column) => MY_PENDING_STEP.replace('%ID%', column);

function card(key, group, title, count, to, items) {
  return { key, group, title, count: Number(count) || 0, to, items: items || [] };
}

const fmtDate = (value) => (value ? new Date(value).toISOString() : null);

async function itTickets(user) {
  if (!has(user, 'it_ticket.view')) return [];
  const me = user.sub;
  const out = [];

  const [[waiting]] = await pool.query(
    "SELECT COUNT(*) AS c FROM it_tickets WHERE requester_id=? AND status='waiting_on_user'", [me]
  );
  if (waiting.c) {
    const [rows] = await pool.query(
      `SELECT id, title, priority, updated_at FROM it_tickets
        WHERE requester_id=? AND status='waiting_on_user' ORDER BY updated_at DESC LIMIT ${PER_CARD_ITEMS}`, [me]
    );
    out.push(card('it_waiting', 'action', 'Tiket IT menunggu balasan Anda', waiting.c, '/it/tickets',
      rows.map((r) => ({ id: r.id, title: r.title, meta: `Prioritas ${r.priority}`, to: `/it/tickets/${r.id}`, at: fmtDate(r.updated_at) }))));
  }

  const [[mine]] = await pool.query(
    "SELECT COUNT(*) AS c FROM it_tickets WHERE requester_id=? AND status IN ('open','in_progress')", [me]
  );
  if (mine.c) {
    const [rows] = await pool.query(
      `SELECT id, title, status, updated_at FROM it_tickets
        WHERE requester_id=? AND status IN ('open','in_progress') ORDER BY updated_at DESC LIMIT ${PER_CARD_ITEMS}`, [me]
    );
    out.push(card('it_mine', 'mine', 'Tiket IT saya yang masih berjalan', mine.c, '/it/tickets',
      rows.map((r) => ({ id: r.id, title: r.title, meta: r.status === 'open' ? 'Menunggu ditangani' : 'Sedang dikerjakan', to: `/it/tickets/${r.id}`, at: fmtDate(r.updated_at) }))));
  }

  if (has(user, 'it_ticket.manage')) {
    const [[queue]] = await pool.query(
      "SELECT COUNT(*) AS c FROM it_tickets WHERE entity_id=? AND status IN ('open','in_progress')", [user.entityId]
    );
    if (queue.c) {
      const [rows] = await pool.query(
        `SELECT id, title, priority, status, created_at FROM it_tickets
          WHERE entity_id=? AND status IN ('open','in_progress')
          ORDER BY FIELD(priority,'urgent','high','normal','low'), created_at ASC LIMIT ${PER_CARD_ITEMS}`, [user.entityId]
      );
      out.push(card('it_queue', 'team', 'Antrean tiket IT', queue.c, '/it/tickets',
        rows.map((r) => ({ id: r.id, title: r.title, meta: `${r.priority} · ${r.status === 'open' ? 'baru' : 'dikerjakan'}`, to: `/it/tickets/${r.id}`, at: fmtDate(r.created_at) }))));
    }
  }
  return out;
}

async function signatures(user) {
  if (!has(user, 'signature.view') || !has(user, 'signature.sign')) return [];
  const me = user.sub;
  const where = `s.entity_id=? AND s.status='pending'
    AND (s.assigned_signer_user_id=? OR s.assigned_signer_role_id IN (SELECT role_id FROM user_roles WHERE user_id=?))
    AND EXISTS (SELECT 1 FROM approval_requests a WHERE a.id=s.approval_request_id AND a.status='approved')`;
  const args = [user.entityId, me, me];
  const [[total]] = await pool.query(`SELECT COUNT(*) AS c FROM signature_requests s WHERE ${where}`, args);
  if (!total.c) return [];
  const [rows] = await pool.query(
    `SELECT s.id, s.created_at, COALESCE(d.title, CONCAT('Permintaan #', s.id)) AS title
       FROM signature_requests s LEFT JOIN documents d ON d.id = s.document_id
      WHERE ${where} ORDER BY s.created_at ASC LIMIT ${PER_CARD_ITEMS}`, args
  );
  return [card('signatures', 'action', 'Dokumen menunggu tanda tangan Anda', total.c, '/signatures',
    rows.map((r) => ({ id: r.id, title: r.title, meta: 'Siap ditandatangani', to: `/signatures/${r.id}`, at: fmtDate(r.created_at) })))];
}

const WAREHOUSE = [
  { type: 'inbound', table: 'warehouse_inbound', label: 'Barang masuk', date: 'inbound_date' },
  { type: 'outbound', table: 'warehouse_outbound', label: 'Barang keluar', date: 'outbound_date' },
];

async function warehouse(user) {
  if (!has(user, 'warehouse.movement.view')) return [];
  const out = [];
  const me = user.sub;

  if (has(user, 'warehouse.movement.approve') && has(user, 'approval.decide') && user.departmentId) {
    const parts = WAREHOUSE.map((w) => `SELECT '${w.type}' AS type, id, reference_no, ${w.date} AS at
      FROM ${w.table} WHERE entity_id=? AND department_id=? AND status='pending_approval' AND created_by<>? AND submitted_by<>?`);
    const args = WAREHOUSE.flatMap(() => [user.entityId, user.departmentId, me, me]);
    const [rows] = await pool.query(`SELECT * FROM (${parts.join(' UNION ALL ')}) m ORDER BY at ASC`, args);
    if (rows.length) {
      out.push(card('warehouse_approval', 'action', 'Gerakan gudang menunggu persetujuan Anda', rows.length, '/warehouse',
        rows.slice(0, PER_CARD_ITEMS).map((r) => ({
          id: `${r.type}-${r.id}`, title: r.reference_no || `${r.type === 'inbound' ? 'Barang masuk' : 'Barang keluar'} #${r.id}`,
          meta: r.type === 'inbound' ? 'Barang masuk' : 'Barang keluar', to: `/warehouse/movements/${r.type}/${r.id}`, at: fmtDate(r.at),
        }))));
    }
  }

  const parts = WAREHOUSE.map((w) => `SELECT '${w.type}' AS type, id, reference_no, status, ${w.date} AS at
    FROM ${w.table} WHERE entity_id=? AND created_by=? AND status IN ('draft','revision_requested')`);
  const args = WAREHOUSE.flatMap(() => [user.entityId, me]);
  const [mine] = await pool.query(`SELECT * FROM (${parts.join(' UNION ALL ')}) m ORDER BY at DESC`, args);
  if (mine.length) {
    out.push(card('warehouse_mine', 'action', 'Gerakan gudang Anda yang perlu dilengkapi', mine.length, '/warehouse',
      mine.slice(0, PER_CARD_ITEMS).map((r) => ({
        id: `${r.type}-${r.id}`, title: r.reference_no || `${r.type === 'inbound' ? 'Barang masuk' : 'Barang keluar'} #${r.id}`,
        meta: r.status === 'draft' ? 'Draf' : 'Perlu revisi', to: `/warehouse/movements/${r.type}/${r.id}`, at: fmtDate(r.at),
      }))));
  }
  return out;
}

async function finance(user) {
  if (!has(user, 'finance.view')) return [];
  const me = user.sub;
  const out = [];

  if (has(user, 'finance.approve')) {
    const where = `f.entity_id=? AND f.deleted_at IS NULL AND f.status='pending_approval' AND ${pendingStepFor('f.approval_request_id')}`;
    const args = [user.entityId, me, me, me];
    const [[total]] = await pool.query(`SELECT COUNT(*) AS c FROM finance_workflows f WHERE ${where}`, args);
    if (total.c) {
      const [rows] = await pool.query(
        `SELECT f.id, f.title, f.request_number, f.total_amount, f.currency, f.created_at FROM finance_workflows f
          WHERE ${where} ORDER BY f.created_at ASC LIMIT ${PER_CARD_ITEMS}`, args
      );
      out.push(card('finance_approval', 'action', 'Pembayaran menunggu persetujuan Anda', total.c, '/finance/payment-requests',
        rows.map((r) => ({ id: r.id, title: r.title || r.request_number, meta: `${r.currency || 'IDR'} ${Number(r.total_amount || 0).toLocaleString('id-ID')}`, to: `/finance/payment-requests/${r.id}`, at: fmtDate(r.created_at) }))));
    }
  }

  const [[revise]] = await pool.query(
    "SELECT COUNT(*) AS c FROM finance_workflows WHERE requested_by=? AND deleted_at IS NULL AND status IN ('draft','revision_requested')", [me]
  );
  if (revise.c) {
    const [rows] = await pool.query(
      `SELECT id, title, request_number, status, updated_at FROM finance_workflows
        WHERE requested_by=? AND deleted_at IS NULL AND status IN ('draft','revision_requested')
        ORDER BY updated_at DESC LIMIT ${PER_CARD_ITEMS}`, [me]
    );
    out.push(card('finance_revise', 'action', 'Pengajuan pembayaran Anda yang perlu dilengkapi', revise.c, '/finance/payment-requests',
      rows.map((r) => ({ id: r.id, title: r.title || r.request_number, meta: r.status === 'draft' ? 'Draf' : 'Perlu revisi', to: `/finance/payment-requests/${r.id}`, at: fmtDate(r.updated_at) }))));
  }

  const [[open]] = await pool.query(
    "SELECT COUNT(*) AS c FROM finance_workflows WHERE requested_by=? AND deleted_at IS NULL AND status IN ('pending_document_check','pending_approval','approved','processing')", [me]
  );
  if (open.c) {
    const [rows] = await pool.query(
      `SELECT id, title, request_number, status, updated_at FROM finance_workflows
        WHERE requested_by=? AND deleted_at IS NULL AND status IN ('pending_document_check','pending_approval','approved','processing')
        ORDER BY updated_at DESC LIMIT ${PER_CARD_ITEMS}`, [me]
    );
    const label = { pending_document_check: 'Pemeriksaan dokumen', pending_approval: 'Menunggu persetujuan', approved: 'Disetujui', processing: 'Sedang diproses' };
    out.push(card('finance_mine', 'mine', 'Pengajuan pembayaran saya yang masih berjalan', open.c, '/finance/payment-requests',
      rows.map((r) => ({ id: r.id, title: r.title || r.request_number, meta: label[r.status] || r.status, to: `/finance/payment-requests/${r.id}`, at: fmtDate(r.updated_at) }))));
  }

  if (has(user, 'finance.process')) {
    const [[queue]] = await pool.query(
      "SELECT COUNT(*) AS c FROM finance_workflows WHERE entity_id=? AND deleted_at IS NULL AND status IN ('approved','processing')", [user.entityId]
    );
    if (queue.c) {
      const [rows] = await pool.query(
        `SELECT id, title, request_number, status, created_at FROM finance_workflows
          WHERE entity_id=? AND deleted_at IS NULL AND status IN ('approved','processing') ORDER BY created_at ASC LIMIT ${PER_CARD_ITEMS}`, [user.entityId]
      );
      out.push(card('finance_queue', 'team', 'Antrean pembayaran untuk diproses', queue.c, '/finance/payment-requests',
        rows.map((r) => ({ id: r.id, title: r.title || r.request_number, meta: r.status === 'approved' ? 'Siap dibayar' : 'Sedang diproses', to: `/finance/payment-requests/${r.id}`, at: fmtDate(r.created_at) }))));
    }
  }
  return out;
}

// Onboarding/offboarding: a manager in another division has no hrga.view but
// still sees the checklist tasks assigned to them (wave 2, P6); the approval
// card follows the decision rules (separation of duties), not hrga.approve.
async function hrga(user) {
  const me = user.sub;
  const out = [];
  const page = (type) => (type === 'offboarding' ? 'Offboarding' : 'Onboarding');

  const taskWhere = `t.responsible_user_id=? AND t.status IN ('pending','in_progress','blocked')
    AND h.entity_id=? AND h.deleted_at IS NULL AND h.status IN ('approved','in_progress')`;
  const [[tasks]] = await pool.query(
    `SELECT COUNT(*) AS c FROM hrga_workflow_tasks t JOIN hrga_workflows h ON h.id=t.hrga_workflow_id WHERE ${taskWhere}`, [me, user.entityId]
  );
  if (tasks.c) {
    const [rows] = await pool.query(
      `SELECT t.id, t.title, t.due_date, h.id AS workflow_id, h.workflow_type, h.employee_full_name
         FROM hrga_workflow_tasks t JOIN hrga_workflows h ON h.id=t.hrga_workflow_id
        WHERE ${taskWhere} ORDER BY t.due_date IS NULL, t.due_date ASC LIMIT ${PER_CARD_ITEMS}`, [me, user.entityId]
    );
    out.push(card('hrga_tasks', 'action', 'Tugas onboarding/offboarding untuk Anda', tasks.c,
      has(user, 'hrga.view') ? '/hrga/onboarding' : `/hrga/workflows/${rows[0]?.workflow_id || ''}`,
      rows.map((r) => ({ id: r.id, title: r.title, meta: `${page(r.workflow_type)} · ${r.employee_full_name}`, to: `/hrga/workflows/${r.workflow_id}`, at: fmtDate(r.due_date) }))));
  }

  if (has(user, 'approval.decide')) {
    const where = `h.entity_id=? AND h.deleted_at IS NULL AND h.status='pending_approval' AND ${pendingStepFor('h.approval_request_id')}`;
    const args = [user.entityId, me, me, me];
    const [candidates] = await pool.query(
      `SELECT h.id, h.workflow_type, h.employee_full_name, h.created_at, h.approval_request_id
         FROM hrga_workflows h WHERE ${where} ORDER BY h.created_at ASC LIMIT 50`, args
    );
    const lifecycle = require('../services/approvalSubjectLifecycle.service');
    const rows = [];
    for (const r of candidates) {
      const [[approval]] = await pool.query('SELECT * FROM approval_requests WHERE id=? AND entity_id=? LIMIT 1', [r.approval_request_id, user.entityId]);
      if (approval && await lifecycle.canUserDecide({ approval, user, conn: pool })) rows.push(r);
    }
    if (rows.length) {
      out.push(card('hrga_approval', 'action', 'Onboarding/offboarding menunggu persetujuan Anda', rows.length, `/hrga/workflows/${rows[0].id}`,
        rows.slice(0, PER_CARD_ITEMS).map((r) => ({ id: r.id, title: r.employee_full_name, meta: page(r.workflow_type), to: `/hrga/workflows/${r.id}`, at: fmtDate(r.created_at) }))));
    }
  }
  return out;
}

async function notifications(user) {
  const [[unread]] = await pool.query(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND is_read=0 AND deleted_at IS NULL', [user.sub]
  );
  const [rows] = await pool.query(
    `SELECT id, title, action_url, is_read, created_at FROM notifications
      WHERE user_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 5`, [user.sub]
  );
  return {
    unread: unread.c,
    recent: rows.map((r) => ({
      id: r.id, title: r.title, isRead: Boolean(r.is_read), at: fmtDate(r.created_at),
      to: r.action_url && r.action_url.startsWith('/') && !r.action_url.startsWith('//') ? r.action_url : '/notifications',
    })),
  };
}

// One request answers "what needs my attention?" for the home page. Every source
// is permission-gated the same way its own page is, and a failing source is
// dropped (logged) instead of blanking the whole summary.
// build(user) is the page's data without the HTTP answer: Prakasa AI's home
// tool reads the same cards through it (services/ai/agent/tools/home.js).
async function build(user) {
  const sources = [itTickets, signatures, warehouse, finance, hrga, gaCards];
  const settled = await Promise.allSettled(sources.map((source) => source(user)));
  const cards = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') cards.push(...result.value);
    else logger.error({ err: result.reason?.message, source: sources[index].name }, 'work summary source failed');
  });

  let notif = { unread: 0, recent: [] };
  try { notif = await notifications(user); } catch (error) {
    logger.error({ err: error.message }, 'work summary notifications failed');
  }

  return {
    generatedAt: new Date().toISOString(),
    notifications: notif,
    cards: cards.filter((item) => item.count > 0),
  };
}

async function summary(req, res, next) {
  try {
    return ok(res, await build(req.user));
  } catch (error) { next(error); }
}

// GET /work-summary/briefing — "Ringkasan pagi": the same person's day in one
// prioritised list (services/morningBriefing.service.js). Read-only, no model,
// cached per user; never a notification or an email.
async function briefing(req, res, next) {
  try {
    const meta = {};
    const data = await require('../services/morningBriefing.service').build(req.user, meta);
    if (meta.outcome) res.setHeader('X-Cache', meta.outcome);
    return ok(res, data);
  } catch (error) { next(error); }
}

module.exports = { summary, build, briefing };
