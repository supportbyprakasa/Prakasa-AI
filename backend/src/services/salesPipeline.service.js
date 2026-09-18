const pool = require('../db/pool');

const STAGES = [
  'new_inquiry', 'contacted', 'need_follow_up', 'sample_requested',
  'quotation_sent', 'negotiation', 'won', 'lost', 'on_hold',
];

const CLOSED_STAGES = new Set(['won', 'lost']);

async function changeStage({ pipelineId, toStage, userId, note }) {
  if (!STAGES.includes(toStage)) throw new Error(`Stage tidak valid: ${toStage}`);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM sales_pipeline WHERE id=? FOR UPDATE`, [pipelineId]
    );
    const p = rows[0];
    if (!p) throw new Error('Pipeline tidak ditemukan');
    if (p.stage === toStage) { await conn.rollback(); return { unchanged: true }; }

    await conn.query(
      `UPDATE sales_pipeline
          SET stage=?, stage_changed_at=NOW(),
              closed_at = CASE WHEN ? IN ('won','lost') THEN NOW() ELSE NULL END
        WHERE id=?`,
      [toStage, toStage, pipelineId]
    );
    await conn.query(
      `INSERT INTO sales_pipeline_history (pipeline_id, from_stage, to_stage, changed_by, note)
       VALUES (?, ?, ?, ?, ?)`,
      [pipelineId, p.stage, toStage, userId || null, note || null]
    );
    await conn.commit();
    return { from: p.stage, to: toStage, closed: CLOSED_STAGES.has(toStage) };
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}

module.exports = { STAGES, CLOSED_STAGES, changeStage };
