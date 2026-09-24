const test = require('node:test');
const assert = require('node:assert/strict');
const { STANDARD_BUDGET, contextBudgetFor } = require('../src/services/ai/contextBudget');

test('per-token API providers keep the conservative budget', () => {
  for (const provider of ['openai', 'gemini', 'claude', 'n8n', undefined]) {
    assert.deepEqual(contextBudgetFor(provider), { ...STANDARD_BUDGET });
  }
});

test('Claude Team gets whole documents and long history, tunable by env', () => {
  delete process.env.AI_LARGE_CONTEXT_CHARS;
  delete process.env.AI_LARGE_HISTORY_CHARS;
  const large = contextBudgetFor('claude_team');
  assert.equal(large.documentChars, 300000);
  assert.equal(large.totalContextChars, 300000);
  assert.equal(large.historyMessages, 50);
  assert.equal(large.historyChars, 80000);

  process.env.AI_LARGE_CONTEXT_CHARS = '120000';
  process.env.AI_LARGE_HISTORY_CHARS = 'not-a-number';
  const tuned = contextBudgetFor('claude_team');
  assert.equal(tuned.totalContextChars, 120000);
  assert.equal(tuned.historyChars, 80000);
  delete process.env.AI_LARGE_CONTEXT_CHARS;
  delete process.env.AI_LARGE_HISTORY_CHARS;
});
