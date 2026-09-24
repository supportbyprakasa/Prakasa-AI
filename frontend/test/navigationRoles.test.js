import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildNavSections, hubCards, pageTrail } from '../src/components/navigation.js';

const require = createRequire(import.meta.url);
const { STANDARD_ROLES } = require('../../backend/src/config/standardOrganization.js');
const role = (key) => STANDARD_ROLES.find((entry) => entry.key === key);
const cardsFor = (key) => hubCards(buildNavSections(role(key).permissions));
const slugs = (key) => cardsFor(key).map((card) => card.slug);

test('no standard division role sees Administrasi', () => {
  for (const entry of STANDARD_ROLES) {
    assert.equal(slugs(entry.key).includes('admin'), false, entry.key);
  }
});

test('each division sees its own workspace, and only its own', () => {
  const expected = {
    'warehouse.member': ['ai', 'kerja', 'warehouse', 'knowledge'],
    'finance.member': ['ai', 'kerja', 'finance', 'knowledge'],
    'sales.member': ['ai', 'kerja', 'sales', 'knowledge'],
    'people_culture.member': ['ai', 'kerja', 'people', 'knowledge'],
    'operations.member': ['ai', 'kerja', 'operations', 'knowledge'],
    'procurement.member': ['ai', 'kerja', 'warehouse', 'finance', 'knowledge'],
    'retail_commerce.member': ['ai', 'kerja', 'sales', 'warehouse', 'knowledge'],
    'marketing.member': ['ai', 'kerja', 'sales', 'knowledge'],
    'management_office.member': ['ai', 'kerja', 'insight', 'knowledge'],
  };
  for (const [key, list] of Object.entries(expected)) assert.deepEqual(slugs(key), list, key);
});

test('Supervisors and Heads gain oversight hubs, Members do not', () => {
  assert.equal(slugs('warehouse.member').includes('insight'), false);
  assert.ok(slugs('warehouse.supervisor').includes('insight'));
  const head = cardsFor('warehouse.head').find((card) => card.slug === 'knowledge');
  assert.deepEqual(head.items.map((item) => item.to), ['/kb', '/data-classification']);
  const member = cardsFor('warehouse.member').find((card) => card.slug === 'knowledge');
  assert.deepEqual(member.items.map((item) => item.to), ['/kb']);
});

test('a hub with one module opens it directly and describes only what is visible', () => {
  const warehouse = cardsFor('warehouse.member').find((card) => card.slug === 'warehouse');
  assert.equal(warehouse.to, '/warehouse');
  const sales = cardsFor('marketing.member').find((card) => card.slug === 'sales');
  assert.deepEqual(sales.items.map((item) => item.label), ['Customers', 'Customer Workspaces']);
  assert.equal(/Pipeline|Sample/.test(sales.description), false);
  const kerja = cardsFor('warehouse.member').find((card) => card.slug === 'kerja');
  assert.equal(kerja.items.some((item) => item.to === '/admin/approval-delegations'), false, 'members do not approve');
  assert.ok(cardsFor('warehouse.supervisor').find((card) => card.slug === 'kerja').items.some((item) => item.to === '/admin/approval-delegations'));
});

test('breadcrumbs skip a hub page that would only hold one module', () => {
  const sections = buildNavSections(role('warehouse.member').permissions);
  assert.deepEqual(pageTrail('/warehouse', sections).map((step) => step.label), ['Warehouse']);
  assert.deepEqual(pageTrail('/tasks', sections).map((step) => step.label), ['Kerja Harian', 'Task Board']);
});

test('Super Admin with every permission still sees Administrasi', () => {
  const all = [...new Set(STANDARD_ROLES.flatMap((entry) => entry.permissions)), 'user.manage', 'role.manage', 'approval_matrix.view'];
  assert.ok(hubCards(buildNavSections(all)).some((card) => card.slug === 'admin'));
});
