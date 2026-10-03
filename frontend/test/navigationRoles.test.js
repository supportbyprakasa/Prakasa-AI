import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildNavSections, divisions, hasRouteAccess, moduleGroupsFor, pageTrail, visibleSections } from '../src/components/navigation.js';

const require = createRequire(import.meta.url);
const { STANDARD_ROLES } = require('../../backend/src/config/standardOrganization.js');
const role = (key) => STANDARD_ROLES.find((entry) => entry.key === key);
const sectionsFor = (key) => buildNavSections(role(key).permissions);
const itemsFor = (key, slug) => visibleSections(divisions.find((entry) => entry.slug === slug), sectionsFor(key)).flatMap((section) => section.items);
const slugsFor = (key) => divisions.filter((entry) => itemsFor(key, entry.slug).length > 0).map((entry) => entry.slug);

test('no standard division role sees Administrasi', () => {
  for (const entry of STANDARD_ROLES) {
    assert.equal(slugsFor(entry.key).includes('admin'), false, entry.key);
  }
});

test('each division sees its own modules, and only its own', () => {
  const expected = {
    'warehouse.member': ['ai', 'warehouse', 'google', 'kerja'],
    'finance.member': ['ai', 'finance', 'google', 'kerja'],
    'sales.member': ['ai', 'sales', 'google', 'kerja'],
    'people_culture.member': ['ai', 'people', 'google', 'kerja'],
    // Pengajuan pembayaran sits in Kerja Harian for every division; the Finance card is Piutang & Utang.
    'procurement.member': ['ai', 'warehouse', 'procurement', 'google', 'kerja'],
    'retail_commerce.member': ['ai', 'sales', 'warehouse', 'retail-commerce', 'google', 'kerja'],
    'marketing.member': ['ai', 'sales', 'marketing', 'google', 'kerja', 'insight'],
    // Management Office has no module of its own: its work IS the cross-division
    // oversight toolkit in Insight & Manajemen (a Member reaches it via Analytics).
    'management_office.member': ['ai', 'google', 'kerja', 'insight'],
  };
  for (const [key, list] of Object.entries(expected)) assert.deepEqual(slugsFor(key), list, key);
});

// Insight & Manajemen is Management Office's toolkit, plus the four shared entries a
// division Head reaches for their OWN division through management_dashboard.division:
// the Management Dashboard, Pusat Eskalasi, Peta Program and Target & realisasi, which
// read the same scope from the same permissions. Members and Supervisors still see nothing here.
test('oversight belongs to Management Office, plus the division dashboard for Heads', () => {
  const paths = (key) => itemsFor(key, 'insight').map((item) => item.to);
  assert.equal(slugsFor('warehouse.member').includes('insight'), false);
  // Supervisors get only their division dashboard (migration 116).
  assert.deepEqual(paths('warehouse.supervisor'), ['/division-dashboard']);
  assert.deepEqual(paths('warehouse.head'), ['/management', '/division-dashboard', '/escalations', '/roadmap', '/targets'], 'a Head gets the dashboard, scoped by the API');
  assert.deepEqual(paths('management_office.member'), ['/analytics']);
  // Alur & Margin (program 3.3) is management only: never a division Head's.
  assert.deepEqual(paths('management_office.supervisor'), ['/management', '/division-dashboard', '/escalations', '/roadmap', '/targets', '/management/flow', '/analytics']);
  assert.deepEqual(paths('management_office.head'), ['/management', '/division-dashboard', '/escalations', '/roadmap', '/targets', '/management/flow', '/analytics', '/activity-logs']);
});

test('a division only shows the modules a role can use', () => {
  assert.deepEqual(itemsFor('warehouse.member', 'warehouse').map((item) => item.to), ['/warehouse']);
  // Marketing reads customers, and leads are customers-to-be: both, nothing that needs order or sync access.
  assert.deepEqual(itemsFor('marketing.member', 'sales').map((item) => item.label), ['Pelanggan', 'Leads']);
  // Kerja Harian only carries cross-division utilities now (Calendar, Division
  // Storage, IT tickets, Gmail/Chat shortcuts) — no role-level split left there.
  assert.deepEqual(
    itemsFor('warehouse.member', 'kerja').map((item) => item.label).sort(),
    itemsFor('warehouse.supervisor', 'kerja').map((item) => item.label).sort(),
  );
});

test('breadcrumbs point a multi-module division crumb back to home, and skip it for a single module', () => {
  const sections = sectionsFor('warehouse.member');
  assert.deepEqual(pageTrail('/warehouse', sections).map((step) => step.label), ['Warehouse']);
  const kerjaTrail = pageTrail('/it/tickets', sections);
  assert.deepEqual(kerjaTrail.map((step) => step.label), ['Kerja Harian', 'Tiket IT']);
  assert.equal(kerjaTrail[0].to, '/');
});

test('Super Admin with every permission still sees Administrasi', () => {
  const all = [...new Set(STANDARD_ROLES.flatMap((entry) => entry.permissions)), 'user.manage', 'role.manage', 'approval_matrix.view'];
  const adminItems = visibleSections(divisions.find((entry) => entry.slug === 'admin'), buildNavSections(all)).flatMap((section) => section.items);
  assert.ok(adminItems.length > 0);
});

// The Management Office landing page was removed: it only repeated the sidebar
// and the Management Dashboard's own figures. Each tool now appears exactly once.
test('Insight & Manajemen lists each oversight tool exactly once, with no hub page', () => {
  const insightItems = itemsFor('management_office.head', 'insight');
  const paths = insightItems.map((item) => item.to);
  assert.equal(new Set(paths).size, paths.length, 'no tool listed twice');
  assert.equal(paths.includes('/management-office'), false);
  const groups = moduleGroupsFor('insight', insightItems);
  assert.equal(groups.some((group) => group.title === 'Modul divisi'), false);
  assert.deepEqual(groups.flatMap((group) => group.items.map((item) => item.to)).sort(), [...paths].sort());
});

test('moduleGroupsFor splits a busy division into its named sub-groups', () => {
  const groups = moduleGroupsFor('google', itemsFor('warehouse.member', 'google'));
  assert.deepEqual(groups.map((group) => group.title), ['Komunikasi', 'Project', 'Dokumen', 'Organisasi']);
});

test('moduleGroupsFor drops a sub-group left empty for this role', () => {
  // A sub-group only shows when this role can reach at least one of its paths.
  const memberItems = itemsFor('people_culture.member', 'people');
  assert.deepEqual(moduleGroupsFor('people', memberItems).map((group) => group.title), ['Onboarding & offboarding', 'GA', 'IT']);
  // Without Operasional GA the GA sub-group is gone.
  const withoutGa = memberItems.filter((item) => item.to !== '/ga/operations');
  assert.deepEqual(moduleGroupsFor('people', withoutGa).map((group) => group.title), ['Onboarding & offboarding', 'IT']);
});

test('moduleGroupsFor defaults an ungrouped division to a single untitled group', () => {
  const items = itemsFor('warehouse.member', 'warehouse');
  assert.deepEqual(moduleGroupsFor('warehouse', items), [{ title: null, items }]);
});

test('a feature hidden from the menu also refuses direct URL access', () => {
  const memberPermissions = role('warehouse.member').permissions;
  // Warehouse members never have Administrasi in their menu; the route must
  // refuse them too, not just hide the card.
  assert.equal(hasRouteAccess('/admin/users', memberPermissions), false);
  assert.equal(hasRouteAccess('/admin/users', role('management_office.head').permissions.concat(['user.manage'])), true);
  // Detail/dynamic routes inherit their base feature's permission.
  assert.equal(hasRouteAccess('/tasks/42', memberPermissions), true);
  assert.equal(hasRouteAccess('/admin/entities/9', memberPermissions), false);
});

test('a route without a NAV entry of its own inherits its parent feature permission', () => {
  const withHrga = role('people_culture.member').permissions;
  const withoutHrga = role('warehouse.member').permissions;
  assert.equal(hasRouteAccess('/hrga/workflows/12', withHrga), true);
  // Onboarding/offboarding detail is open to every signed-in user (a manager
  // opens their checklist task there); the server answers 404 to the rest.
  assert.equal(hasRouteAccess('/hrga/workflows/12', withoutHrga), true);
  assert.equal(hasRouteAccess('/hrga/onboarding', withoutHrga), false);
  assert.equal(hasRouteAccess('/signatures/12', withoutHrga.filter((p) => p !== 'signature.view')), false);
});

test('a route with no matching NAV entry is not blocked (nothing to guard against)', () => {
  assert.equal(hasRouteAccess('/', []), true);
  assert.equal(hasRouteAccess('/some/unmapped/path', []), true);
});

test('a form below a module is named for what it does, a record for its detail', async () => {
  const { pageTrail, buildNavSections } = await import('../src/components/navigation.js');
  const sections = buildNavSections(['sales.order.view', 'sales.customer.view', 'sales.pipeline.view']);
  assert.equal(pageTrail('/sales/orders/new', sections).at(-1).label, 'Baru');
  assert.equal(pageTrail('/sales/orders/12/edit', sections).at(-1).label, 'Ubah');
  assert.equal(pageTrail('/sales/orders/12', sections).at(-1).label, 'Detail');
});
