const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const runner = require('../services/automationRunner.service');

async function list(req, res, next) {
  try {
    const where = ['deleted_at IS NULL'];
    const args = [];
    if (req.query.entityId) { where.push('entity_id=?'); args.push(req.query.entityId); }
    const [rows] = await pool.query(
      `SELECT id, entity_id AS entityId, name, description, trigger_type AS triggerType,
              trigger_config AS triggerConfig, action_type AS actionType,
              action_config AS actionConfig, is_active AS isActive,
              last_run_at AS lastRunAt, last_run_status AS lastRunStatus,
              last_run_message AS lastRunMessage, run_count AS runCount,
              created_at AS createdAt
         FROM automation_rules WHERE ${where.join(' AND ')}
        ORDER BY id DESC`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const {
      entityId, name, description, triggerType = 'schedule',
      triggerConfig, conditionConfig, actionType, actionConfig,
      scheduleCron, isActive = true,
    } = req.body;

    const [r] = await pool.query(
      `INSERT INTO automation_rules
       (entity_id, name, description, trigger_type, trigger_config, condition_config,
        action_type, action_config, schedule_cron, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entityId, name, description || null, triggerType,
       JSON.stringify(triggerConfig || {}),
       conditionConfig ? JSON.stringify(conditionConfig) : null,
       actionType, JSON.stringify(actionConfig || {}),
       scheduleCron || null, isActive ? 1 : 0, req.user.sub]
    );

    await log({
      entityId, userId: req.user.sub,
      action: 'automation.create', subjectType: 'automation_rule', subjectId: r.insertId,
      metadata: { name, triggerType, actionType },
    });
    return ok(res, { id: r.insertId }, undefined, 201);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const {
      name, description, triggerConfig, conditionConfig,
      actionConfig, scheduleCron, isActive,
    } = req.body;

    const updates = [];
    const args = [];
    if (name !== undefined) { updates.push('name=?'); args.push(name); }
    if (description !== undefined) { updates.push('description=?'); args.push(description); }
    if (triggerConfig !== undefined) { updates.push('trigger_config=?'); args.push(JSON.stringify(triggerConfig)); }
    if (conditionConfig !== undefined) { updates.push('condition_config=?'); args.push(JSON.stringify(conditionConfig)); }
    if (actionConfig !== undefined) { updates.push('action_config=?'); args.push(JSON.stringify(actionConfig)); }
    if (scheduleCron !== undefined) { updates.push('schedule_cron=?'); args.push(scheduleCron); }
    if (isActive !== undefined) { updates.push('is_active=?'); args.push(isActive ? 1 : 0); }
    if (!updates.length) return fail(res, 'VALIDATION_ERROR', 'Tidak ada field yang diubah', 400);

    args.push(id);
    const [r] = await pool.query(
      `UPDATE automation_rules SET ${updates.join(', ')} WHERE id=? AND deleted_at IS NULL`, args
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Rule tidak ditemukan', 404);

    await log({
      entityId: null, userId: req.user.sub,
      action: 'automation.update', subjectType: 'automation_rule', subjectId: Number(id),
    });
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE automation_rules SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL`, [id]
    );
    if (!r.affectedRows) return fail(res, 'NOT_FOUND', 'Rule tidak ditemukan', 404);
    return ok(res, { id: Number(id) });
  } catch (e) { next(e); }
}

async function runRuleNow(req, res, next) {
  try {
    const { id } = req.params;
    const results = await runner.runOnce({ ruleId: Number(id) });
    return ok(res, results);
  } catch (e) { next(e); }
}

async function logs(req, res, next) {
  try {
    const where = ['1=1'];
    const args = [];
    if (req.query.ruleId) { where.push('automation_rule_id=?'); args.push(req.query.ruleId); }
    const [rows] = await pool.query(
      `SELECT id, automation_rule_id AS ruleId, entity_id AS entityId,
              subject_type AS subjectType, subject_id AS subjectId,
              status, message, created_at AS createdAt
         FROM automation_logs WHERE ${where.join(' AND ')}
        ORDER BY id DESC LIMIT 200`, args
    );
    return ok(res, rows);
  } catch (e) { next(e); }
}

async function scanners() {
  return Object.keys(require('../services/automationRunner.service').SCANNERS);
}

async function listScanners(req, res) {
  const keys = Object.keys(require('../services/automationRunner.service').SCANNERS);
  return ok(res, keys.map((k) => ({ code: k })));
}

async function listActions(req, res) {
  const keys = Object.keys(require('../services/automationRunner.service').ACTION_HANDLERS);
  return ok(res, keys.map((k) => ({ code: k })));
}

module.exports = { list, create, update, remove, runRuleNow, logs, listScanners, listActions };
