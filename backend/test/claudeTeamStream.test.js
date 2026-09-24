const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A fake `claude` CLI that reads the prompt from stdin and speaks the json / stream-json
// protocols, so the runner is tested without calling the real service.
const FAKE_CLI = `#!/usr/bin/env node
const argv = process.argv.slice(2);
const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
const fail = (why) => { out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: why }); process.exit(1); };
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { prompt += chunk; });
process.stdin.on('end', () => run());

function run() {
  if (argv.includes('--')) fail('prompt terminator in argv');
  if (prompt && argv.some((arg) => arg.includes(prompt.slice(0, 40)))) fail('prompt leaked into argv');
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) fail('api key leaked');
  for (const flag of ['-p', '--safe-mode', '--no-session-persistence']) {
    if (!argv.includes(flag)) fail('missing ' + flag);
  }
  if (argv.includes('--input-format')) {
    if (argv[argv.indexOf('--input-format') + 1] !== 'stream-json') fail('bad input format');
    if (argv[argv.indexOf('--output-format') + 1] !== 'stream-json') fail('vision needs stream-json output');
    const message = JSON.parse(prompt.trim());
    const [block, instruction] = message.message.content;
    const size = Buffer.from(block.source.data, 'base64').length;
    const reply = ['VISION', block.type, block.source.media_type, size, instruction.text.includes('verbatim')].join(':');
    out({ type: 'result', subtype: 'success', is_error: false, result: reply, usage: {} });
    return;
  }
  const format = argv[argv.indexOf('--output-format') + 1];
  const toolsArg = argv[argv.indexOf('--tools') + 1];

  if (prompt.startsWith('BIG')) {
    const reply = 'len=' + prompt.length;
    if (format === 'json') { out({ type: 'result', subtype: 'success', is_error: false, result: reply, usage: {} }); return; }
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: reply } } });
    out({ type: 'result', subtype: 'success', is_error: false, result: reply, usage: {} });
    return;
  }

  if (!argv.includes('--include-partial-messages')) fail('missing --include-partial-messages');
  if (prompt === 'WEB') {
    if (toolsArg !== 'WebSearch') fail('unexpected tools ' + toolsArg);
    if (argv[argv.indexOf('--allowedTools') + 1] !== 'WebSearch') fail('allowedTools mismatch');
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'harga kopi arabika' } }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'Harga naik', usage: {} });
    return;
  }
  if (prompt === 'SLOW') {
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Sebagian' } } });
    setTimeout(() => out({ type: 'result', subtype: 'success', is_error: false, result: 'terlambat', usage: {} }), 5000);
    return;
  }
  if (toolsArg !== '') fail('tools not disabled');
  if (argv.includes('--allowedTools')) fail('allowedTools without tools');
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
}
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prakasa-claude-'));
const cliPath = path.join(dir, 'claude');
fs.writeFileSync(cliPath, FAKE_CLI);
fs.chmodSync(cliPath, 0o755);

process.env.CLAUDE_TEAM_CLI_PATH = cliPath;
process.env.CLAUDE_TEAM_WORKDIR = dir;
process.env.ANTHROPIC_API_KEY = 'must-not-reach-the-cli';
delete process.env.CLAUDE_TEAM_GATEWAY_URL;

const { generate, runCli, runCliStream, transcribeVisual } = require('../src/services/ai/claudeTeamPersonal');

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

test('prompts far beyond the argv size limit reach the CLI intact via stdin', async () => {
  const prompt = `BIG${'x'.repeat(1_500_000)}`;
  const streamed = await runCliStream({ prompt, model: 'sonnet', onDelta: () => {} });
  assert.equal(streamed.content, `len=${prompt.length}`);
  const collected = await runCli({ prompt, model: 'sonnet' });
  assert.equal(collected.content, `len=${prompt.length}`);
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

test('only allow-listed web tools reach the CLI and tool calls report status', async () => {
  const statuses = [];
  const result = await runCliStream({
    prompt: 'WEB',
    model: 'sonnet',
    tools: ['WebSearch', 'Bash'],
    onDelta: () => {},
    onStatus: (status) => statuses.push(status),
  });
  assert.equal(result.content, 'Harga naik');
  assert.equal(result.toolCalls, 1);
  assert.deepEqual(statuses, [{ type: 'tool', tool: 'WebSearch', target: 'harga kopi arabika' }]);
});

test('aborting stops the CLI promptly with GENERATION_STOPPED', async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  await assert.rejects(
    runCliStream({
      prompt: 'SLOW',
      model: 'sonnet',
      signal: controller.signal,
      onDelta: () => controller.abort(),
    }),
    (error) => error.code === 'GENERATION_STOPPED',
  );
  assert.ok(Date.now() - startedAt < 3000, 'CLI was not killed promptly');
});

test('images and scanned PDFs are sent to the CLI as vision blocks over stdin', async () => {
  const image = await transcribeVisual({ buffer: Buffer.alloc(1234, 7), mimeType: 'image/png', model: 'sonnet' });
  assert.equal(image.content, 'VISION:image:image/png:1234:true');
  const pdf = await transcribeVisual({ buffer: Buffer.alloc(4321, 1), mimeType: 'application/pdf', model: 'sonnet' });
  assert.equal(pdf.content, 'VISION:document:application/pdf:4321:true');
});

test('vision rejects unsupported formats and oversized images before running the CLI', async () => {
  await assert.rejects(
    transcribeVisual({ buffer: Buffer.alloc(10), mimeType: 'image/heic', model: 'sonnet' }),
    (error) => error.code === 'VISION_UNSUPPORTED',
  );
  await assert.rejects(
    transcribeVisual({ buffer: Buffer.alloc(6 * 1024 * 1024), mimeType: 'image/jpeg', model: 'sonnet' }),
    (error) => error.code === 'VISION_TOO_LARGE',
  );
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
