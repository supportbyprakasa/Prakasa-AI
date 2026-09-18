require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const isDevelopment = (process.env.NODE_ENV || 'development') !== 'production';

(async () => {
  const email = (
    process.env.BOOTSTRAP_ADMIN_EMAIL ||
    (isDevelopment ? 'admin@prakasagroup.com' : '')
  ).trim().toLowerCase();

  const password =
    process.env.BOOTSTRAP_ADMIN_PASSWORD ||
    (isDevelopment ? 'Prakasa@2026-Admin!7xQ' : '');

  const name = (
    process.env.BOOTSTRAP_ADMIN_NAME ||
    (isDevelopment ? 'Super Admin' : '')
  ).trim();

  const entityId = Number(process.env.BOOTSTRAP_ADMIN_ENTITY_ID || 1);

  if (!email || !password || !name) {
    throw new Error(
      'Production bootstrap requires BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL, and BOOTSTRAP_ADMIN_PASSWORD'
    );
  }

  if (password.length < 10) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 10 characters');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let [[role]] = await conn.query(
      'SELECT id FROM roles WHERE entity_id = ? AND name = ? AND deleted_at IS NULL LIMIT 1',
      [entityId, 'Super Admin']
    );

    if (!role) {
      const [roleInsert] = await conn.query(
        'INSERT INTO roles (entity_id, name) VALUES (?, ?)',
        [entityId, 'Super Admin']
      );
      role = { id: roleInsert.insertId };
    }

    await conn.query(
      `INSERT IGNORE INTO role_permissions (role_id, permission_id)
       SELECT ?, id FROM permissions`,
      [role.id]
    );

    const passwordHash = await bcrypt.hash(password, 12);

    let [[user]] = await conn.query(
      'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
      [email]
    );

    if (!user) {
      const [insert] = await conn.query(
        `INSERT INTO users
         (entity_id, department_id, name, email, password_hash, must_change_password, status)
         VALUES (?, NULL, ?, ?, ?, 0, 'active')`,
        [entityId, name, email, passwordHash]
      );
      user = { id: insert.insertId };
    } else {
      await conn.query(
        `UPDATE users
            SET name = ?, entity_id = ?, password_hash = ?,
                must_change_password = 0, status = 'active'
          WHERE id = ?`,
        [name, entityId, passwordHash, user.id]
      );
    }

    await conn.query(
      'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [user.id, role.id]
    );

    await conn.commit();

    console.log(`Super Admin ready: ${email} (user_id=${user.id})`);

    if (isDevelopment && !process.env.BOOTSTRAP_ADMIN_PASSWORD) {
      console.log('Local development credential:');
      console.log('  Email    : admin@prakasagroup.com');
      console.log('  Password : Prakasa@2026-Admin!7xQ');
    }
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
    await pool.end();
  }
})().catch((error) => {
  console.error('Bootstrap failed:', error.message);
  process.exit(1);
});
