const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const { runModule } = require('../services/ai/provider');

/**
 * Generate brief harian dari agregat data.
 */
async function generate(req, res, next) {
  try {
    const entityId = Number(req.body.entityId || req.user.entityId);
    if (
      Number(req.user.entityId) !== entityId &&
      !(req.user.permissions || []).includes('entity.cross_access')
    ) {
      return fail(res, 'FORBIDDEN', 'Tidak punya akses lintas entity', 403);
    }
    const briefType = req.body.briefType || 'daily';
    const briefDate = req.body.briefDate || new Date().toISOString().slice(0, 10);
    if (!entityId) return fail(res, 'VALIDATION_ERROR', 'entityId wajib', 400);

    // Kumpulkan data ringkas
    const [[tasks]] = await pool.query(
      `SELECT
        SUM(status='done' AND DATE(completed_at)=?) AS doneToday,
        SUM(due_date=? AND status NOT IN ('done','closed','cancelled')) AS dueToday,
        SUM(due_date < CURDATE() AND status NOT IN ('done','closed','cancelled')) AS overdue
       FROM tasks WHERE entity_id=? AND deleted_at IS NULL`,
      [briefDate, briefDate, entityId]
    );
    const [[approvals]] = await pool.query(
      `SELECT SUM(status='pending') AS pending FROM approval_requests WHERE entity_id=?`,
      [entityId]
    );
    const [[finance]] = await pool.query(
      `SELECT SUM(status='pending_approval') AS pending,
              SUM(status='paid' AND DATE(paid_at)=?) AS paidToday,
              SUM(total_amount) AS totalPendingAmount
         FROM finance_workflows WHERE entity_id=? AND deleted_at IS NULL`,
      [briefDate, entityId]
    );
    const [[sales]] = await pool.query(
      `SELECT SUM(stage='won' AND DATE(closed_at)=?) AS wonToday,
              SUM(stage NOT IN ('won','lost') AND stage != 'on_hold') AS active
         FROM sales_pipeline WHERE entity_id=? AND deleted_at IS NULL`,
      [briefDate, entityId]
    );
    const [subs] = await pool.query(
      `SELECT product_name AS productName, renewal_date AS renewalDate,
              DATEDIFF(renewal_date, CURDATE()) AS daysLeft
         FROM software_subscriptions
        WHERE entity_id=? AND deleted_at IS NULL AND status IN ('active','expiring')
          AND renewal_date <= DATE_ADD(CURDATE(), INTERVAL 14 DAY)`, [entityId]
    );
    const [approvalList] = await pool.query(
      `SELECT id, title, created_at AS createdAt FROM approval_requests
        WHERE entity_id=? AND status='pending' ORDER BY id DESC LIMIT 10`, [entityId]
    );

    const dataBlock = `Tanggal: ${briefDate}
Entity ID: ${entityId}

TASK:
- Selesai hari ini: ${tasks.doneToday || 0}
- Due hari ini: ${tasks.dueToday || 0}
- Overdue: ${tasks.overdue || 0}

APPROVAL:
- Pending: ${approvals.pending || 0}

FINANCE:
- Pending approval: ${finance.pending || 0}
- Paid hari ini: ${finance.paidToday || 0}
- Total nominal pending: ${finance.totalPendingAmount || 0} IDR

SALES:
- Won hari ini: ${sales.wonToday || 0}
- Deal aktif: ${sales.active || 0}

SUBSCRIPTION renewal <= 14 hari:
${subs.map((s) => `- ${s.productName} (${s.renewalDate}, sisa ${s.daysLeft} hari)`).join('\n') || '(tidak ada)'}

Approval pending (top 10):
${approvalList.map((a) => `- #${a.id} ${a.title}`).join('\n') || '(tidak ada)'}
`;

    const prompt = `Data operasional:\n${dataBlock}\n\nBuat ringkasan ${briefType} untuk manajemen.`;

    const result = await runModule('daily_brief', prompt, {
      entityId,
      userId: req.user.sub,
      subjectType: 'entity',
      subjectId: entityId,
    });

    const [ins] = await pool.query(
      `INSERT INTO ai_summaries
       (entity_id, module, subject_type, subject_id, provider, model,
        content, tokens_in, tokens_out, created_by)
       VALUES (?, 'daily_brief', 'entity', ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, entityId, result.provider, result.model, result.content,
       result.tokensIn || null, result.tokensOut || null, req.user.sub]
    );

    const [br] = await pool.query(
      `INSERT INTO ai_briefs
       (entity_id, brief_type, brief_date, content, ai_summary_id, provider, model)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         content=VALUES(content), ai_summary_id=VALUES(ai_summary_id),
         provider=VALUES(provider), model=VALUES(model)`,
      [entityId, briefType, briefDate, result.content,
       ins.insertId, result.provider, result.model]
    );

    await log({
      entityId, userId: req.user.sub,
      action: 'brief.generate', subjectType: 'ai_brief',
      subjectId: br.insertId || 0, metadata: { briefType, briefDate },
    });

    return ok(res, {
      briefType, briefDate,
      provider: result.provider, model: result.model,
      content: result.content,
      aiSummaryId: ins.insertId,
    }, undefined, 201);
  } catch (e) { next(e); }
}

async function list(req, res, next) {
  try {
    const entityId = req.query.entityId ? Number(req.query.entityId) : Number(req.user.entityId);
    if (
      Number(req.user.entityId) !== entityId &&
      !(req.user.permissions || []).includes('entity.cross_access')
    ) {
      return fail(res, 'FORBIDDEN', 'Tidak punya akses lintas entity', 403);
    }
    const where = ['entity_id=?'];
    const args = [entityId];
    if (req.query.briefType) { where.push('brief_type=?'); args.push(req.query.briefType); }
    const [rows] = await pool.query(
      `SELECT id, brief_type AS briefType, brief_date AS briefDate,
              content, provider, model, created_at AS createdAt
         FROM ai_briefs WHERE ${where.join(' AND ')}
        ORDER BY id DESC LIMIT 60`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

module.exports = { generate, list };
