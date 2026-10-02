const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const { log } = require('../services/activityLog.service');
const { getAllProviderConfigs, saveProviderConfig } = require('../services/ai/providerSettings');
const accounts = require('../services/ai/claudeTeamAccounts.service');
const routing = require('../services/ai/aiRouting.service');
const { cliStatus } = require('../services/ai/claudeTeamPersonal');
const { listSeatHealth } = require('../services/ai/claudeTeamSeats.service');

function handleServiceError(error, res, next) {
  if (error.status) return fail(res, error.code || 'VALIDATION_ERROR', error.message, error.status);
  return next(error);
}

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

async function getOverview(req, res, next) {
  try {
    const [providers, claudeTeamAccounts, cli, departments, routingSettings, divisionAssignments] = await Promise.all([
      getAllProviderConfigs(),
      accounts.listAccounts(),
      cliStatus(),
      listDepartments(),
      routing.getRoutingSettings(),
      routing.listDivisionAssignments(),
    ]);
    // Every seat's login, usage window and queue, for the "Kuota Claude Team" card.
    const claudeTeamSeats = await listSeatHealth().catch(() => []);
    return ok(res, {
      providers, claudeTeamAccounts, cli, departments, routing: routingSettings, divisionAssignments, claudeTeamSeats,
    });
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function updateProvider(req, res, next) {
  try {
    const settings = await saveProviderConfig(req.params.provider, req.body, req.user.sub);
    await log({
      entityId: req.user.entityId || null,
      userId: req.user.sub,
      action: 'ai_provider.settings.update',
      subjectType: 'ai_provider',
      metadata: { provider: req.params.provider, enabled: settings.enabled, model: settings.model },
    });
    return ok(res, { settings });
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function listAccounts(req, res, next) {
  try {
    return ok(res, await accounts.listAccounts());
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function createAccount(req, res, next) {
  try {
    const account = await accounts.createAccount(req.body, req.user.sub);
    await log({
      entityId: req.user.entityId || null,
      userId: req.user.sub,
      action: 'ai_claude_team_account.create',
      subjectType: 'ai_claude_team_account',
      subjectId: account.id,
      metadata: { label: account.label, mode: account.mode },
    });
    return ok(res, account, undefined, 201);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function updateAccount(req, res, next) {
  try {
    const account = await accounts.updateAccount(Number(req.params.id), req.body, req.user.sub);
    await log({
      entityId: req.user.entityId || null,
      userId: req.user.sub,
      action: 'ai_claude_team_account.update',
      subjectType: 'ai_claude_team_account',
      subjectId: account.id,
      metadata: { label: account.label, mode: account.mode, enabled: account.enabled },
    });
    return ok(res, account);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function deleteAccount(req, res, next) {
  try {
    await accounts.deleteAccount(Number(req.params.id));
    await log({
      entityId: req.user.entityId || null,
      userId: req.user.sub,
      action: 'ai_claude_team_account.delete',
      subjectType: 'ai_claude_team_account',
      subjectId: Number(req.params.id),
    });
    return ok(res, { id: Number(req.params.id) });
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function updateRouting(req, res, next) {
  try {
    const settings = await routing.saveRoutingSettings(req.body, req.user.sub);
    await log({
      entityId: req.user.entityId || null,
      userId: req.user.sub,
      action: 'ai_routing.default.update',
      subjectType: 'ai_routing',
      metadata: settings,
    });
    return ok(res, settings);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function setDivisionAssignment(req, res, next) {
  try {
    const departmentId = Number(req.params.departmentId);
    const assignment = await routing.setDivisionAssignment(departmentId, req.body, req.user.sub);
    await log({
      entityId: req.user.entityId || null,
      userId: req.user.sub,
      action: 'ai_routing.division.update',
      subjectType: 'department',
      subjectId: departmentId,
      metadata: assignment,
    });
    return ok(res, assignment);
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

async function clearDivisionAssignment(req, res, next) {
  try {
    const departmentId = Number(req.params.departmentId);
    await routing.clearDivisionAssignment(departmentId);
    await log({
      entityId: req.user.entityId || null,
      userId: req.user.sub,
      action: 'ai_routing.division.clear',
      subjectType: 'department',
      subjectId: departmentId,
    });
    return ok(res, { departmentId });
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}

module.exports = {
  getOverview,
  updateProvider,
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  updateRouting,
  setDivisionAssignment,
  clearDivisionAssignment,
};
