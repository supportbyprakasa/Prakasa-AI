const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/db/pool');

// Gateway secrets are stored encrypted with this key (services/signature.service.js).
process.env.SIGNATURE_ENCRYPTION_KEY = process.env.SIGNATURE_ENCRYPTION_KEY || 'test-signature-key-0123456789abcdef0123';
const accounts = require('../src/services/ai/claudeTeamAccounts.service');

test('a gateway-mode account requires a URL and a secret of at least 16 characters', async (t) => {
  t.mock.method(pool, 'query', async () => { throw new Error('must not query'); });
  await assert.rejects(
    accounts.createAccount({ label: 'Cabang B', mode: 'gateway', model: 'sonnet' }, 1),
    { code: 'VALIDATION_ERROR' }
  );
  await assert.rejects(
    accounts.createAccount({ label: 'Cabang B', mode: 'gateway', gatewayUrl: 'https://x', gatewaySecret: 'short', model: 'sonnet' }, 1),
    { code: 'VALIDATION_ERROR' }
  );
});

test('a second cli-mode account is refused — the CLI login is one account per server', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('mode="cli"')) return [[{ id: 1 }]];
    throw new Error('must not reach an insert');
  });
  await assert.rejects(
    accounts.createAccount({ label: 'Akun Kedua', mode: 'cli', model: 'sonnet' }, 1),
    { code: 'VALIDATION_ERROR' }
  );
});

test('a gateway-mode account is accepted alongside an existing cli account', async (t) => {
  const inserted = [];
  t.mock.method(pool, 'query', async (sql, args) => {
    const statement = String(sql);
    if (statement.startsWith('INSERT INTO')) { inserted.push(args); return [{ insertId: 9 }]; }
    if (statement.includes('SELECT * FROM ai_claude_team_accounts WHERE id=?')) {
      return [[{
        id: 9, label: 'Cabang B', mode: 'gateway', gateway_url: 'https://gw.internal', gateway_secret: 'x'.repeat(20),
        model: 'sonnet', web_research: 0, enabled: 1, updated_at: null,
      }]];
    }
    return [[]];
  });
  const account = await accounts.createAccount({
    label: 'Cabang B', mode: 'gateway', gatewayUrl: 'https://gw.internal', gatewaySecret: 'x'.repeat(20), model: 'sonnet',
  }, 1);
  assert.equal(account.label, 'Cabang B');
  assert.equal(inserted.length, 1);
});

test('the gateway secret is masked on read and never returned in full', async (t) => {
  t.mock.method(pool, 'query', async () => [[{
    id: 1, label: 'Akun Utama', mode: 'gateway', gateway_url: 'https://gw', gateway_secret: 'supersecretvalue1234',
    model: 'sonnet', web_research: 0, enabled: 1, updated_at: null,
  }]]);
  const account = await accounts.getAccount(1);
  assert.deepEqual(account.gatewaySecret, { set: true, preview: '••••1234' });
});

test('deleting an account that a division depends on is refused with the division named', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const statement = String(sql);
    if (statement.includes('FROM ai_routing_settings')) return [[]];
    if (statement.includes('FROM ai_division_assignments')) return [[{ name: 'Sales' }]];
    throw new Error('must not delete while in use');
  });
  await assert.rejects(accounts.deleteAccount(3), { code: 'VALIDATION_ERROR', message: /Sales/ });
});

test('deleting an account used as the global default is refused', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const statement = String(sql);
    if (statement.includes('FROM ai_routing_settings')) return [[{ id: 1 }]];
    throw new Error('must not delete the default account');
  });
  await assert.rejects(accounts.deleteAccount(1), { code: 'VALIDATION_ERROR' });
});
