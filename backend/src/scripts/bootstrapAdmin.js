#!/usr/bin/env node
require('dotenv').config();

const pool = require('../db/pool');
const intLog = require('../services/integrationLog.service');
const {
  bootstrapFirstAdmin,
  MIN_PASSWORD_LENGTH,
} = require('../services/adminBootstrap.service');

function abort(message) {
  const error = new Error(message);
  error.code = 'BOOTSTRAP_ABORT';
  throw error;
}

function validateBootstrapInput() {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
    abort(
      'NODE_ENV=production. bootstrapAdmin hanya boleh dijalankan di local/development.'
    );
  }

  if (String(process.env.BOOTSTRAP_ALLOW || '').toLowerCase() !== 'yes') {
    abort('BOOTSTRAP_ALLOW=yes wajib diset secara eksplisit.');
  }

  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || '')
    .trim()
    .toLowerCase();
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
  const name = String(process.env.BOOTSTRAP_ADMIN_NAME || '').trim()
    || (email ? email.split('@')[0] : 'Super Admin');
  const entityId = Number(process.env.BOOTSTRAP_ADMIN_ENTITY_ID || 1);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    abort('BOOTSTRAP_ADMIN_EMAIL tidak valid.');
  }
  if (!password) {
    abort('BOOTSTRAP_ADMIN_PASSWORD wajib diisi.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    abort(
      `BOOTSTRAP_ADMIN_PASSWORD minimal ${MIN_PASSWORD_LENGTH} karakter.`
    );
  }

  const lowerPassword = password.toLowerCase();
  const localPart = email.split('@')[0].toLowerCase();
  if (
    lowerPassword.includes('admin') ||
    (localPart.length >= 4 && lowerPassword.includes(localPart))
  ) {
    abort('BOOTSTRAP_ADMIN_PASSWORD terlalu lemah.');
  }

  if (!Number.isInteger(entityId) || entityId <= 0) {
    abort('BOOTSTRAP_ADMIN_ENTITY_ID tidak valid.');
  }

  return { email, password, name, entityId };
}

(async () => {
  const input = validateBootstrapInput();
  const result = await bootstrapFirstAdmin({
    ...input,
    mustChangePassword: false,
  });

  if (result.created) {
    console.log(
      `[bootstrapAdmin] Super Admin dibuat: ${input.email} (id=${result.id}). Hapus env BOOTSTRAP_* setelah selesai.`
    );
  } else {
    console.log(
      `[bootstrapAdmin] Admin ${input.email} sudah ada (id=${result.id}). Password TIDAK diubah.`
    );
  }

  await intLog.log({
    entityId: result.entityId,
    userId: result.id,
    provider: 'internal',
    operation: result.created
      ? 'bootstrapAdmin.created'
      : 'bootstrapAdmin.existing',
    status: result.created ? 'success' : 'skipped',
    requestMeta: { email: input.email },
  });
})()
  .catch((error) => {
    console.error(`[bootstrapAdmin] ABORT: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await pool.end(); } catch { /* noop */ }
  });
