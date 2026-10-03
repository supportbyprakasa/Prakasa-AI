import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import HANDBOOK from '../src/pages/handbook/handbookContent.js';
import {
  audienceAllows, buildOutline, contentRoutes, isSystemAdminOnly, levelNote, outlineParts, roleLabel, roleLevel, search, visibleChapters,
} from '../src/pages/handbook/handbookModel.js';
import { buildNavSections, hasRouteAccess } from '../src/components/navigation.js';

const require = createRequire(import.meta.url);
const { STANDARD_ROLES, SYSTEM_ADMIN_PERMISSIONS } = require('../../backend/src/config/standardOrganization.js');

const navSource = readFileSync(new URL('../src/components/navigation.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

// Every permission code anywhere: the standard roles, the admin role and the menu.
const ALL_PERMISSIONS = [...new Set([
  ...STANDARD_ROLES.flatMap((role) => role.permissions),
  ...SYSTEM_ADMIN_PERMISSIONS,
  ...[...navSource.matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)].map((m) => m[1]),
])];

const standardUser = (key) => {
  const role = STANDARD_ROLES.find((entry) => entry.key === key);
  assert.ok(role, key);
  return { name: `Uji ${key}`, permissions: role.permissions, roles: [{ roleKey: role.key, roleLevel: role.level, name: role.name }] };
};
const ADMIN = { name: 'Admin', permissions: SYSTEM_ADMIN_PERMISSIONS, roles: [{ roleKey: 'system.admin', name: 'Administrator Sistem' }] };
const SUPER = { name: 'Owner', permissions: ALL_PERMISSIONS, roles: [{ roleKey: 'system.super_admin', name: 'Super Admin' }] };

const chapterIds = (user) => visibleChapters(user, HANDBOOK).map((chapter) => chapter.id);
const sectionAnchors = (user) => visibleChapters(user, HANDBOOK)
  .flatMap((chapter) => chapter.sections.map((section) => `${chapter.id}-${section.id}`));
const chapter = (id) => HANDBOOK.find((entry) => entry.id === id);

// App.jsx route patterns → RegExps (":id" matches one segment).
const APP_ROUTES = [...appSource.matchAll(/<Route\s+(?:index\s|path="([^"]+)")/g)]
  .map((m) => (m[1] === undefined ? '/' : `/${m[1]}`.replace(/^\/\//, '/')))
  .filter((path) => path !== '/*');
const routeExists = (route) => APP_ROUTES.some((pattern) => new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+')}$`).test(route));

test('content is well formed: unique ids, known blocks, icons and summaries', () => {
  const ids = new Set();
  const types = new Set(['p', 'steps', 'tips', 'warning', 'note', 'table', 'faq', 'list']);
  for (const entry of HANDBOOK) {
    assert.ok(!ids.has(entry.id), `duplicate chapter ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.title && entry.icon && entry.summary, `${entry.id} needs title, icon and summary`);
    assert.ok(['general', 'division', 'management', 'admin'].includes(entry.scope), `${entry.id} scope`);
    assert.ok(entry.sections.length > 0, `${entry.id} has sections`);
    const sectionIds = new Set();
    for (const section of entry.sections) {
      assert.ok(!sectionIds.has(section.id), `duplicate section ${entry.id}-${section.id}`);
      sectionIds.add(section.id);
      assert.ok(section.body.length > 0, `${entry.id}-${section.id} has a body`);
      for (const block of section.body) {
        assert.ok(types.has(block.type), `${entry.id}-${section.id}: block ${block.type}`);
        if (['steps', 'tips', 'list'].includes(block.type)) assert.ok(block.items.length > 0 && block.items.every((item) => typeof item === 'string' && item));
        if (block.type === 'table') assert.ok(block.rows.every((row) => row.length === block.columns.length), `${entry.id}-${section.id}: table row width`);
        if (block.type === 'faq') assert.ok(block.items.every((item) => item.q && item.a));
        if (['p', 'warning', 'note'].includes(block.type)) assert.ok(typeof block.text === 'string' && block.text && !/[<>]/.test(block.text));
      }
    }
  }
});

test('roleLevel: head > supervisor > member; the global roles', () => {
  assert.equal(roleLevel(standardUser('sales.member')), 'member');
  assert.equal(roleLevel(standardUser('sales.supervisor')), 'supervisor');
  assert.equal(roleLevel(standardUser('sales.head')), 'head');
  assert.equal(roleLevel({ roles: [{ roleKey: 'sales.member' }, { roleKey: 'marketing.head' }] }), 'head');
  assert.equal(roleLevel({ roles: [{ roleKey: 'custom.x', roleLevel: 'supervisor' }] }), 'supervisor');
  assert.equal(roleLevel(ADMIN), 'admin');
  assert.equal(roleLevel(SUPER), 'super_admin');
  assert.equal(roleLevel({ roles: [{ roleKey: 'system.admin' }, { roleKey: 'sales.head' }] }), 'head');
  assert.equal(roleLevel({}), 'member');
  assert.equal(isSystemAdminOnly(ADMIN), true);
  assert.equal(isSystemAdminOnly({ roles: [{ roleKey: 'system.admin' }, { roleKey: 'sales.member' }] }), false);
  assert.equal(roleLabel(standardUser('sales.head')), 'Sales Head');
  assert.equal(roleLabel({ roles: [] }), 'Member');
});

test('audience: permissions any-of, levels and role prefixes', () => {
  const user = standardUser('sales.supervisor');
  assert.equal(audienceAllows(undefined, user), true);
  assert.equal(audienceAllows({ permissions: ['finance.view', 'sales.order.view'] }, user), true);
  assert.equal(audienceAllows({ permissions: ['finance.view'] }, user), false);
  assert.equal(audienceAllows({ levels: ['head'] }, user), false);
  assert.equal(audienceAllows({ levels: ['supervisor', 'head'] }, user), true);
  assert.equal(audienceAllows({ roles: ['sales'] }, user), true);
  assert.equal(audienceAllows({ roles: ['warehouse'] }, user), false);
  assert.equal(levelNote({ levels: ['supervisor', 'head'] }), 'Khusus Supervisor & Head');
  assert.equal(levelNote({ levels: ['member', 'supervisor', 'head'] }), '');
});

test('a Sales Member reads Sales, not Finance, management or administration', () => {
  const ids = chapterIds(standardUser('sales.member'));
  for (const id of ['mulai', 'kerja-harian', 'dokumen', 'prakasa-ai', 'sales', 'glosarium', 'bantuan']) assert.ok(ids.includes(id), id);
  for (const id of ['finance', 'warehouse', 'procurement', 'people-culture', 'it-aset', 'manajemen', 'dashboard-divisi']) {
    assert.ok(!ids.includes(id), `sales.member must not see ${id}`);
  }
  // Data Accurate: a member proposes customers to Accurate (owner, 3 Oct 2026)
  // and reads that section; deciding batches stays the Supervisor's/Head's.
  assert.ok(ids.includes('data-accurate'));
  assert.ok(!ids.some((id) => chapter(id).scope === 'admin'), 'no admin chapter');
  // Payment requests yes (every division raises them); Finance's own processing no.
  const anchors = sectionAnchors(standardUser('sales.member'));
  assert.ok(anchors.includes('kerja-harian-pengajuan-pembayaran'));
  assert.ok(!anchors.some((anchor) => anchor.startsWith('kerja-harian-pengajuan-proses')));
  assert.ok(anchors.includes('data-accurate-pengajuan-ke-accurate'));
  assert.ok(!anchors.includes('data-accurate-menyetujui'));
});

test('a Sales Head reads the Accurate approval and the division dashboard', () => {
  const user = standardUser('sales.head');
  const ids = chapterIds(user);
  assert.ok(ids.includes('data-accurate'));
  assert.ok(ids.includes('dashboard-divisi'));
  assert.ok(ids.includes('manajemen'), 'Heads oversee their own division');
  const anchors = sectionAnchors(user);
  assert.ok(anchors.includes('data-accurate-menyetujui'));
  assert.ok(!anchors.includes('manajemen-alur-margin'), 'Alur & margin is management only');
  // A Sales Member does not get the Supervisor-only sections of Sales.
  const member = sectionAnchors(standardUser('sales.member'));
  const restricted = chapter('sales').sections.filter((section) => section.audience?.levels);
  assert.ok(restricted.length > 0);
  for (const section of restricted) assert.ok(!member.includes(`sales-${section.id}`), section.id);
});

test('Administrator Sistem reads the administration and general chapters only', () => {
  const visible = visibleChapters(ADMIN, HANDBOOK);
  assert.ok(visible.some((entry) => entry.scope === 'admin'));
  assert.deepEqual(visible.filter((entry) => !['general', 'admin'].includes(entry.scope)).map((entry) => entry.id), []);
  const ids = visible.map((entry) => entry.id);
  for (const id of ['mulai', 'admin-pengguna', 'admin-aturan', 'admin-sistem', 'bantuan']) assert.ok(ids.includes(id), id);
  for (const id of ['sales', 'finance', 'data-accurate', 'manajemen', 'prakasa-ai', 'laporan']) assert.ok(!ids.includes(id), id);
  // Personal files yes (My Drive, Docs); the division's Shared Drive and templates no.
  const anchors = sectionAnchors(ADMIN);
  assert.ok(anchors.includes('dokumen-my-drive'));
  for (const anchor of ['dokumen-penyimpanan-divisi', 'dokumen-template-dokumen', 'dokumen-tanda-tangan']) assert.ok(!anchors.includes(anchor), anchor);
});

test('Super Admin reads every chapter and every section', () => {
  const visible = visibleChapters(SUPER, HANDBOOK);
  assert.equal(visible.length, HANDBOOK.length);
  assert.equal(visible.flatMap((entry) => entry.sections).length, HANDBOOK.flatMap((entry) => entry.sections).length);
});

test('no standard role sees an admin chapter; every division sees its own module', () => {
  const own = {
    sales: 'sales', retail_commerce: 'retail-commerce', marketing: 'marketing', warehouse: 'warehouse',
    procurement: 'procurement', finance: 'finance', people_culture: 'people-culture',
  };
  for (const role of STANDARD_ROLES) {
    const ids = chapterIds(standardUser(role.key));
    assert.ok(!ids.some((id) => chapter(id).scope === 'admin'), role.key);
    if (own[role.departmentCode]) assert.ok(ids.includes(own[role.departmentCode]), `${role.key} → ${own[role.departmentCode]}`);
  }
});

test('every route in the handbook exists in App.jsx and is not retired', () => {
  const routes = contentRoutes(HANDBOOK);
  assert.ok(routes.length > 30);
  for (const { where, route } of routes) {
    const path = route.split(/[?#]/)[0];
    assert.ok(routeExists(path), `${where}: ${route} is not a route in App.jsx`);
    assert.ok(hasRouteAccess(path, ALL_PERMISSIONS), `${where}: ${route} is blocked`);
  }
});

test('the audience of every chapter and section matches the page it links to', () => {
  // A chapter whose audience lets a role in while the menu would refuse the
  // page is a content mistake (the model hides it, but the text is wrong).
  const users = [...STANDARD_ROLES.map((role) => standardUser(role.key)), ADMIN];
  const problems = [];
  for (const user of users) {
    for (const entry of HANDBOOK) {
      if (!audienceAllows(entry.audience, user)) continue;
      if (isSystemAdminOnly(user) && !['general', 'admin'].includes(entry.scope)) continue;
      if (entry.route && !hasRouteAccess(entry.route, user.permissions)) problems.push(`${user.roles[0].roleKey}: ${entry.id} → ${entry.route}`);
      for (const section of entry.sections) {
        if (!audienceAllows(section.audience, user) || !section.route) continue;
        if (!hasRouteAccess(section.route, user.permissions)) problems.push(`${user.roles[0].roleKey}: ${entry.id}-${section.id} → ${section.route}`);
      }
    }
    // And what the user finally reads only links to pages they can open.
    for (const entry of visibleChapters(user, HANDBOOK)) {
      for (const route of [entry.route, ...entry.sections.map((section) => section.route)].filter(Boolean)) {
        assert.ok(hasRouteAccess(route, user.permissions), `${user.roles[0].roleKey}: ${entry.id} → ${route}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('the handbook covers every menu entry', () => {
  const covered = new Set(contentRoutes(HANDBOOK).map(({ route }) => route.split(/[?#]/)[0]));
  // The Panduan entry itself needs no chapter.
  const menu = buildNavSections(ALL_PERMISSIONS).flatMap((section) => section.items).map((item) => item.to).filter((to) => to !== '/panduan');
  assert.ok(menu.length > 40);
  assert.deepEqual(menu.filter((to) => !covered.has(to)), []);
});

test('search finds sections by words, accent and case insensitive, within the visible chapters only', () => {
  const member = visibleChapters(standardUser('sales.member'), HANDBOOK);
  const hits = search(member, 'Reimbursement');
  assert.ok(hits.length > 0);
  assert.ok(hits.some((hit) => hit.anchor === 'kerja-harian-pengajuan-pembayaran'));
  assert.ok(hits.every((hit) => hit.snippet.length > 0));
  assert.deepEqual(search(member, ''), []);
  assert.deepEqual(search(member, 'zzzz qqqq'), []);
  // Admin chapters are not searchable by someone who cannot read them.
  assert.deepEqual(search(member, 'Matriks approval').filter((hit) => hit.chapterId.startsWith('admin')), []);
});

test('outline: chapters with section anchors, grouped by part', () => {
  const outline = buildOutline(visibleChapters(standardUser('warehouse.supervisor'), HANDBOOK));
  assert.ok(outline.every((entry) => entry.anchor === entry.id && entry.sections.every((section) => section.anchor === `${entry.id}-${section.id}`)));
  const parts = outlineParts(outline);
  assert.equal(parts.flatMap((part) => part.chapters).length, outline.length);
  assert.ok(parts.every((part, index) => index === 0 || part.title !== parts[index - 1].title));
});
