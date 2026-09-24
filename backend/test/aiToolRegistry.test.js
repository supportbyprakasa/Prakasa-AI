const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  RISK_TIERS,
  TOOLS,
  resolveTool,
  assertToolAccess,
  listToolsForUser,
} = require('../src/services/aiToolRegistry.service');

const FRONTEND = path.join(__dirname, '../../frontend/src');
const UNAUTHENTICATED = new Set(['/login', '/verify/:code', '*']);

function appRoutes() {
  const source = fs.readFileSync(path.join(FRONTEND, 'App.jsx'), 'utf8');
  return [...source.matchAll(/path="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((route) => !UNAUTHENTICATED.has(route))
    .map((route) => (route.startsWith('/') ? route : `/${route}`));
}

function sidebarItems() {
  const source = fs.readFileSync(path.join(FRONTEND, 'components/navigation.js'), 'utf8');
  return [...source.matchAll(/\{ to: '([^']+)'[^}]*?permission: (\[[^\]]*\]|'[^']+')/g)].map((match) => ({
    to: match[1],
    permissions: match[2].startsWith('[') ? [...match[2].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [match[2].slice(1, -1)],
  }));
}

const sample = (route) => route
  .replace(':type', 'inbound')
  .replace(/:[a-zA-Z]+/g, '7');

test('every authenticated frontend route resolves to an AI tool descriptor', () => {
  const routes = appRoutes();
  assert.ok(routes.length > 60, `expected the full route table, got ${routes.length}`);
  const missing = routes.filter((route) => !resolveTool(sample(route)));
  assert.deepEqual(missing, []);
  assert.ok(resolveTool('/'), 'home dashboard');
});

test('an AI tool never needs less permission than its navigation entry', () => {
  const items = sidebarItems();
  assert.ok(items.length > 40, `expected sidebar items, got ${items.length}`);
  for (const item of items) {
    const resolved = resolveTool(item.to);
    assert.ok(resolved, item.to);
    const required = [].concat(resolved.tool.readPermission || []);
    assert.deepEqual([...required].sort(), [...item.permissions].sort(), `${item.to} permission drift`);
  }
});

test('descriptors are complete and controlled decisions never have an executor', () => {
  const keys = new Set();
  for (const entry of TOOLS) {
    assert.equal(keys.has(entry.key), false, `duplicate ${entry.key}`);
    keys.add(entry.key);
    assert.ok(entry.title && entry.patterns.length, entry.key);
    assert.ok(RISK_TIERS.includes(entry.riskTier), entry.key);
    for (const action of entry.actions) {
      assert.ok(RISK_TIERS.includes(action.riskTier), `${entry.key}.${action.key}`);
      assert.ok(action.confirmationTier, `${entry.key}.${action.key}`);
      if (action.riskTier === 'controlled_decision') assert.equal(action.executor, null, `${entry.key}.${action.key}`);
    }
    for (const required of ['explain', 'summarize', 'find_gaps', 'draft_next_step']) {
      assert.ok(entry.actions.some((action) => action.key === required), `${entry.key} lacks ${required}`);
    }
  }
  for (const key of ['users', 'roles', 'permissions', 'ai-provider-settings']) {
    const entry = TOOLS.find((candidate) => candidate.key === key);
    assert.equal(entry.admin, true, key);
    assert.equal(entry.riskTier, 'system_administration', key);
  }
});

test('the most specific pattern wins and exposes the route subject', () => {
  const detail = resolveTool('/warehouse/movements/outbound/12');
  assert.equal(detail.tool.key, 'warehouse');
  assert.deepEqual(detail.subject && { type: detail.subject.type, params: detail.params }, { type: 'warehouse_movement', params: { type: 'outbound', id: '12' } });
  assert.equal(resolveTool('/warehouse/movements/inbound/new').subject, null);
  assert.equal(resolveTool('/signatures/asset').tool.key, 'signature-asset');
  assert.equal(resolveTool('/forms/submissions/3').tool.key, 'form-submissions');
  assert.equal(resolveTool('/approvals/5').subject.type, 'approval_request');
  assert.equal(resolveTool('/does-not-exist'), null);
});

test('tool access is checked before anything else and actions need their own permission', () => {
  const warehouse = TOOLS.find((entry) => entry.key === 'warehouse');
  assert.throws(() => assertToolAccess({ user: { permissions: [] }, tool: warehouse }), (error) => error.status === 403);
  assert.doesNotThrow(() => assertToolAccess({ user: { permissions: ['warehouse.movement.view'] }, tool: warehouse }));
  assert.throws(
    () => assertToolAccess({ user: { permissions: ['warehouse.movement.view'] }, tool: warehouse, operation: 'recommend_movement_decision' }),
    (error) => error.status === 403,
  );
  assert.throws(() => assertToolAccess({ user: { permissions: [] }, tool: null }), (error) => error.status === 404);
});

test('tool list is filtered by permission and starters follow the role level', () => {
  const member = listToolsForUser({ permissions: ['warehouse.movement.view', 'task.view'] }, 'member');
  const keys = member.map((entry) => entry.key);
  assert.ok(keys.includes('warehouse') && keys.includes('tasks') && keys.includes('dashboard'));
  assert.equal(keys.includes('roles'), false);
  const warehouseMember = member.find((entry) => entry.key === 'warehouse');
  assert.ok(warehouseMember.starters.some((text) => /Ekstrak/.test(text)));
  assert.equal(warehouseMember.actions.some((action) => action.key === 'recommend_movement_decision'), false);

  const supervisor = listToolsForUser({ permissions: ['warehouse.movement.view', 'warehouse.movement.approve'] }, 'supervisor')
    .find((entry) => entry.key === 'warehouse');
  assert.ok(supervisor.starters.some((text) => /review/.test(text)));
  const decision = supervisor.actions.find((action) => action.key === 'recommend_movement_decision');
  assert.equal(decision.executorAvailable, false);
  assert.equal(decision.confirmationTier, 'human_decides');
});
