import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import HANDBOOK from '../src/pages/handbook/handbookContent.js';
import { roleLevel, visibleChapters } from '../src/pages/handbook/handbookModel.js';
import { OUT, buildHandbookJson, serialize } from '../scripts/build-handbook-json.mjs';

// Prakasa AI's panduan_aplikasi tool reads the handbook on the server
// (backend/src/config/handbook.generated.json + services/handbookAccess.js).
// The file must be current and the server's role filter must be the page's.
const require = createRequire(import.meta.url);
const backend = require('../../backend/src/services/handbookAccess.js');
const { STANDARD_ROLES, SYSTEM_ADMIN_PERMISSIONS } = require('../../backend/src/config/standardOrganization.js');

const navSource = readFileSync(new URL('../src/components/navigation.js', import.meta.url), 'utf8');
const ALL_PERMISSIONS = [...new Set([
  ...STANDARD_ROLES.flatMap((role) => role.permissions),
  ...SYSTEM_ADMIN_PERMISSIONS,
  ...[...navSource.matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)].map((m) => m[1]),
])];

const USERS = [
  ...STANDARD_ROLES.map((role) => ({ label: role.key, permissions: role.permissions, roles: [{ roleKey: role.key, roleLevel: role.level, name: role.name }] })),
  { label: 'system.admin', permissions: SYSTEM_ADMIN_PERMISSIONS, roles: [{ roleKey: 'system.admin', name: 'Administrator Sistem' }] },
  { label: 'system.super_admin', permissions: ALL_PERMISSIONS, roles: [{ roleKey: 'system.super_admin', name: 'Super Admin' }] },
  { label: 'admin + sales head', permissions: [...SYSTEM_ADMIN_PERMISSIONS, ...STANDARD_ROLES.find((r) => r.key === 'sales.head').permissions], roles: [{ roleKey: 'system.admin' }, { roleKey: 'sales.head', roleLevel: 'head' }] },
  { label: 'no roles', permissions: [], roles: [] },
  { label: 'custom role without level', permissions: ['task.view', 'approval.view'], roles: [{ roleKey: 'custom.staff', name: 'Staf' }] },
];

const shape = (chapters) => chapters.map((chapter) => [chapter.id, chapter.sections.map((section) => section.id)]);

test('handbook.generated.json is current (run: node scripts/build-handbook-json.mjs)', () => {
  assert.equal(readFileSync(OUT, 'utf8'), serialize(buildHandbookJson()), 'backend/src/config/handbook.generated.json is stale: cd frontend && node scripts/build-handbook-json.mjs');
});

test('the backend filter gives every standard role exactly the chapters and sections the page gives', () => {
  assert.ok(USERS.length > 20);
  for (const user of USERS) {
    assert.deepEqual(shape(backend.visibleChapters(user)), shape(visibleChapters(user, HANDBOOK)), user.label);
    assert.equal(backend.roleLevel(user), roleLevel(user), user.label);
  }
  assert.deepEqual(backend.visibleChapters(null), []);
});

test('the generated text is the page text, block for block', () => {
  const data = backend.HANDBOOK;
  assert.equal(data.chapters.length, HANDBOOK.length);
  for (const [index, chapter] of HANDBOOK.entries()) {
    assert.equal(data.chapters[index].title, chapter.title);
    assert.deepEqual(data.chapters[index].sections.map((section) => section.body), chapter.sections.map((section) => section.body), chapter.id);
  }
});
