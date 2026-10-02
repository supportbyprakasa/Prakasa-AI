import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { roleInfo } from '../src/pages/admin/roleInfoModel.js';

// The ⓘ beside each role in Pengguna → Organisasi dan role.
const require = createRequire(import.meta.url);
const { STANDARD_ROLES } = require('../../backend/src/config/standardOrganization.js');

test('every standard and global role has its own explanation', () => {
  for (const role of [...STANDARD_ROLES.map((r) => ({ roleKey: r.key, name: r.name })), { roleKey: 'system.super_admin', name: 'Super Admin' }, { roleKey: 'system.admin', name: 'Administrator Sistem' }]) {
    const info = roleInfo(role);
    assert.equal(info.title, role.name);
    assert.ok(info.lines.length >= 1, role.roleKey);
    assert.doesNotMatch(info.lines.join(' '), /Peran khusus|undefined/, role.roleKey);
  }
});

test('the two global roles say who sees data', () => {
  assert.match(roleInfo({ roleKey: 'system.super_admin' }).lines[0], /semua data/);
  assert.match(roleInfo({ roleKey: 'system.admin' }).lines[0], /tanpa bisa melihat data divisi/);
});

test('levels build on each other; a custom role points to its permissions', () => {
  const sup = roleInfo({ roleKey: 'warehouse.supervisor', departmentName: 'Warehouse' }).lines;
  assert.match(sup[0], /pergerakan barang/);
  assert.match(sup[1], /^Pekerjaan Warehouse:/);
  assert.match(roleInfo({ roleKey: 'sales.head' }).lines[0], /dibatasi ke divisinya/);
  assert.match(roleInfo({ name: 'Tim khusus' }).lines[0], /Peran khusus/);
});

test('the ⓘ sits beside the checkbox, never inside its label', () => {
  const jsx = readFileSync(new URL('../src/pages/admin/UserEditorPanel.jsx', import.meta.url), 'utf8');
  assert.match(jsx, /<\/Checkbox>|\/>\s*<InfoTip label=\{`Penjelasan peran/);
  const tip = readFileSync(new URL('../src/components/InfoTip.jsx', import.meta.url), 'utf8');
  assert.match(tip, /onMouseEnter=\{show\}/);
  assert.match(tip, /setPinned\(\(value\) => !value\)/, 'a click pins it');
  assert.match(tip, /role="tooltip"/);
});

test('Administrator Sistem with a division role warns that the division data is visible', async () => {
  const { roleMixWarning } = await import('../src/pages/admin/roleInfoModel.js');
  const admin = { roleKey: 'system.admin', departmentId: null, name: 'Administrator Sistem' };
  const pc = { roleKey: 'people_culture.supervisor', departmentId: 7, name: 'People & Culture Supervisor' };
  assert.match(roleMixWarning([admin, pc]), /People & Culture Supervisor: pengguna ini tetap bisa melihat data divisi/);
  assert.equal(roleMixWarning([admin]), '');
  assert.equal(roleMixWarning([pc]), '');
});
