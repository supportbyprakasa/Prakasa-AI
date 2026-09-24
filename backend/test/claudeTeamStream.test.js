const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A fake `claude` CLI that speaks the stream-json protocol, so the parser is tested
// without calling the real service.
const FAKE_CLI = `#!/usr/bin/env node
const argv = process.argv.slice(2);
const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
const fail = (why) => { out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: why }); process.exit(1); };
const prompt = argv[argv.indexOf('--') + 1];
if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) fail('api key leaked');
for (const flag of ['-p', '--safe-mode', '--no-session-persistence', '--include-partial-messages']) {
  if (!argv.includes(flag)) fail('missing ' + flag);
}
if (argv[argv.indexOf('--tools') + 1] !== '') fail('tools not disabled');
if (prompt === 'FAIL') fail('requested failure');
out({ type: 'system', subtype: 'init' });
process.stdout.write('not json at all\\n');
const delta = (text) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
out(delta('Halo'));
const split = JSON.stringify(delta(' dunia')) + '\\n';
process.stdout.write(split.slice(0, 20));
setTimeout(() => {
  process.stdout.write(split.slice(20));
  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hidden' } } });
  out({ type: 'result', subtype: 'success', is_error: false, result: prompt.startsWith('--') ? prompt : 'Halo dunia',
        usage: { input_tokens: 3, cache_read_input_tokens: 4, output_tokens: 5 } });
}, 30);
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prakasa-claude-'));
const cliPath = path.join(dir, 'claude');
fs.writeFileSync(cliPath, FAKE_CLI);
fs.chmodSync(cliPath, 0o755);

process.env.CLAUDE_TEAM_CLI_PATH = cliPath;
process.env.CLAUDE_TEAM_WORKDIR = dir;
process.env.ANTHROPIC_API_KEY = 'must-not-reach-the-cli';
delete process.env.CLAUDE_TEAM_GATEWAY_URL;

const { generate, runCliStream } = require('../src/services/ai/claudeTeamPersonal');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('streams text deltas in order and resolves with the final result', async () => {
  const deltas = [];
  const result = await runCliStream({ prompt: 'hai', model: 'sonnet', onDelta: (text) => deltas.push(text) });
  assert.deepEqual(deltas, ['Halo', ' dunia']);
  assert.equal(result.content, 'Halo dunia');
  assert.equal(result.tokensIn, 7);
  assert.equal(result.tokensOut, 5);
});

test('prompt text starting with dashes is passed as data, not as a CLI flag', async () => {
  const result = await runCliStream({ prompt: '--tools=Bash', model: 'sonnet', onDelta: () => {} });
  assert.equal(result.content, '--tools=Bash');
});

test('a CLI error result rejects with a sanitized provider error', async () => {
  await assert.rejects(
    runCliStream({ prompt: 'FAIL', model: 'sonnet', onDelta: () => {} }),
    (error) => error.code === 'AI_PROVIDER_ERROR' && error.status === 502,
  );
});

test('a throwing delta consumer does not abort generation', async () => {
  const result = await runCliStream({
    prompt: 'hai',
    model: 'sonnet',
    onDelta: () => { throw new Error('consumer gone'); },
  });
  assert.equal(result.content, 'Halo dunia');
});

test('generate streams only when access was granted by the caller', async () => {
  const deltas = [];
  const result = await generate({ prompt: 'hai', context: { accessGranted: true }, onDelta: (t) => deltas.push(t) });
  assert.equal(result.content, 'Halo dunia');
  assert.equal(deltas.length, 2);
  await assert.rejects(
    generate({ prompt: 'hai', context: {}, onDelta: () => {} }),
    (error) => error.code === 'AI_PROVIDER_FORBIDDEN',
  );
});
