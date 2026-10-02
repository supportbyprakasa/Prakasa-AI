const pool = require('../../db/pool');

function validationError(message, code = 'VALIDATION_ERROR') {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

const VALID_PROVIDERS = new Set(['openai', 'gemini', 'claude', 'claude_team', 'n8n']);

async function loadUserIdentity(userId) {
  if (!userId) return null;
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.entity_id AS entityId, d.id AS departmentId
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id AND d.deleted_at IS NULL
      WHERE u.id=? AND u.status='active' AND u.deleted_at IS NULL
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function getRoutingSettings() {
  const [rows] = await pool.query(
    'SELECT default_provider AS defaultProvider, default_claude_team_account_id AS defaultClaudeTeamAccountId FROM ai_routing_settings WHERE id=1'
  );
  return rows[0] || { defaultProvider: 'claude_team', defaultClaudeTeamAccountId: null };
}

async function saveRoutingSettings({ defaultProvider, defaultClaudeTeamAccountId }, userId) {
  if (!VALID_PROVIDERS.has(defaultProvider)) throw validationError(`Provider ${defaultProvider} tidak dikenal`);
  if (defaultProvider === 'claude_team' && !defaultClaudeTeamAccountId) {
    throw validationError('Pilih akun Claude Team untuk dijadikan default');
  }
  await pool.query(
    `UPDATE ai_routing_settings
        SET default_provider=?, default_claude_team_account_id=?, updated_by=?
      WHERE id=1`,
    [defaultProvider, defaultProvider === 'claude_team' ? defaultClaudeTeamAccountId : null, userId]
  );
  return getRoutingSettings();
}

async function listDivisionAssignments() {
  const [rows] = await pool.query(
    `SELECT a.department_id AS departmentId, a.provider, a.claude_team_account_id AS claudeTeamAccountId,
            d.name AS departmentName, ca.label AS claudeTeamAccountLabel
       FROM ai_division_assignments a
       JOIN departments d ON d.id = a.department_id
       LEFT JOIN ai_claude_team_accounts ca ON ca.id = a.claude_team_account_id
      WHERE d.deleted_at IS NULL
      ORDER BY d.name ASC`
  );
  return rows;
}

async function getDivisionAssignment(departmentId) {
  const [rows] = await pool.query(
    'SELECT provider, claude_team_account_id AS claudeTeamAccountId FROM ai_division_assignments WHERE department_id=?',
    [departmentId]
  );
  return rows[0] || null;
}

async function setDivisionAssignment(departmentId, { provider, claudeTeamAccountId }, userId) {
  if (!VALID_PROVIDERS.has(provider)) throw validationError(`Provider ${provider} tidak dikenal`);
  if (provider === 'claude_team' && !claudeTeamAccountId) {
    throw validationError('Pilih akun Claude Team untuk divisi ini');
  }
  const [[department]] = await pool.query(
    'SELECT id FROM departments WHERE id=? AND deleted_at IS NULL', [departmentId]
  );
  if (!department) throw Object.assign(new Error('Divisi tidak ditemukan'), { status: 404, code: 'NOT_FOUND' });

  await pool.query(
    `INSERT INTO ai_division_assignments (department_id, provider, claude_team_account_id, updated_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE provider=VALUES(provider), claude_team_account_id=VALUES(claude_team_account_id), updated_by=VALUES(updated_by)`,
    [departmentId, provider, provider === 'claude_team' ? claudeTeamAccountId : null, userId]
  );
  return getDivisionAssignment(departmentId);
}

async function clearDivisionAssignment(departmentId) {
  await pool.query('DELETE FROM ai_division_assignments WHERE department_id=?', [departmentId]);
}

// Pure decision: given the global default and an optional per-division override,
// which provider auto-applies, and which Claude Team account would be used if
// Claude Team is picked (as the auto-default, or manually from the engine menu)?
// claudeTeamAccountId is always resolved, independent of `provider` — otherwise a
// division defaulted to a different engine would lose Claude Team as a manual
// choice entirely, even though a working account still exists for it.
// Exported separately from the DB-backed wrapper below so the routing logic
// itself is unit-tested without mocking the pool.
function resolveEngine({ routing, assignment }) {
  return {
    provider: assignment?.provider ?? routing.defaultProvider,
    claudeTeamAccountId: assignment?.claudeTeamAccountId ?? routing.defaultClaudeTeamAccountId,
  };
}

async function resolveEngineForUser(identity) {
  const routing = await getRoutingSettings();
  const assignment = identity?.departmentId ? await getDivisionAssignment(identity.departmentId) : null;
  return resolveEngine({ routing, assignment });
}

module.exports = {
  loadUserIdentity,
  getRoutingSettings,
  saveRoutingSettings,
  listDivisionAssignments,
  getDivisionAssignment,
  setDivisionAssignment,
  clearDivisionAssignment,
  resolveEngine,
  resolveEngineForUser,
};
