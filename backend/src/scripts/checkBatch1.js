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

async function tableExists(name) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS c
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?`,
    [name]
  );
  return Number(row.c) > 0;
}

(async () => {
  try {
    const requiredTables = [
      'forms','form_fields','form_submissions','form_submission_values',
      'form_submission_attachments','workflow_definitions','workflow_statuses',
      'workflow_transitions','workflow_instances','workflow_instance_history',
      'document_types','signature_rules','dashboard_widgets',
      'dashboard_role_layouts','integration_logs',
    ];

    const missingTables = [];
    for (const table of requiredTables) {
      if (!(await tableExists(table))) missingTables.push(table);
    }
    if (missingTables.length) {
      fail('Batch 1 tables', `Missing: ${missingTables.join(', ')}`);
    } else {
      pass('Batch 1 tables', `${requiredTables.length} tables available`);
    }

    const [permissions] = await pool.query(
      `SELECT code FROM permissions
        WHERE code IN (
          'entity.cross_access',
          'form.view','form.manage','form.submit',
          'form_submission.view','form_submission.manage','form_submission.transition',
          'workflow_definition.view','workflow_definition.manage',
          'workflow_instance.view','workflow_instance.transition',
          'document_type.view','document_type.manage',
          'signature_rule.view','signature_rule.manage',
          'dashboard_widget.manage','dashboard_layout.manage',
          'integration_log.view'
        )`
    );
    if (permissions.length === 18) pass('Batch 1 permissions', '18/18 present');
    else fail('Batch 1 permissions', `${permissions.length}/18 present`);

    const [adminRows] = await pool.query(
      `SELECT u.id, u.email, r.name AS roleName,
              COUNT(DISTINCT p.id) AS permissionCount,
              SUM(p.code = 'form.manage') AS hasFormManage,
              SUM(p.code = 'workflow_definition.manage') AS hasWorkflowManage,
              SUM(p.code = 'document_type.view') AS hasDocumentType,
              SUM(p.code = 'signature_rule.view') AS hasSignatureRule,
              SUM(p.code = 'dashboard_layout.manage') AS hasDashboardLayout,
              SUM(p.code = 'integration_log.view') AS hasIntegrationLog
         FROM users u
         JOIN user_roles ur ON ur.user_id=u.id
         JOIN roles r ON r.id=ur.role_id AND r.deleted_at IS NULL
         LEFT JOIN role_permissions rp ON rp.role_id=r.id
         LEFT JOIN permissions p ON p.id=rp.permission_id
        WHERE u.deleted_at IS NULL
          AND u.status='active'
          AND LOWER(r.name) IN ('super admin','superadmin','administrator')
        GROUP BY u.id, u.email, r.name`
    );

    if (!adminRows.length) {
      fail('Super Admin role/user', 'No active Super Admin user found');
    } else {
      for (const row of adminRows) {
        const batchReady =
          Number(row.hasFormManage) > 0 &&
          Number(row.hasWorkflowManage) > 0 &&
          Number(row.hasDocumentType) > 0 &&
          Number(row.hasSignatureRule) > 0 &&
          Number(row.hasDashboardLayout) > 0 &&
          Number(row.hasIntegrationLog) > 0;

        if (batchReady) {
          pass(
            `Super Admin permissions: ${row.email}`,
            `role=${row.roleName}, total=${row.permissionCount}`
          );
        } else {
          fail(
            `Super Admin permissions: ${row.email}`,
            JSON.stringify(row)
          );
        }
      }
    }

    const [forms] = await pool.query(
      `SELECT f.id, f.entity_id AS entityId, f.slug, f.is_active AS isActive,
              f.is_public AS isPublic, f.deleted_at AS deletedAt,
              f.workflow_definition_id AS workflowId,
              COUNT(ff.id) AS activeFieldCount
         FROM forms f
         LEFT JOIN form_fields ff
           ON ff.form_id=f.id AND ff.deleted_at IS NULL
        WHERE f.slug='it-access-request'
        GROUP BY f.id, f.entity_id, f.slug, f.is_active, f.is_public,
                 f.deleted_at, f.workflow_definition_id`
    );

    if (!forms.length) {
      fail('Seed form: IT Access Request', 'No it-access-request row found');
    } else {
      for (const form of forms) {
        const ready =
          Number(form.isActive) === 1 &&
          Number(form.isPublic) === 1 &&
          form.deletedAt === null &&
          Number(form.activeFieldCount) >= 4;
        if (ready) {
          pass(
            `IT Access Request entity ${form.entityId}`,
            `fields=${form.activeFieldCount}, workflowId=${form.workflowId || 'none'}`
          );
        } else {
          fail(
            `IT Access Request entity ${form.entityId}`,
            JSON.stringify(form)
          );
        }
      }
    }

    const [workflows] = await pool.query(
      `SELECT wd.id, wd.entity_id AS entityId, wd.is_active AS isActive,
              wd.deleted_at AS deletedAt,
              COUNT(DISTINCT CASE WHEN ws.is_initial=1 THEN ws.id END) AS initialCount,
              COUNT(DISTINCT CASE WHEN ws.is_final=1 THEN ws.id END) AS finalCount,
              COUNT(DISTINCT ws.id) AS statusCount,
              COUNT(DISTINCT wt.id) AS transitionCount
         FROM workflow_definitions wd
         LEFT JOIN workflow_statuses ws ON ws.workflow_definition_id=wd.id
         LEFT JOIN workflow_transitions wt ON wt.workflow_definition_id=wd.id
        WHERE wd.slug='simple-approval'
        GROUP BY wd.id, wd.entity_id, wd.is_active, wd.deleted_at`
    );

    if (!workflows.length) {
      fail('Seed workflow: simple-approval', 'No workflow found');
    } else {
      for (const wf of workflows) {
        const ready =
          Number(wf.isActive) === 1 &&
          wf.deletedAt === null &&
          Number(wf.initialCount) >= 1 &&
          Number(wf.finalCount) >= 1 &&
          Number(wf.statusCount) >= 4 &&
          Number(wf.transitionCount) >= 3;
        if (ready) {
          pass(
            `Simple Approval entity ${wf.entityId}`,
            `statuses=${wf.statusCount}, transitions=${wf.transitionCount}, initial=${wf.initialCount}, final=${wf.finalCount}`
          );
        } else {
          fail(
            `Simple Approval entity ${wf.entityId}`,
            JSON.stringify(wf)
          );
        }
      }
    }

    const driveReady =
      Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) &&
      Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) &&
      Boolean(process.env.GOOGLE_SHARED_DRIVE_ID);

    if (driveReady) {
      pass('Google Drive configuration', 'Required env variables are present');
    } else {
      warn(
        'Google Drive configuration',
        'Upload field will not work until GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, and GOOGLE_SHARED_DRIVE_ID are configured'
      );
    }

    const [[{ integrationLogCount }]] = await pool.query(
      'SELECT COUNT(*) AS integrationLogCount FROM integration_logs'
    );
    pass('Integration Logs table query', `rows=${integrationLogCount}`);

    console.log('\nBatch 1 Readiness Check\n');
    for (const check of checks) {
      console.log(`[${check.status}] ${check.label}${check.detail ? ` — ${check.detail}` : ''}`);
    }

    console.log('');
    if (failed) {
      console.error('RESULT: NOT READY');
      process.exitCode = 1;
    } else {
      console.log('RESULT: READY (Google Drive may still be WARN-only)');
    }
  } catch (error) {
    console.error('[FAIL] Readiness checker crashed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
