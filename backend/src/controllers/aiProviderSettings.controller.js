const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const {
  getClaudeTeamSettings,
  saveClaudeTeamSettings,
} = require('../services/ai/providerSettings');
const { cliStatus } = require('../services/ai/claudeTeamPersonal');

async function listDepartments() {
  const [rows] = await pool.query(
    `SELECT d.id, d.name, d.entity_id AS entityId, e.name AS entityName,
            (SELECT COUNT(*) FROM users u
              WHERE u.department_id = d.id AND u.status='active' AND u.deleted_at IS NULL) AS memberCount
       FROM departments d
       JOIN entities e ON e.id = d.entity_id
      WHERE d.deleted_at IS NULL
      ORDER BY e.name ASC, d.name ASC`
  );
  return rows.map((row) => ({ ...row, memberCount: Number(row.memberCount) }));
}

async function getClaudeTeam(req, res, next) {
  try {
    const [settings, cli, departments] = await Promise.all([
      getClaudeTeamSettings(),
      cliStatus(),
      listDepartments(),
    ]);
    return ok(res, { settings, cli, departments });
  } catch (error) {
    return next(error);
  }
}

async function updateClaudeTeam(req, res, next) {
  try {
    const settings = await saveClaudeTeamSettings(req.body, req.user.sub);

    await log({
      entityId: req.user.entityId || null,
      userId: req.user.sub,
      action: 'ai_provider.settings.update',
      subjectType: 'ai_provider',
      metadata: {
        provider: 'claude_team',
        enabled: settings.enabled,
        model: settings.model,
        allowedDepartmentIds: settings.allowedDepartmentIds,
        allowedEmailCount: settings.allowedEmails.length,
      },
    });

    return ok(res, { settings });
  } catch (error) {
    if (error.status === 400) {
      return fail(res, error.code || 'VALIDATION_ERROR', error.message, 400);
    }
    return next(error);
  }
}

module.exports = { getClaudeTeam, updateClaudeTeam };
