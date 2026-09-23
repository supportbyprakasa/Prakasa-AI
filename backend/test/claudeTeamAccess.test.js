const test = require('node:test');
const assert = require('node:assert/strict');
const { isClaudeTeamAllowed, safeModel } = require('../src/services/ai/providerSettings');

const settings = {
  enabled: true,
  allowedDepartmentIds: [7],
  allowedEmails: ['owner@prakasagroup.com'],
  model: 'sonnet',
};

test('denied when Claude Team is disabled, even for allowlisted users', () => {
  assert.equal(
    isClaudeTeamAllowed({ ...settings, enabled: false }, { email: 'owner@prakasagroup.com', departmentId: 7 }),
    false
  );
});

test('allowed by email allowlist, case-insensitive', () => {
  assert.equal(isClaudeTeamAllowed(settings, { email: ' Owner@PrakasaGroup.com ', departmentId: null }), true);
});

test('allowed for members of an allowed division', () => {
  assert.equal(isClaudeTeamAllowed(settings, { email: 'staff@prakasagroup.com', departmentId: 7 }), true);
});

test('denied for users outside allowed divisions and allowlist', () => {
  assert.equal(isClaudeTeamAllowed(settings, { email: 'staff@prakasagroup.com', departmentId: 8 }), false);
  assert.equal(isClaudeTeamAllowed(settings, { email: 'staff@prakasagroup.com', departmentId: null }), false);
});

test('denied when there is no authenticated identity (e.g. background jobs)', () => {
  assert.equal(isClaudeTeamAllowed(settings, null), false);
});

test('model names that could be read as CLI flags are rejected', () => {
  assert.equal(safeModel('sonnet'), 'sonnet');
  assert.equal(safeModel('claude-sonnet-5'), 'claude-sonnet-5');
  assert.equal(safeModel('--dangerously-skip-permissions'), null);
  assert.equal(safeModel('sonnet --tools Bash'), null);
});
