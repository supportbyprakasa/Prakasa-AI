const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');
const { resolveEngine, saveRoutingSettings, setDivisionAssignment } = require('../src/services/ai/aiRouting.service');
const { safeModel } = require('../src/services/ai/providerSettings');

test('a division with no override uses the global default engine and account', () => {
  const routing = { defaultProvider: 'claude_team', defaultClaudeTeamAccountId: 1 };
  assert.deepEqual(resolveEngine({ routing, assignment: null }), { provider: 'claude_team', claudeTeamAccountId: 1 });
});

test('a division override replaces the auto-default provider', () => {
  const routing = { defaultProvider: 'claude_team', defaultClaudeTeamAccountId: 1 };
  assert.deepEqual(
    resolveEngine({ routing, assignment: { provider: 'claude_team', claudeTeamAccountId: 4 } }),
    { provider: 'claude_team', claudeTeamAccountId: 4 }
  );
  assert.deepEqual(
    resolveEngine({ routing, assignment: { provider: 'openai', claudeTeamAccountId: null } }),
    { provider: 'openai', claudeTeamAccountId: 1 }
  );
});

test('the resolved Claude Team account always falls back to the global default, even when the auto-default provider is something else — Claude Team must stay pickable from the engine menu', () => {
  const routing = { defaultProvider: 'claude_team', defaultClaudeTeamAccountId: 1 };
  assert.deepEqual(
    resolveEngine({ routing, assignment: { provider: 'claude_team', claudeTeamAccountId: null } }),
    { provider: 'claude_team', claudeTeamAccountId: 1 }
  );
  assert.deepEqual(
    resolveEngine({ routing, assignment: { provider: 'openai', claudeTeamAccountId: null } }).claudeTeamAccountId,
    1
  );
});

test('every active user gets an engine — nobody is blocked by the new routing model', () => {
  // The old model could return "not allowed"; the new model always names a provider.
  const routing = { defaultProvider: 'claude_team', defaultClaudeTeamAccountId: 1 };
  const result = resolveEngine({ routing, assignment: null });
  assert.ok(result.provider);
});

test('saving the default engine to claude_team requires an account id', async (t) => {
  t.mock.method(pool, 'query', async () => { throw new Error('must not query'); });
  await assert.rejects(
    saveRoutingSettings({ defaultProvider: 'claude_team', defaultClaudeTeamAccountId: null }, 1),
    { code: 'VALIDATION_ERROR' }
  );
});

test('setting a division to claude_team requires an account id', async (t) => {
  t.mock.method(pool, 'query', async () => { throw new Error('must not query'); });
  await assert.rejects(
    setDivisionAssignment(7, { provider: 'claude_team', claudeTeamAccountId: null }, 1),
    { code: 'VALIDATION_ERROR' }
  );
});

test('setting a division to an unknown provider is rejected before any query', async (t) => {
  t.mock.method(pool, 'query', async () => { throw new Error('must not query'); });
  await assert.rejects(setDivisionAssignment(7, { provider: 'llama_farm' }, 1), { code: 'VALIDATION_ERROR' });
});

test('model names that could be read as CLI flags are rejected', () => {
  assert.equal(safeModel('sonnet'), 'sonnet');
  assert.equal(safeModel('claude-sonnet-5'), 'claude-sonnet-5');
  assert.equal(safeModel('--dangerously-skip-permissions'), null);
  assert.equal(safeModel('sonnet --tools Bash'), null);
});
