#!/usr/bin/env node
require('dotenv').config();
const pool = require('../db/pool');

const TABLES = [
  'ai_sessions',
  'ai_messages',
  'ai_context_links',
  'ai_action_proposals',
  'ai_usage_events',
];

const PERMISSIONS = [
  'ai_command.use',
  'ai_command.session.view',
  'ai_command.session.manage',
  'ai_command.context.attach',
  'ai_command.action.propose',
  'ai_command.action.confirm',
  'ai_command.usage.view',
  'ai_command.admin.view',
  'ai_command.department.view',
  'ai_command.entity.view',
  'ai_command.private_audit',
];

const COLUMNS = {
  ai_sessions: [
    'entity_id',
    'department_id',
    'owner_user_id',
    'visibility',
    'status',
    'ai_module',
    'generation_status',
    'generation_started_at',
    'generation_token',
    'last_message_at',
    'archived_at',
    'deleted_at',
  ],
  ai_messages: [
    'session_id',
    'entity_id',
    'department_id',
    'role',
    'content',
    'provider',
    'model',
    'tokens_in',
    'tokens_out',
    'reply_to_message_id',
    'created_by',
  ],
  ai_context_links: [
    'session_id',
    'entity_id',
    'context_type',
    'context_id',
    'relation',
    'added_by',
  ],
  ai_action_proposals: [
    'session_id',
    'message_id',
    'entity_id',
    'department_id',
    'action_type',
    'payload_json',
    'status',
    'confirmed_by',
    'executed_by',
    'execution_result_json',
  ],
  ai_usage_events: [
    'session_id',
    'message_id',
    'entity_id',
    'department_id',
    'user_id',
    'module',
    'provider',
    'model',
    'event_type',
    'metadata_json',
  ],
};

let failures = 0;
let warnings = 0;

function pass(label, detail = '') {
  console.log(`[PASS] ${label}${detail ? ` — ${detail}` : ''}`);
}
function warn(label, detail = '') {
  warnings += 1;
  console.log(`[WARN] ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label, detail = '') {
  failures += 1;
  console.log(`[FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
}

(async () => {
  console.log('\nBatch 3 Readiness Check\n');

  const missingTables = [];
  for (const table of TABLES) {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS c
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
      [table]
    );
    if (!Number(row.c)) missingTables.push(table);
  }
  if (missingTables.length) {
    fail('Batch 3 tables', `Missing: ${missingTables.join(', ')}`);
  } else {
    pass('Batch 3 tables', `${TABLES.length}/${TABLES.length} present`);
  }

  for (const [table, expected] of Object.entries(COLUMNS)) {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME AS columnName
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
      [table]
    );
    const present = new Set(rows.map((row) => row.columnName));
    const missing = expected.filter((column) => !present.has(column));
    if (missing.length) {
      fail(`${table} columns`, `Missing: ${missing.join(', ')}`);
    } else {
      pass(`${table} columns`, `${expected.length}/${expected.length} critical columns present`);
    }
  }

  const [[providerColumn]] = await pool.query(
    `SELECT COLUMN_TYPE AS columnType
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME='ai_module_contexts'
        AND COLUMN_NAME='provider'
      LIMIT 1`
  );
  if (providerColumn?.columnType?.includes("'n8n'")) {
    pass('AI provider enum', 'n8n enabled');
  } else {
    fail('AI provider enum', 'n8n missing from ai_module_contexts.provider');
  }

  const [[taskSource]] = await pool.query(
    `SELECT DATA_TYPE AS dataType
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME='tasks'
        AND COLUMN_NAME='source_id'
      LIMIT 1`
  );
  if (taskSource?.dataType === 'bigint') {
    pass('tasks.source_id', 'BIGINT ready for chat/AI source ids');
  } else {
    fail('tasks.source_id', `Expected BIGINT, got ${taskSource?.dataType || 'missing'}`);
  }

  const [permissionRows] = await pool.query(
    'SELECT code FROM permissions WHERE code IN (?)',
    [PERMISSIONS]
  );
  const permissionSet = new Set(permissionRows.map((row) => row.code));
  const missingPermissions = PERMISSIONS.filter((code) => !permissionSet.has(code));
  if (missingPermissions.length) {
    fail('Batch 3 permissions', `Missing: ${missingPermissions.join(', ')}`);
  } else {
    pass('Batch 3 permissions', `${PERMISSIONS.length}/${PERMISSIONS.length} present`);
  }

  const [admins] = await pool.query(
    `SELECT u.id, u.email, r.name AS roleName,
            COUNT(DISTINCT CASE WHEN p.code IN (?) THEN p.code END) AS granted
       FROM users u
       JOIN user_roles ur ON ur.user_id=u.id
       JOIN roles r ON r.id=ur.role_id AND r.deleted_at IS NULL
       LEFT JOIN role_permissions rp ON rp.role_id=r.id
       LEFT JOIN permissions p ON p.id=rp.permission_id
      WHERE u.status='active'
        AND u.deleted_at IS NULL
        AND LOWER(r.name) IN ('super admin','superadmin','administrator')
      GROUP BY u.id, u.email, r.name`,
    [PERMISSIONS]
  );

  if (!admins.length) {
    fail('Super Admin Batch 3 access', 'No active Super Admin user found');
  } else {
    for (const admin of admins) {
      if (Number(admin.granted) === PERMISSIONS.length) {
        pass(
          `Super Admin Batch 3 permissions: ${admin.email}`,
          `${admin.granted}/${PERMISSIONS.length}`
        );
      } else {
        fail(
          `Super Admin Batch 3 permissions: ${admin.email}`,
          `${admin.granted}/${PERMISSIONS.length}`
        );
      }
    }
  }

  const [modules] = await pool.query(
    `SELECT module, provider, model, is_active AS isActive
       FROM ai_module_contexts
      WHERE module='ai_command_center'
      LIMIT 1`
  );
  if (modules[0]?.isActive) {
    pass(
      'AI Command Center module',
      `${modules[0].provider} / ${modules[0].model}`
    );
  } else {
    fail('AI Command Center module', 'active module seed missing');
  }

  for (const table of ['chat_rooms', 'chat_room_members', 'chat_messages']) {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS c
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,
      [table]
    );
    if (Number(row.c)) pass(`Chat prerequisite: ${table}`);
    else fail(`Chat prerequisite: ${table}`, 'missing');
  }

  if (process.env.N8N_AI_GATEWAY_URL) {
    pass('N8N_AI_GATEWAY_URL', 'configured');
    if (!process.env.N8N_AI_GATEWAY_SECRET) {
      warn('N8N_AI_GATEWAY_SECRET', 'empty; only okay if gateway intentionally allows it');
    }
  } else {
    warn('N8N AI gateway', 'not configured; existing OpenAI/Gemini/Claude providers remain available');
  }

  console.log('');
  if (failures) {
    console.log(`RESULT: NOT READY (${failures} failures, ${warnings} warnings)`);
    process.exitCode = 1;
  } else {
    console.log(`RESULT: READY (${warnings} warnings)`);
  }
})()
  .catch((error) => {
    console.error('[FAIL] Batch 3 readiness checker crashed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
