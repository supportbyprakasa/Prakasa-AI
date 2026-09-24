const pool = require('../../db/pool');

const CLAUDE_TEAM = 'claude_team';
// Model value is passed to the Claude CLI as an argv value; never allow a leading dash.
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-[\]]{0,79}$/;
const DEFAULT_MODEL = 'sonnet';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function safeModel(value) {
  const model = String(value || '').trim();
  return MODEL_PATTERN.test(model) ? model : null;
}

function envClaudeTeamSettings() {
  const email = normalizeEmail(process.env.CLAUDE_TEAM_ALLOWED_EMAIL);
  return {
    enabled: process.env.CLAUDE_TEAM_SUBSCRIPTION_ENABLED === 'yes',
    allowedDepartmentIds: [],
    allowedEmails: email ? [email] : [],
    model: safeModel(process.env.CLAUDE_TEAM_MODEL) || DEFAULT_MODEL,
    webResearch: process.env.CLAUDE_TEAM_WEB_RESEARCH === 'yes',
    source: 'env',
    updatedAt: null,
    updatedBy: null,
  };
}

function parseConfig(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

async function getClaudeTeamSettings() {
  const [rows] = await pool.query(
    `SELECT enabled, config, updated_by AS updatedBy, updated_at AS updatedAt
       FROM ai_provider_settings
      WHERE provider=?
      LIMIT 1`,
    [CLAUDE_TEAM]
  );
  if (!rows[0]) return envClaudeTeamSettings();

  const config = parseConfig(rows[0].config);
  return {
    enabled: Boolean(rows[0].enabled),
    allowedDepartmentIds: (Array.isArray(config.allowedDepartmentIds) ? config.allowedDepartmentIds : [])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0),
    allowedEmails: (Array.isArray(config.allowedEmails) ? config.allowedEmails : [])
      .map(normalizeEmail)
      .filter(Boolean),
    model: safeModel(config.model) || safeModel(process.env.CLAUDE_TEAM_MODEL) || DEFAULT_MODEL,
    webResearch: config.webResearch === true,
    source: 'database',
    updatedAt: rows[0].updatedAt,
    updatedBy: rows[0].updatedBy,
  };
}

async function saveClaudeTeamSettings({
  enabled,
  allowedDepartmentIds,
  allowedEmails,
  model,
  webResearch = false,
}, userId) {
  const departmentIds = [...new Set(allowedDepartmentIds.map(Number))];
  const emails = [...new Set(allowedEmails.map(normalizeEmail).filter(Boolean))];
  const cleanModel = safeModel(model);

  if (!cleanModel) {
    const error = new Error('Model tidak valid');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  if (departmentIds.length) {
    const [rows] = await pool.query(
      `SELECT id FROM departments WHERE id IN (?) AND deleted_at IS NULL`,
      [departmentIds]
    );
    const found = new Set(rows.map((row) => Number(row.id)));
    const missing = departmentIds.filter((id) => !found.has(id));
    if (missing.length) {
      const error = new Error(`Divisi tidak ditemukan: ${missing.join(', ')}`);
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
  }

  const config = JSON.stringify({
    allowedDepartmentIds: departmentIds,
    allowedEmails: emails,
    model: cleanModel,
    webResearch: webResearch === true,
  });

  await pool.query(
    `INSERT INTO ai_provider_settings (provider, enabled, config, updated_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), config=VALUES(config), updated_by=VALUES(updated_by)`,
    [CLAUDE_TEAM, enabled ? 1 : 0, config, userId || null]
  );

  return getClaudeTeamSettings();
}

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

function isClaudeTeamAllowed(settings, identity) {
  if (!settings?.enabled || !identity) return false;
  const email = normalizeEmail(identity.email);
  if (email && settings.allowedEmails.includes(email)) return true;
  const departmentId = Number(identity.departmentId);
  return Number.isInteger(departmentId) && settings.allowedDepartmentIds.includes(departmentId);
}

module.exports = {
  MODEL_PATTERN,
  getClaudeTeamSettings,
  saveClaudeTeamSettings,
  loadUserIdentity,
  isClaudeTeamAllowed,
  safeModel,
};
