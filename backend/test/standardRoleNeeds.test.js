const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STANDARD_ROLES, COMMON_PERMISSION_SETS } = require('../src/config/standardOrganization');

const has = (role, code) => role.permissions.includes(code);
const division = (role) => role.departmentCode;
const COMMON_CODES = new Set([
  ...COMMON_PERMISSION_SETS.member,
  ...COMMON_PERMISSION_SETS.supervisor,
  ...COMMON_PERMISSION_SETS.head,
]);

test('governance pages belong to system administration, not to a division role', () => {
  for (const role of STANDARD_ROLES) {
    assert.equal(has(role, 'approval_matrix.view'), false, `${role.key} approval matrix is system administration`);
  }
});

// Modules retired from the app (Forms, Knowledge Base, Automation, Workflow
// Builder, Decision Log, Data Classification, Timeline, AI Brief, Workspaces).
// Their pages, routes and tables are gone, so no role may still ask for them.
const RETIRED_PERMISSIONS = [
  'form.view', 'form.submit', 'form.manage', 'form_submission.view',
  'form_submission.manage', 'form_submission.transition',
  'workflow_definition.view', 'workflow_definition.manage',
  'workflow_instance.view', 'workflow_instance.transition',
  'kb.view', 'kb.query', 'kb.manage',
  'automation.view', 'automation.manage',
  'decision_log.view', 'decision_log.manage',
  'data_classification.view', 'data_classification.manage',
  'timeline.view', 'brief.view',
  'workspace.customer.view', 'workspace.cross_division.view',
  // Sales is Customers, Leads, the automatic pipeline and Data Sales only; the
  // hand-typed deal pipeline, quotations, visit forms, Field Sales Bot and the
  // whole sample flow (Sales requests, Warehouse queue and delivery proof) went.
  'sales.inquiry.view', 'sales.inquiry.manage', 'sales.pipeline.manage',
  'sales.visit.view', 'sales.visit.create', 'sales.quotation.view', 'sales.quotation.manage',
  'sales.sample.view', 'sales.sample.request', 'sales.sample.approve', 'sales.field_bot.use',
  'warehouse.sample.view', 'warehouse.sample.manage', 'warehouse.delivery_proof.upload',
  // Sales no longer syncs from the Sales Data Tracker (migration 056).
  'sales.sync.manage',
];

test('no standard role grants a permission whose feature was removed', () => {
  for (const role of STANDARD_ROLES) {
    for (const code of RETIRED_PERMISSIONS) {
      assert.equal(has(role, code), false, `${role.key} still grants ${code}`);
    }
  }
});

test('IT tools are visible only to People & Culture oversight (IT lives there)', () => {
  const allowed = new Set(['people_culture.supervisor', 'people_culture.head']);
  for (const role of STANDARD_ROLES) {
    assert.equal(has(role, 'device.manage'), allowed.has(role.key), role.key);
  }
});

test('Operations is not a division: GA runs office operations (owner, 1 Oct 2026)', () => {
  const { DIVISIONS, RETIRED_DIVISIONS } = require('../src/config/standardOrganization');
  assert.equal(DIVISIONS.some((d) => d.code === 'operations'), false);
  assert.equal(STANDARD_ROLES.some((role) => division(role) === 'operations'), false);
  assert.match(RETIRED_DIVISIONS.operations, /GA/);
  // People & Culture processes GA requests from Member up.
  for (const level of ['member', 'supervisor', 'head']) {
    assert.equal(has(STANDARD_ROLES.find((r) => r.key === `people_culture.${level}`), 'ga.request.process'), true, level);
  }
});

test('divisions only keep the Warehouse and sales tools their work needs', () => {
  for (const role of STANDARD_ROLES) {
    if (['procurement', 'retail_commerce'].includes(division(role))) {
      assert.equal(has(role, 'warehouse.movement.view'), true, `${role.key} movement history`);
    }
    if (division(role) === 'marketing') assert.equal(has(role, 'sales.order.view'), false, `${role.key} sales figures`);
  }
});

test('migrations 053 and 056 revoke every retired Sales and sample permission from existing databases', () => {
  const sql = ['053_sales_scope_four_modules.sql', '056_sales_managed_in_app.sql']
    .map((f) => fs.readFileSync(path.join(__dirname, '../migrations', f), 'utf8')).join('\n');
  for (const code of RETIRED_PERMISSIONS.filter((c) => /^(sales|warehouse)\./.test(c))) {
    assert.ok(sql.includes(`'${code}'`), code);
  }
});

test('migration 035 applies every removal and addition to existing databases', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/035_refine_standard_role_menus.sql'), 'utf8');
  for (const code of ['data_classification.view', 'workspace.customer.view', 'automation.view', 'approval_matrix.view', 'warehouse.sample.view', 'sales.quotation.view']) {
    assert.match(sql, new RegExp(code.replace('.', '\\.')), code);
  }
  assert.match(sql, /is_system_template = 1/);
  assert.equal(/system\.super_admin'\s*\)/.test(sql) && /DELETE[^;]*system\.super_admin/.test(sql), false, 'Super Admin is never trimmed');
});

test('migration 144 deletes every permission code no code checks any more', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/144_remove_dead_permissions.sql'), 'utf8');
  for (const code of ['form.submit', 'kb.query', 'workflow_instance.view', 'timeline.view', 'brief.view', 'dashboard_layout.manage', 'workspace.operations.view']) {
    assert.match(sql, new RegExp(code.replace(/\./g, '\\.')), code);
  }
  assert.doesNotMatch(sql, /DELETE[^;]*system\.super_admin/, 'Super Admin is never trimmed');
});
