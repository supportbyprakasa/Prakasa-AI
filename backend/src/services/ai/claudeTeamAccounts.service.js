const pool = require('../../db/pool');
const { assertSafeGatewayUrl } = require('../../utils/safeUrl');
const logger = require('../../utils/logger');
const { encryptBuffer, decryptBuffer } = require('../signature.service');
const { safeModel, maskSecret } = require('./providerSettings');

// Gateway secrets are stored encrypted (AES-256-GCM with SIGNATURE_ENCRYPTION_KEY,
// the same key as the Accurate credentials) in the existing VARCHAR(255) column:
//   enc1:<base64url(iv 12 bytes | auth tag 16 bytes | ciphertext)>
// Rows written before encryption hold the plain secret and are still read as
// such; they are encrypted the next time the account is saved.
const SECRET_PREFIX = 'enc1:';
// 255 - prefix leaves room for (12 + 16 + n) bytes in base64 => n <= 158.
const MAX_SECRET_BYTES = 150;

function sealSecret(plain) {
  if (plain == null || plain === '') return null;
  const sealed = encryptBuffer(Buffer.from(String(plain), 'utf8'));
  const packed = Buffer.concat([Buffer.from(sealed.iv, 'hex'), Buffer.from(sealed.authTag, 'hex'), sealed.encrypted]);
  return `${SECRET_PREFIX}${packed.toString('base64url')}`;
}

function isSealed(stored) {
  return typeof stored === 'string' && stored.startsWith(SECRET_PREFIX);
}

// The plain secret of a stored value (encrypted or legacy plain text); null
// when it cannot be decrypted (e.g. SIGNATURE_ENCRYPTION_KEY changed).
function openSecret(stored) {
  if (stored == null || stored === '') return null;
  if (!isSealed(stored)) return String(stored);
  try {
    const packed = Buffer.from(stored.slice(SECRET_PREFIX.length), 'base64url');
    return decryptBuffer({
      iv: packed.subarray(0, 12).toString('hex'),
      authTag: packed.subarray(12, 28).toString('hex'),
      encrypted: packed.subarray(28),
    }).toString('utf8');
  } catch (error) {
    logger.error({ err: error.message }, '[claudeTeamAccounts] gateway secret tidak bisa dibuka');
    return null;
  }
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

function notFoundError() {
  return Object.assign(new Error('Akun Claude Team tidak ditemukan'), { status: 404, code: 'NOT_FOUND' });
}

function toRow(row, { includeSecret = false } = {}) {
  const secret = openSecret(row.gateway_secret);
  return {
    id: row.id,
    label: row.label,
    mode: row.mode,
    gatewayUrl: row.gateway_url,
    gatewaySecret: includeSecret
      ? secret
      : (secret == null && row.gateway_secret ? { set: true, preview: '••••' } : maskSecret(secret)),
    model: row.model,
    webResearch: Boolean(row.web_research),
    enabled: Boolean(row.enabled),
    updatedAt: row.updated_at,
  };
}

async function listAccounts({ includeSecret = false } = {}) {
  const [rows] = await pool.query(
    'SELECT * FROM ai_claude_team_accounts WHERE deleted_at IS NULL ORDER BY id ASC'
  );
  return rows.map((row) => toRow(row, { includeSecret }));
}

async function getAccount(id, { includeSecret = false } = {}) {
  if (!id) return null;
  const [rows] = await pool.query(
    'SELECT * FROM ai_claude_team_accounts WHERE id=? AND deleted_at IS NULL LIMIT 1', [id]
  );
  return rows[0] ? toRow(rows[0], { includeSecret }) : null;
}

function validateFields({ label, mode, gatewayUrl, gatewaySecret, model }) {
  if (!label || !label.trim()) throw validationError('Nama akun wajib diisi');
  if (!['cli', 'gateway'].includes(mode)) throw validationError('Mode akun tidak dikenal');
  if (mode === 'gateway') {
    if (!gatewayUrl || !/^https?:\/\//i.test(gatewayUrl)) throw validationError('URL gateway tidak valid');
    if (!gatewaySecret || gatewaySecret.length < 16) throw validationError('Secret gateway minimal 16 karakter');
    if (Buffer.byteLength(gatewaySecret, 'utf8') > MAX_SECRET_BYTES) {
      throw validationError(`Secret gateway maksimal ${MAX_SECRET_BYTES} karakter`);
    }
  }
  const cleanModel = safeModel(model);
  if (!cleanModel) throw validationError('Model tidak valid');
  return cleanModel;
}

// The CLI mode is tied to whatever account is logged into this one server via
// `claude auth login` — there can only ever be one. Every additional account
// must run its own pre-authenticated gateway process (see docs).
async function assertSingleCliAccount(excludeId = null) {
  const [rows] = await pool.query(
    'SELECT id FROM ai_claude_team_accounts WHERE mode="cli" AND deleted_at IS NULL AND id != ?',
    [excludeId || 0]
  );
  if (rows.length) {
    throw validationError(
      'Sudah ada akun bermode CLI (login langsung di server ini). Akun tambahan harus memakai mode gateway dengan URL dan secret dari server yang sudah login terpisah.'
    );
  }
}

async function createAccount(input, userId) {
  const model = validateFields(input);
  if (input.mode === 'gateway') await assertSafeGatewayUrl(input.gatewayUrl);
  if (input.mode === 'cli') await assertSingleCliAccount();

  const [result] = await pool.query(
    `INSERT INTO ai_claude_team_accounts
       (label, mode, gateway_url, gateway_secret, model, web_research, enabled, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.label.trim(),
      input.mode,
      input.mode === 'gateway' ? input.gatewayUrl : null,
      input.mode === 'gateway' ? sealSecret(input.gatewaySecret) : null,
      model,
      Boolean(input.webResearch),
      input.enabled !== false,
      userId,
    ]
  );
  return getAccount(result.insertId);
}

async function updateAccount(id, patch, userId) {
  const [[existing]] = await pool.query(
    'SELECT * FROM ai_claude_team_accounts WHERE id=? AND deleted_at IS NULL', [id]
  );
  if (!existing) throw notFoundError();

  const merged = {
    label: patch.label !== undefined ? patch.label : existing.label,
    mode: patch.mode !== undefined ? patch.mode : existing.mode,
    gatewayUrl: patch.gatewayUrl !== undefined ? patch.gatewayUrl : existing.gateway_url,
    gatewaySecret: patch.gatewaySecret !== undefined ? patch.gatewaySecret : openSecret(existing.gateway_secret),
    model: patch.model !== undefined ? patch.model : existing.model,
  };
  const model = validateFields(merged);
  if (merged.mode === 'gateway' && (patch.gatewayUrl !== undefined || existing.mode !== 'gateway')) {
    await assertSafeGatewayUrl(merged.gatewayUrl);
  }
  if (merged.mode === 'cli' && existing.mode !== 'cli') await assertSingleCliAccount(id);

  await pool.query(
    `UPDATE ai_claude_team_accounts
        SET label=?, mode=?, gateway_url=?, gateway_secret=?, model=?, web_research=?, enabled=?, updated_by=?
      WHERE id=?`,
    [
      merged.label.trim(),
      merged.mode,
      merged.mode === 'gateway' ? merged.gatewayUrl : null,
      merged.mode === 'gateway' ? sealSecret(merged.gatewaySecret) : null,
      model,
      patch.webResearch !== undefined ? Boolean(patch.webResearch) : Boolean(existing.web_research),
      patch.enabled !== undefined ? Boolean(patch.enabled) : Boolean(existing.enabled),
      userId,
      id,
    ]
  );
  return getAccount(id);
}

async function deleteAccount(id) {
  const [[inUseAsDefault]] = await pool.query(
    'SELECT id FROM ai_routing_settings WHERE default_claude_team_account_id=?', [id]
  );
  if (inUseAsDefault) {
    throw validationError('Akun ini dipakai sebagai engine default. Pilih akun default lain dulu sebelum menghapus.');
  }
  const [divisions] = await pool.query(
    `SELECT d.name FROM ai_division_assignments a
       JOIN departments d ON d.id = a.department_id
      WHERE a.claude_team_account_id=?`,
    [id]
  );
  if (divisions.length) {
    throw validationError(`Akun ini dipakai oleh divisi: ${divisions.map((d) => d.name).join(', ')}. Ubah dulu penetapan divisinya sebelum menghapus.`);
  }
  const [result] = await pool.query(
    'UPDATE ai_claude_team_accounts SET deleted_at=NOW() WHERE id=? AND deleted_at IS NULL', [id]
  );
  if (!result.affectedRows) throw notFoundError();
}

module.exports = {
  listAccounts, getAccount, createAccount, updateAccount, deleteAccount, sealSecret, openSecret, isSealed, MAX_SECRET_BYTES,
};
