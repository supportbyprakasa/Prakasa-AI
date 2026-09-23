const pool = require('../db/pool');
const { ok, fail } = require('../utils/response');
const logger = require('../utils/logger');
const {
  inspectMigrationStatus,
  runPendingMigrations,
} = require('../services/migrationRunner.service');
const {
  bootstrapFirstAdmin,
} = require('../services/adminBootstrap.service');
const { safeAudit } = require('../services/setupAudit.service');

function publicMigrationStatus(status) {
  return {
    files: status.files.length,
    applied: status.applied.length,
    pending: status.pending.length,
    changed: status.changed.length,
    missing: status.missing.length,
    ledgerExists: status.ledgerExists,
    ledgerRows: status.ledgerRows,
    existingDomainTables: status.existingDomainTables,
    requiresBaseline:
      status.existingDomainTables > 0 &&
      (!status.ledgerExists || status.ledgerRows === 0),
    pendingFiles: status.pending.map((file) => file.filename),
  };
}

async function status(req, res, next) {
  const startedAt = Date.now();
  try {
    const migrations = await inspectMigrationStatus(pool);

    let users = null;
    const [userTable] = await pool.query(
      `SELECT COUNT(*) AS c
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'users'`
    );
    if (Number(userTable[0]?.c || 0) > 0) {
      const [[row]] = await pool.query(
        'SELECT COUNT(*) AS c FROM users WHERE deleted_at IS NULL'
      );
      users = Number(row?.c || 0);
    }

    await safeAudit({
      operation: 'setup.status',
      status: 'success',
      responseMeta: {
        pending: migrations.pending.length,
        applied: migrations.applied.length,
        users,
      },
      durationMs: Date.now() - startedAt,
    });

    return ok(res, {
      migrations: publicMigrationStatus(migrations),
      users,
    });
  } catch (error) {
    logger.error({ err: error.message }, '[setup] status failed');
    next(error);
  }
}

async function migrate(req, res, next) {
  const startedAt = Date.now();
  try {
    const result = await runPendingMigrations({
      forceFiles: new Set(),
      dryRun: false,
      allowExistingSchema: false,
    });

    if (result.status === 'blocked') {
      await safeAudit({
        operation: 'setup.migrate',
        status: 'failed',
        errorMessage: result.reason,
        responseMeta: result.before,
        durationMs: Date.now() - startedAt,
      });
      return fail(
        res,
        'MIGRATION_BLOCKED',
        result.reason === 'missing_file'
          ? 'Migrasi diblokir karena file migration tercatat hilang dari source.'
          : 'Migrasi diblokir karena checksum migration berubah.',
        409
      );
    }

    if (result.status === 'error') {
      await safeAudit({
        operation: 'setup.migrate',
        status: 'failed',
        errorMessage: result.errorMessage,
        responseMeta: {
          failedFile: result.failedFile,
          executedCount: result.executed.length,
        },
        durationMs: Date.now() - startedAt,
      });
      return fail(
        res,
        'MIGRATION_FAILED',
        'Migrasi gagal. Periksa application log untuk detail.',
        500,
        { failedFile: result.failedFile }
      );
    }

    await safeAudit({
      operation: 'setup.migrate',
      status: 'success',
      responseMeta: {
        executedCount: result.executed.length,
        after: result.after,
      },
      durationMs: Date.now() - startedAt,
    });

    return ok(res, {
      status: 'ok',
      executed: result.executed,
      before: result.before,
      after: result.after,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (error.status === 409) {
      await safeAudit({
        operation: 'setup.migrate',
        status: 'failed',
        errorMessage: error.code || 'CONFLICT',
        durationMs: Date.now() - startedAt,
      });
      return fail(
        res,
        error.code || 'CONFLICT',
        error.message,
        409
      );
    }

    logger.error({ err: error.message }, '[setup] migrate failed');
    next(error);
  }
}

async function bootstrapAdmin(req, res, next) {
  const startedAt = Date.now();
  try {
    const migrations = await inspectMigrationStatus(pool);
    if (
      !migrations.ledgerExists ||
      migrations.pending.length ||
      migrations.changed.length ||
      migrations.missing.length ||
      migrations.applied.length !== migrations.files.length
    ) {
      return fail(
        res,
        'MIGRATION_INCOMPLETE',
        'Migration ledger belum 100% healthy. Selesaikan migration terlebih dahulu.',
        409,
        {
          applied: migrations.applied.length,
          pending: migrations.pending.length,
          changed: migrations.changed.length,
          missing: migrations.missing.length,
        }
      );
    }

    const {
      email,
      name,
      password,
      entityId = 1,
    } = req.body;

    const normalizedEmail = String(email).trim().toLowerCase();
    const [[userCountRow]] = await pool.query(
      'SELECT COUNT(*) AS c FROM users'
    );
    const userCount = Number(userCountRow?.c || 0);

    if (userCount > 0) {
      const [existingAdminRows] = await pool.query(
        `SELECT u.id
           FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
          WHERE u.email = ?
            AND u.deleted_at IS NULL
            AND r.deleted_at IS NULL
            AND LOWER(r.name) IN
              ('super admin','superadmin','administrator','admin')
          LIMIT 1`,
        [normalizedEmail]
      );

      if (!existingAdminRows[0]) {
        return fail(
          res,
          'FIRST_ADMIN_ALREADY_PROVISIONED',
          'Database sudah memiliki user. Setup endpoint tidak boleh membuat atau mengangkat Super Admin baru.',
          409
        );
      }
    }

    const result = await bootstrapFirstAdmin({
      email,
      name,
      password,
      entityId,
      mustChangePassword: true,
    });

    await safeAudit({
      entityId: result.entityId,
      userId: result.id,
      operation: 'setup.bootstrap_admin',
      status: 'success',
      responseMeta: {
        created: result.created,
        roleId: result.roleId,
        passwordReset: false,
      },
      durationMs: Date.now() - startedAt,
    });

    return ok(
      res,
      {
        id: result.id,
        entityId: result.entityId,
        roleId: result.roleId,
        created: result.created,
        passwordReset: false,
      },
      undefined,
      result.created ? 201 : 200
    );
  } catch (error) {
    if (error.status === 400 || error.status === 409) {
      await safeAudit({
        operation: 'setup.bootstrap_admin',
        status: 'failed',
        errorMessage: error.code || 'VALIDATION_ERROR',
        durationMs: Date.now() - startedAt,
      });
      return fail(
        res,
        error.code || 'VALIDATION_ERROR',
        error.message,
        error.status
      );
    }

    logger.error(
      { err: error.message },
      '[setup] bootstrap-admin failed'
    );
    next(error);
  }
}

module.exports = {
  status,
  migrate,
  bootstrapAdmin,
};
