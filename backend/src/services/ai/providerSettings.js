const pool = require('../../db/pool');
const { assertSafeGatewayUrl } = require('../../utils/safeUrl');

// Model value is passed to CLI/API calls as an argv or JSON value; never allow a leading dash.
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-[\]]{0,79}$/;

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash',
  claude: 'claude-sonnet-4-5',
};

const SECRET_FIELDS = {
  openai: ['apiKey'],
  gemini: ['apiKey'],
  claude: ['apiKey'],
  n8n: ['gatewaySecret'],
};

function safeModel(value) {
  const model = String(value || '').trim();
  return MODEL_PATTERN.test(model) ? model : null;
}

function parseConfig(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

function maskSecret(value) {
  if (!value) return { set: false, preview: null };
  const text = String(value);
  return { set: true, preview: text.length > 4 ? `••••${text.slice(-4)}` : '••••' };
}

// Returns config with secret fields replaced by { set, preview } — never the real value.
function maskConfig(provider, config) {
  const masked = { ...config };
  for (const field of SECRET_FIELDS[provider] || []) {
    masked[field] = maskSecret(config[field]);
  }
  return masked;
}

/** `includeSecrets: true` is for server-side call sites only (the actual API request). */
async function getProviderConfig(provider, { includeSecrets = false } = {}) {
  const [rows] = await pool.query(
    'SELECT enabled, config, updated_by AS updatedBy, updated_at AS updatedAt FROM ai_provider_settings WHERE provider=? LIMIT 1',
    [provider]
  );
  const config = parseConfig(rows[0]?.config);
  return {
    provider,
    enabled: Boolean(rows[0]?.enabled),
    model: safeModel(config.model) || DEFAULT_MODELS[provider] || null,
    config: includeSecrets ? config : maskConfig(provider, config),
    updatedBy: rows[0]?.updatedBy ?? null,
    updatedAt: rows[0]?.updatedAt ?? null,
  };
}

async function getAllProviderConfigs() {
  const providers = ['openai', 'gemini', 'claude', 'n8n'];
  return Promise.all(providers.map((provider) => getProviderConfig(provider)));
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

/**
 * `patch.apiKey` / `patch.gatewaySecret` of `undefined` keeps the stored secret;
 * an explicit empty string clears it. This lets the UI submit a form without the
 * secret field (unchanged) or with a new value, without ever round-tripping the
 * real secret back through the browser.
 */
async function saveProviderConfig(provider, patch, userId) {
  if (!SECRET_FIELDS[provider]) throw validationError(`Provider ${provider} tidak dikenal`);

  const [rows] = await pool.query('SELECT config FROM ai_provider_settings WHERE provider=? LIMIT 1', [provider]);
  const current = parseConfig(rows[0]?.config);

  const model = patch.model !== undefined ? safeModel(patch.model) : safeModel(current.model);
  if (!model) throw validationError('Model tidak valid');

  const config = { ...current, model };
  if (provider === 'n8n') {
    if (patch.gatewayUrl !== undefined) {
      // https only, never an internal address in production (utils/safeUrl.js).
      if (patch.gatewayUrl) await assertSafeGatewayUrl(patch.gatewayUrl);
      config.gatewayUrl = patch.gatewayUrl || null;
    }
    if (patch.gatewaySecret !== undefined) config.gatewaySecret = patch.gatewaySecret || null;
  } else if (patch.apiKey !== undefined) {
    config.apiKey = patch.apiKey || null;
  }

  const enabled = patch.enabled !== undefined ? Boolean(patch.enabled) : Boolean(rows[0]);
  await pool.query(
    `INSERT INTO ai_provider_settings (provider, enabled, config, updated_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), config=VALUES(config), updated_by=VALUES(updated_by)`,
    [provider, enabled, JSON.stringify(config), userId]
  );
  return getProviderConfig(provider);
}

module.exports = {
  MODEL_PATTERN,
  DEFAULT_MODELS,
  safeModel,
  maskSecret,
  getProviderConfig,
  getAllProviderConfigs,
  saveProviderConfig,
};
