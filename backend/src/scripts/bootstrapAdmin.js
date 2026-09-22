#!/usr/bin/env node
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const intLog = require('../services/integrationLog.service');

const MIN_PASSWORD_LENGTH = 12;

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
    abort(`BOOTSTRAP_ADMIN_PASSWORD minimal ${MIN_PASSWORD_LENGTH} karakter.`);
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
  const { email, password, name, entityId } = validateBootstrapInput();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [entities] = await conn.query(
      `SELECT id FROM entities
        WHERE id=? AND deleted_at IS NULL
        LIMIT 1`,
      [entityId]
    );
    if (!entities[0]) {
      abort(`Entity id=${entityId} tidak ditemukan.`);
    }

    let [[role]] = await conn.query(
      `SELECT id FROM roles
        WHERE entity_id=?
          AND LOWER(name) IN ('super admin','superadmin','administrator','admin')
          AND deleted_at IS NULL
        ORDER BY CASE LOWER(name)
          WHEN 'super admin' THEN 1
          WHEN 'superadmin' THEN 2
          WHEN 'administrator' THEN 3
          ELSE 4
        END
        LIMIT 1`,
      [entityId]
    );

    if (!role) {
      const [roleInsert] = await conn.query(
        'INSERT INTO roles (entity_id, name) VALUES (?, ?)',
        [entityId, 'Super Admin']
      );
      role = { id: roleInsert.insertId };
    }

    // Preserve legacy bootstrap behavior: the Super Admin role owns every
    // permission currently registered in the environment.
    await conn.query(
      `INSERT IGNORE INTO role_permissions (role_id, permission_id)
       SELECT ?, id FROM permissions`,
      [role.id]
    );

    const [existingRows] = await conn.query(
      `SELECT id, entity_id AS entityId, status, deleted_at AS deletedAt
         FROM users
        WHERE email=?
        LIMIT 1`,
      [email]
    );
    const existing = existingRows[0] || null;

    if (existing) {
      if (existing.deletedAt) {
        abort(
          'User dengan email bootstrap sudah soft-deleted. Restore secara manual; script tidak akan menghidupkan ulang akun terhapus.'
        );
      }
      if (Number(existing.entityId) !== entityId) {
        abort(
          `User ${email} sudah ada di entity berbeda. Script tidak akan memindahkan user lintas entity.`
        );
      }

      await conn.query(
        `UPDATE users
            SET status='active'
          WHERE id=? AND status<>'active'`,
        [existing.id]
      );
      await conn.query(
        'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
        [existing.id, role.id]
      );

      await conn.commit();

      console.log(
        `[bootstrapAdmin] Admin ${email} sudah ada (id=${existing.id}). Password TIDAK diubah.`
      );
      await intLog.log({
        entityId,
        userId: existing.id,
        provider: 'internal',
        operation: 'bootstrapAdmin.existing',
        status: 'skipped',
        requestMeta: { email },
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [insert] = await conn.query(
      `INSERT INTO users
       (entity_id, department_id, name, email, password_hash, must_change_password, status)
       VALUES (?, NULL, ?, ?, ?, 0, 'active')`,
      [entityId, name, email, passwordHash]
    );
    const userId = insert.insertId;

    await conn.query(
      'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [userId, role.id]
    );

    await conn.commit();

    console.log(
      `[bootstrapAdmin] Super Admin dibuat: ${email} (id=${userId}). Hapus env BOOTSTRAP_* setelah selesai.`
    );
    await intLog.log({
      entityId,
      userId,
      provider: 'internal',
      operation: 'bootstrapAdmin.created',
      status: 'success',
      requestMeta: { email },
    });
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
})().catch((error) => {
  console.error(`[bootstrapAdmin] ABORT: ${error.message}`);
  process.exit(1);
});
