import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildNavSections, focusDivisions, navGroups } from '../src/components/navigation.js';

// The side menu in priority order per role (docs/ui-guideline.md §2.2): the
// everyday entries, then the role's own division work, oversight for Heads,
// daily tools, and administration last.
const require = createRequire(import.meta.url);
const { STANDARD_ROLES } = require('../../backend/src/config/standardOrganization.js');
const menu = (...keys) => {
  const permissions = [...new Set(keys.flatMap((key) => STANDARD_ROLES.find((r) => r.key === key).permissions))];
  return navGroups(buildNavSections(permissions, keys.map((roleKey) => ({ roleKey }))));
};
const names = (groups) => groups.map((entry) => (entry.type === 'group' ? entry.title : entry.item.label));
const TOP = ['Dashboard', 'Notifikasi', 'Prakasa AI'];

test('each division sees its own work right under the everyday entries', () => {
  assert.deepEqual(names(menu('sales.member')).slice(0, 4), [...TOP, 'Sales']);
  assert.deepEqual(names(menu('warehouse.member')).slice(0, 4), [...TOP, 'Warehouse']);
  assert.deepEqual(names(menu('procurement.member')).slice(0, 4), [...TOP, 'Procurement']);
  assert.deepEqual(names(menu('people_culture.supervisor')).slice(0, 5), [...TOP, 'People & Culture', 'IT']);
  assert.deepEqual(names(menu('management_office.head')).slice(0, 5), [...TOP, 'Manajemen', 'Laporan']);
  // Finance: Piutang, Utang and Pengajuan pembayaran lead (owner, 1 Oct 2026).
  assert.deepEqual(names(menu('finance.member')).slice(0, 4), [...TOP, 'Finance']);
});

test('a Head gets oversight right after their division; a member never sees it', () => {
  assert.deepEqual(names(menu('warehouse.head')).slice(0, 6), [...TOP, 'Warehouse', 'Manajemen', 'Kerja harian']);
  assert.equal(names(menu('warehouse.member')).includes('Manajemen'), false);
});

test('People & Culture works GA requests and the IT queue from its own groups', () => {
  const groups = menu('people_culture.supervisor');
  const byTitle = Object.fromEntries(groups.filter((g) => g.type === 'group').map((g) => [g.title, g.items.map((i) => i.to)]));
  // The division dashboard leads its own group (Supervisor/Head).
  assert.deepEqual(byTitle['People & Culture'].slice(0, 4), ['/division-dashboard', '/hrga/onboarding', '/hrga/offboarding', '/ga']);
  assert.equal(byTitle.IT[0], '/it/tickets');
  assert.equal(byTitle['Kerja harian'].includes('/ga'), false, 'each entry appears once');
  assert.equal(groups.find((g) => g.title === 'People & Culture').focus, true, 'starts open');
});

test('every visible module appears exactly once, whatever the roles', () => {
  for (const role of STANDARD_ROLES) {
    const plain = buildNavSections(role.permissions).flatMap((s) => s.items.map((i) => i.to)).sort();
    const ordered = buildNavSections(role.permissions, [{ roleKey: role.key }]).flatMap((s) => s.items.map((i) => i.to));
    assert.deepEqual([...ordered].sort(), plain, role.key);
    assert.equal(new Set(ordered).size, ordered.length, role.key);
  }
});

test('several roles: the most senior division leads; the super admin keeps the plain order', () => {
  assert.deepEqual(focusDivisions([{ roleKey: 'sales.member' }, { roleKey: 'warehouse.head' }]), ['warehouse', 'sales']);
  assert.deepEqual(focusDivisions([{ roleKey: 'system.super_admin' }]), []);
  const all = [...new Set(STANDARD_ROLES.flatMap((r) => r.permissions))];
  const admin = names(navGroups(buildNavSections(all, [{ roleKey: 'system.super_admin' }])));
  assert.deepEqual(admin.slice(0, 5), [...TOP, 'Manajemen', 'Kerja harian']);
});

test('Administrator Sistem: no division, administration first, no division data in the menu', async () => {
  const { SYSTEM_ADMIN_PERMISSIONS } = require('../../backend/src/config/standardOrganization.js');
  const { hasUsableAccess } = await import('../src/pages/login/loginModel.js');
  const roles = [{ roleKey: 'system.admin', departmentId: null }];
  assert.equal(hasUsableAccess({ departmentId: null, roles }), true, 'works without a division');
  const groups = navGroups(buildNavSections(SYSTEM_ADMIN_PERMISSIONS, roles));
  assert.deepEqual(names(groups).slice(0, 4), ['Dashboard', 'Notifikasi', 'Pengguna & akses', 'Aturan & dokumen']);
  const paths = groups.flatMap((g) => (g.type === 'group' ? g.items : [g.item])).map((i) => i.to);
  for (const path of paths) {
    assert.doesNotMatch(path, /^\/(sales|warehouse|procurement|hrga|ga|management|escalations|targets|roadmap|activity-logs|analytics|division-storage|it\/(devices|dashboard|infrastructure|subscriptions))/, path);
  }
});

test('every division Supervisor/Head finds the division dashboard first in their own group; members do not have it', () => {
  for (const key of ['sales', 'warehouse', 'procurement', 'people_culture', 'retail_commerce', 'marketing', 'finance']) {
    for (const level of ['supervisor', 'head']) {
      const first = menu(`${key}.${level}`).find((g) => (g.type === 'group' ? g.focus : g.item.to === '/division-dashboard'));
      const to = first.type === 'group' ? first.items[0].to : first.item.to;
      assert.equal(to, '/division-dashboard', `${key}.${level}`);
    }
    const all = menu(`${key}.member`).flatMap((g) => (g.type === 'group' ? g.items : [g.item])).map((i) => i.to);
    assert.equal(all.includes('/division-dashboard'), false, `${key}.member`);
  }
});
