import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { activeNavItem, buildNavSections, divisions, navGroups, pageTrail } from '../src/components/navigation.js';

// The side menu, breadcrumb and icons (docs/ui-guideline.md §1.11, §2.2, §2.3).
const require = createRequire(import.meta.url);
const { STANDARD_ROLES } = require('../../backend/src/config/standardOrganization.js');
const ALL = [...new Set([...STANDARD_ROLES.flatMap((role) => role.permissions), 'user.manage', 'role.manage', 'entity.manage', 'permission.manage', 'department.manage', 'integration.accurate.manage', 'ai.provider.manage', 'ai_command.usage.view', 'integration_log.view', 'approval_matrix.view', 'signature_rule.view', 'signature_precheck.view', 'document_type.manage', 'folder_rule.manage'])];
const sections = buildNavSections(ALL);

test('every menu entry and division names a Material Symbols icon', () => {
  const items = sections.flatMap((section) => section.items);
  assert.ok(items.length > 20);
  for (const item of items) assert.match(item.symbol || '', /^[a-z0-9_]+$/, `${item.to} has no symbol`);
  for (const division of divisions) assert.match(division.symbol || '', /^[a-z0-9_]+$/, `${division.slug} has no symbol`);
});

test('divisions carry no hard-coded colours any more', () => {
  for (const division of divisions) assert.equal(division.accent, undefined, division.slug);
});

const listedPaths = (groups) => groups.flatMap((entry) => (entry.type === 'group' ? entry.items : [entry.item])).map((item) => item.to);

test('sections with several modules become groups; single modules stay plain items', () => {
  const groups = navGroups(sections);
  const byKey = Object.fromEntries(groups.map((entry) => [entry.key, entry]));
  assert.equal(byKey['/'].type, 'item');
  assert.equal(byKey['/ai-command'].type, 'item');
  assert.equal(byKey.Divisi.type, 'group');
  assert.deepEqual(byKey.Divisi.items.slice(0, 2).map((item) => item.to), ['/warehouse', '/procurement']);
  assert.equal(byKey.Komunikasi.type, 'group');
  // Work-based groups: Project Tracker is daily work, not "Google"; IT is not People & Culture.
  assert.ok(byKey['Kerja harian'].items.some((item) => item.to === '/projects'));
  assert.ok(byKey.IT.items.every((item) => item.to.startsWith('/it/')));
  // Admin is three short groups, not one list of fifteen.
  for (const title of ['Pengguna & akses', 'Aturan & dokumen', 'Sistem & integrasi']) assert.equal(byKey[title].type, 'group', title);
  // Global search lives in the top bar only.
  assert.equal(listedPaths(groups).includes('/search'), false);
  // Every visible module appears exactly once.
  const listed = groups.flatMap((entry) => (entry.type === 'group' ? entry.items : [entry.item])).map((item) => item.to);
  assert.deepEqual(listed, sections.flatMap((section) => section.items).map((item) => item.to));
});

test('a role with one module in a section sees it as a plain item', () => {
  const few = buildNavSections(['it_ticket.view']);
  // Dashboard, IT tickets and Panduan (every signed-in user has the handbook).
  assert.deepEqual(navGroups(few).map((entry) => entry.type), ['item', 'item', 'item']);
});

test('the active entry is the longest matching path, and "/" only matches itself', () => {
  assert.equal(activeNavItem('/', sections).to, '/');
  assert.equal(activeNavItem('/management/flow', sections).to, '/management/flow');
  assert.equal(activeNavItem('/management', sections).to, '/management');
  assert.equal(activeNavItem('/sales/orders/12/edit', sections).to, '/sales/orders');
  assert.equal(activeNavItem('/hrga/workflows/3', sections), null);
});

test('pages without a menu entry get a named crumb instead of "Halaman"', () => {
  const labels = (path) => pageTrail(path, sections).map((step) => step.label);
  assert.deepEqual(labels('/signatures/12'), ['Permintaan tanda tangan', 'Detail']);
  assert.deepEqual(labels('/signatures/asset'), ['Tanda tangan saya']);
  assert.deepEqual(labels('/tasks/9'), ['Papan tugas', 'Detail']);
  assert.deepEqual(labels('/data-accurate/4'), ['Data Accurate', 'Detail']);
  const workflow = pageTrail('/hrga/workflows/7', sections);
  assert.deepEqual(workflow.map((step) => step.label), ['People & Culture', 'Alur karyawan', 'Detail']);
  // "Alur karyawan" has no list page of its own: a label, not a link.
  assert.equal(workflow[1].to, null);
  assert.deepEqual(labels('/unknown/page'), ['Halaman']);
});

test('a menu page wins over an extra page with the same path', () => {
  const trail = pageTrail('/notifications', sections);
  assert.deepEqual(trail, [{ label: 'Notifikasi', to: '/notifications' }]);
  assert.deepEqual(pageTrail('/notifications', []), [{ label: 'Notifikasi', to: '/notifications' }]);
});
