const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STANDARD_ROLES } = require('../src/config/standardOrganization');

const has = (role, code) => role.permissions.includes(code);
const division = (role) => role.departmentCode;

test('governance pages belong to Heads, not every member', () => {
  for (const role of STANDARD_ROLES) {
    assert.equal(has(role, 'data_classification.view'), role.level === 'head', `${role.key} data classification`);
    assert.equal(has(role, 'approval_matrix.view'), false, `${role.key} approval matrix is system administration`);
  }
});

test('customer workspaces are only for customer-facing divisions', () => {
  const customerFacing = new Set(['sales', 'retail_commerce', 'marketing']);
  for (const role of STANDARD_ROLES) {
    assert.equal(has(role, 'workspace.customer.view'), customerFacing.has(division(role)), role.key);
  }
});

test('automation is visible only to Operations oversight', () => {
  const allowed = new Set(['operations.supervisor', 'operations.head']);
  for (const role of STANDARD_ROLES) {
    assert.equal(has(role, 'automation.view'), allowed.has(role.key), role.key);
  }
});

test('divisions only keep the Warehouse and sales tools their work needs', () => {
  for (const role of STANDARD_ROLES) {
    if (['procurement', 'retail_commerce'].includes(division(role))) {
      assert.equal(has(role, 'warehouse.sample.view'), false, `${role.key} sample queue`);
      assert.equal(has(role, 'warehouse.movement.view'), true, `${role.key} movement history`);
    }
    if (division(role) === 'marketing') assert.equal(has(role, 'sales.quotation.view'), false, role.key);
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
