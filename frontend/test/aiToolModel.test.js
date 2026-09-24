import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveToolForPath,
  filterStarters,
  sanitizeVisibleState,
  riskTierLabel,
  actionAvailabilityText,
  panelModeForWidth,
  contextKeyFor,
} from '../src/components/ai/aiToolModel.js';

const tools = [
  { key: 'dashboard', title: 'Beranda', patterns: ['/', '/hub/:slug'], queryKeys: ['tab'], starters: ['a', 'b'] },
  { key: 'warehouse', title: 'Warehouse', patterns: ['/warehouse', '/warehouse/movements/:type/new', '/warehouse/movements/:type/:id'], queryKeys: ['tab', 'status', 'q'], starters: ['Ekstrak baris', 'Ringkas', '', 'Ringkas'] },
  { key: 'signature-asset', title: 'Tanda tangan saya', patterns: ['/signatures/asset'], queryKeys: [] },
  { key: 'signatures', title: 'Tanda tangan', patterns: ['/signatures', '/signatures/:id'], queryKeys: [] },
];

test('current path resolves to the most specific tool pattern', () => {
  assert.equal(resolveToolForPath(tools, '/warehouse').tool.key, 'warehouse');
  assert.deepEqual(resolveToolForPath(tools, '/warehouse/movements/inbound/12').params, { type: 'inbound', id: '12' });
  assert.equal(resolveToolForPath(tools, '/warehouse/movements/inbound/new').pattern, '/warehouse/movements/:type/new');
  assert.equal(resolveToolForPath(tools, '/signatures/asset').tool.key, 'signature-asset');
  assert.equal(resolveToolForPath(tools, '/signatures/9').tool.key, 'signatures');
  assert.equal(resolveToolForPath(tools, '/').tool.key, 'dashboard');
  assert.equal(resolveToolForPath(tools, '/unknown/page'), null);
  assert.equal(resolveToolForPath([], '/warehouse'), null);
});

test('prompt starters are de-duplicated, non-empty, and capped', () => {
  assert.deepEqual(filterStarters(tools[1]), ['Ekstrak baris', 'Ringkas']);
  assert.deepEqual(filterStarters({ starters: Array.from({ length: 10 }, (_, i) => `s${i}`) }).length, 6);
  assert.deepEqual(filterStarters(null), []);
});

test('visible state keeps only allow-listed scalar keys within size limits', () => {
  const state = sanitizeVisibleState({ tab: 'inbound', status: 'draft', q: 'x'.repeat(400), password: 'no', rows: [1], extra: 'no' }, tools[1].queryKeys);
  assert.deepEqual(Object.keys(state).sort(), ['q', 'status', 'tab']);
  assert.equal(state.q.length, 120);
  assert.deepEqual(sanitizeVisibleState({ tab: 'x' }, []), {});
  assert.deepEqual(sanitizeVisibleState('bad', ['tab']), {});
});

test('risk tiers have clear labels and controlled decisions never look executable', () => {
  assert.equal(riskTierLabel('read'), 'Baca');
  assert.equal(riskTierLabel('draft'), 'Draft');
  assert.equal(riskTierLabel('confirmed_write'), 'Perlu konfirmasi');
  assert.equal(riskTierLabel('controlled_decision'), 'Keputusan manusia');
  assert.equal(riskTierLabel('system_administration'), 'Super Admin');
  assert.match(actionAvailabilityText({ riskTier: 'controlled_decision', executorAvailable: false }), /hanya merekomendasikan/);
  assert.match(actionAvailabilityText({ riskTier: 'draft', executorAvailable: false }), /draft/i);
  assert.match(actionAvailabilityText({ riskTier: 'confirmed_write', executorAvailable: true }), /konfirmasi/);
});

test('panel mode follows viewport width', () => {
  assert.equal(panelModeForWidth(1440), 'desktop');
  assert.equal(panelModeForWidth(1024), 'tablet');
  assert.equal(panelModeForWidth(390), 'mobile');
});

test('context key separates tools and records but ignores unrelated query noise', () => {
  const detail = resolveToolForPath(tools, '/warehouse/movements/inbound/12');
  assert.equal(contextKeyFor(detail), 'warehouse:/warehouse/movements/:type/:id:inbound:12');
  assert.equal(contextKeyFor(resolveToolForPath(tools, '/warehouse')), 'warehouse:/warehouse:');
  assert.equal(contextKeyFor(null), null);
});
