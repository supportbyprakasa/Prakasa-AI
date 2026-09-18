require('dotenv').config();
const pool = require('../db/pool');

const checks = [];
let failed = false;

function pass(label, detail = '') {
  checks.push({ status: 'PASS', label, detail });
}
function fail(label, detail = '') {
  failed = true;
  checks.push({ status: 'FAIL', label, detail });
}
function warn(label, detail = '') {
  checks.push({ status: 'WARN', label, detail });
}

async function tableExists(table) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS c
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
    [table]
  );
  return Number(row.c) > 0;
}

async function columnExists(table, column) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS c
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME=?
        AND COLUMN_NAME=?`,
    [table, column]
  );
  return Number(row.c) > 0;
}

async function checkColumns(table, columns) {
  const missing = [];
  for (const column of columns) {
    if (!(await columnExists(table, column))) missing.push(column);
  }
  if (missing.length) {
    fail(`${table} columns`, `Missing: ${missing.join(', ')}`);
  } else {
    pass(`${table} columns`, `${columns.length}/${columns.length} present`);
  }
}

(async () => {
  try {
    const requiredTables = [
      'approval_delegations',
      'approval_reminders',
      'approval_audit_log',
      'signature_precheck_logs',
    ];
    const missingTables = [];
    for (const table of requiredTables) {
      if (!(await tableExists(table))) missingTables.push(table);
    }
    if (missingTables.length) {
      fail('Batch 2 tables', `Missing: ${missingTables.join(', ')}`);
    } else {
      pass('Batch 2 tables', `${requiredTables.length}/${requiredTables.length} present`);
    }

    await checkColumns('approval_matrix', [
      'matrix_key','matrix_name','document_type_id','request_type',
      'order_index','amount_min','amount_max','currency','flow_type',
      'parallel_group','is_optional','priority','signer_user_id',
      'signer_role_id','escalation_user_id','escalation_role_id',
      'reminder_after_hours','escalate_after_hours','is_active',
      'created_by','updated_at','deleted_at',
    ]);

    await checkColumns('approval_requests', [
      'request_type','document_type_id','amount','currency',
      'flow_type','matrix_key','matrix_rule_ids',
    ]);

    await checkColumns('approval_steps', [
      'matrix_rule_id','order_index','parallel_group','is_optional',
      'delegated_from_user_id','activated_at','deadline_at',
      'escalated_at','escalated_to_user_id','escalated_to_role_id',
    ]);

    await checkColumns('signature_rules', [
      'qr_required','checksum_algorithm','precheck_module',
    ]);

    await checkColumns('signature_requests', [
      'signature_rule_id','assigned_signer_user_id','assigned_signer_role_id',
    ]);

    await checkColumns('signed_documents', [
      'hash_algorithm','hash_source',
    ]);

    await checkColumns('document_verifications', [
      'verification_url','hash_algorithm','metadata_json','qr_generated_at',
    ]);

    const permissionCodes = [
      'approval_matrix.view','approval_matrix.manage',
      'approval_delegation.view','approval_delegation.manage',
      'approval_reminder.manage',
      'signature_precheck.view','signature_precheck.run',
      'signature_precheck.override',
      'signature_qr.view','signature_qr.generate',
    ];

    const [permissions] = await pool.query(
      'SELECT code FROM permissions WHERE code IN (?)',
      [permissionCodes]
    );
    if (permissions.length === permissionCodes.length) {
      pass('Batch 2 permissions', `${permissions.length}/${permissionCodes.length} present`);
    } else {
      const present = new Set(permissions.map((row) => row.code));
      const missing = permissionCodes.filter((code) => !present.has(code));
      fail('Batch 2 permissions', `Missing: ${missing.join(', ')}`);
    }

    const [admins] = await pool.query(
      `SELECT u.id, u.email, r.name AS roleName,
              COUNT(DISTINCT CASE WHEN p.code IN (?) THEN p.code END) AS batch2PermissionCount
         FROM users u
         JOIN user_roles ur ON ur.user_id=u.id
         JOIN roles r ON r.id=ur.role_id AND r.deleted_at IS NULL
         LEFT JOIN role_permissions rp ON rp.role_id=r.id
         LEFT JOIN permissions p ON p.id=rp.permission_id
        WHERE u.deleted_at IS NULL
          AND u.status='active'
          AND LOWER(r.name) IN ('super admin','superadmin','administrator')
        GROUP BY u.id, u.email, r.name`,
      [permissionCodes]
    );

    if (!admins.length) {
      fail('Super Admin Batch 2 access', 'No active Super Admin user found');
    } else {
      for (const admin of admins) {
        if (Number(admin.batch2PermissionCount) === permissionCodes.length) {
          pass(
            `Super Admin Batch 2 permissions: ${admin.email}`,
            `${admin.batch2PermissionCount}/${permissionCodes.length}`
          );
        } else {
          fail(
            `Super Admin Batch 2 permissions: ${admin.email}`,
            `${admin.batch2PermissionCount}/${permissionCodes.length}`
          );
        }
      }
    }

    try {
      require.resolve('qrcode');
      pass('QR dependency', 'qrcode package installed');
    } catch {
      fail('QR dependency', 'Run npm install to install qrcode');
    }

    const [modules] = await pool.query(
      `SELECT module, provider, model, is_active AS isActive
         FROM ai_module_contexts
        WHERE module='signature_precheck'
        LIMIT 1`
    );
    if (modules[0]?.isActive) {
      pass(
        'AI signature_precheck module',
        `${modules[0].provider || 'provider?'} / ${modules[0].model || 'model?'}`
      );
    } else {
      warn(
        'AI signature_precheck module',
        'No active signature_precheck AI module. Configure before runtime precheck testing.'
      );
    }

    const driveReady =
      Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) &&
      Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) &&
      Boolean(process.env.GOOGLE_SHARED_DRIVE_ID);

    if (driveReady) {
      pass('Google Drive signing configuration', 'Required Drive env variables present');
    } else {
      warn(
        'Google Drive signing configuration',
        'Deferred: signing/upload runtime needs Google service account + Shared Drive config'
      );
    }

    if (process.env.PUBLIC_WEB_URL) {
      pass('PUBLIC_WEB_URL', process.env.PUBLIC_WEB_URL);
    } else {
      warn(
        'PUBLIC_WEB_URL',
        'Set PUBLIC_WEB_URL before production QR verification links are generated'
      );
    }

    console.log('\nBatch 2 Readiness Check\n');
    for (const check of checks) {
      console.log(
        `[${check.status}] ${check.label}${check.detail ? ` — ${check.detail}` : ''}`
      );
    }

    console.log('');
    if (failed) {
      console.error('RESULT: NOT READY');
      process.exitCode = 1;
    } else {
      console.log('RESULT: READY (WARN items may still block optional runtime paths)');
    }
  } catch (error) {
    console.error('[FAIL] Batch 2 readiness checker crashed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
