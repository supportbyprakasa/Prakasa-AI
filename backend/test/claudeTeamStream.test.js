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
  const agentMode = argv.includes('--strict-mcp-config');
  const required = agentMode
    ? ['-p', '--setting-sources=', '--no-session-persistence', '--mcp-config']
    : ['-p', '--safe-mode', '--no-session-persistence'];
  for (const flag of required) {
    if (!argv.includes(flag)) fail('missing ' + flag);
  }
  if (agentMode) {
    if (argv.includes('--safe-mode')) fail('safe mode would switch MCP off');
    const configPath = argv[argv.indexOf('--mcp-config') + 1];
    const fs = require('fs');
    if ((fs.statSync(configPath).mode & 0o777) !== 0o600) fail('mcp config readable by others');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config.mcpServers.prakasa.env.PRAKASA_AGENT_TOKEN) fail('no agent token');
    if (argv.some((arg) => arg.includes(config.mcpServers.prakasa.env.PRAKASA_AGENT_TOKEN))) fail('token in argv');
    if (argv[argv.indexOf('--tools') + 1] !== '') fail('built-in tools enabled in agent mode');
    if (argv[argv.indexOf('--allowedTools') + 1] !== 'mcp__prakasa__notifikasi_saya') fail('allowedTools ' + argv[argv.indexOf('--allowedTools') + 1]);
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__prakasa__notifikasi_saya', input: {} }] } });
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__prakasa__notifikasi_saya', input: {} }] } });
    out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'ok' }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'cwd=' + process.cwd(), usage: {} });
    return;
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
  const attempts = require('path').join(process.env.CLAUDE_TEAM_WORKDIR, 'attempts');
  if (prompt === 'LIMIT' || prompt === 'FLAKY' || prompt === 'LOGOUT' || prompt === 'COUNT') {
    require('fs').appendFileSync(attempts, prompt + '\\n');
  }
  if (prompt === 'LIMIT') {
    out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 4102444800, rateLimitType: 'five_hour', utilization: 1 } });
    out({ type: 'result', subtype: 'success', is_error: true, api_error_status: 429, result: 'Claude usage limit reached', usage: {} });
    return;
  }
  if (prompt === 'FLAKY') {
    const tries = require('fs').readFileSync(attempts, 'utf8').split('\\n').filter((l) => l === 'FLAKY').length;
    if (tries === 1) process.exit(1);
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'pulih' } } });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'pulih', usage: {} });
    return;
  }
  if (prompt === 'LOGOUT') {
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login', usage: {} });
    return;
  }
  if (prompt === 'COUNT') {
    out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: 4102444800, rateLimitType: 'seven_day', utilization: 0.52 } });
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } } });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: {} });
    return;
  }
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
process.env.CLAUDE_TEAM_RETRY_DELAY_MS = '10';
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
  assert.deepEqual(statuses, [{
    type: 'step', id: '', tool: 'WebSearch', label: 'Mencari di web', target: 'harga kopi arabika', status: 'running',
  }]);
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

test('agent mode: only the granted Prakasa tools, no safe mode, a private config and an empty working dir', async () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prakasa-agent-test-'));
  const configPath = path.join(agentDir, 'mcp.json');
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { prakasa: { command: 'node', args: [], env: { PRAKASA_AGENT_TOKEN: 'tok-123' } } } }), { mode: 0o600 });
  const work = path.join(agentDir, 'work');
  fs.mkdirSync(work);
  const statuses = [];
  try {
    const result = await generate({
      prompt: 'tanya', model: 'sonnet', context: { accessGranted: true }, account: { mode: 'cli' },
      onStatus: (s) => statuses.push(s),
      agent: { tools: [{ name: 'notifikasi_saya', label: 'Membaca notifikasi Anda' }], mcpConfigPath: configPath, cwd: work },
    });
    assert.equal(fs.realpathSync(result.content.slice(4)), fs.realpathSync(work));
    assert.equal(result.toolCalls, 1, 'a repeated tool_use block is one step');
    assert.deepEqual(statuses, [
      { type: 'step', id: 't1', tool: 'notifikasi_saya', label: 'Membaca notifikasi Anda', target: null, status: 'running' },
      { type: 'step', id: 't1', status: 'ok' },
    ]);
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
});

const limits = require('../src/services/ai/claudeTeamLimits');
const attemptsOf = (prompt) => {
  try { return fs.readFileSync(path.join(dir, 'attempts'), 'utf8').split('\n').filter((l) => l === prompt).length; } catch { return 0; }
};
const cliRun = (prompt, extra = {}) => generate({
  prompt, model: 'sonnet', context: { accessGranted: true }, account: { mode: 'cli' }, onDelta: () => {}, ...extra,
});

test('the usage window is recorded from every answer', async () => {
  limits.reset();
  await cliRun('COUNT');
  const snap = await limits.snapshot('cli');
  assert.equal(snap.rateStatus, 'allowed_warning');
  assert.equal(snap.rateType, 'seven_day');
  assert.equal(snap.utilization, 0.52);
  assert.equal(snap.cooldownUntil, null);
});

test('out of quota: users are told when it is back, and the CLI is not called again until then', async () => {
  limits.reset();
  await assert.rejects(cliRun('LIMIT'), (e) => e.code === 'AI_RATE_LIMITED' && e.status === 429 && /bisa dipakai lagi sekitar/.test(e.message));
  assert.equal(attemptsOf('LIMIT'), 1);
  await assert.rejects(cliRun('LIMIT'), (e) => e.code === 'AI_RATE_LIMITED');
  await assert.rejects(cliRun('hai'), (e) => e.code === 'AI_RATE_LIMITED', 'every run waits for the reset');
  assert.equal(attemptsOf('LIMIT'), 1, 'no second CLI run while the seat is out of quota');
  limits.reset();
});

test('a run that fails to start is retried once; a lapsed login is reported as such', async () => {
  limits.reset();
  const result = await cliRun('FLAKY');
  assert.equal(result.content, 'pulih');
  assert.equal(attemptsOf('FLAKY'), 2);
  await assert.rejects(cliRun('LOGOUT'), (e) => e.code === 'AI_PROVIDER_LOGGED_OUT' && e.status === 503);
  assert.equal(attemptsOf('LOGOUT'), 1, 'a login problem is not retried');
  assert.equal((await limits.snapshot('cli')).loggedIn, false);
  limits.reset();
});

// ------------------------------------------------------------------ Runner v2 (gateway)

const http = require('node:http');
const { createServer } = require('../src/scripts/claudeTeamGateway');
const { streamGateway } = require('../src/services/ai/claudeTeamPersonal');

const SECRET = 'x'.repeat(32);
async function startRunner(t) {
  const server = createServer({ secret: SECRET });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('runner v2 streams text and steps to the backend, which records the seat\'s usage window', async (t) => {
  limits.reset();
  const url = await startRunner(t);
  const deltas = [];
  const result = await streamGateway({
    prompt: 'COUNT', model: 'sonnet', account: { id: 7, mode: 'gateway', gatewayUrl: url, gatewaySecret: SECRET },
    onDelta: (d) => deltas.push(d),
  });
  assert.equal(result.content, 'ok');
  assert.deepEqual(deltas, ['ok']);
  assert.equal((await limits.snapshot('gateway:7')).utilization, 0.52);
  limits.reset();
});

test('runner v2 runs the agent with its own private config and reports steps', async (t) => {
  limits.reset();
  const url = await startRunner(t);
  const statuses = [];
  const result = await streamGateway({
    prompt: 'tanya', model: 'sonnet', account: { id: 7, mode: 'gateway', gatewayUrl: url, gatewaySecret: SECRET },
    agent: { tools: [{ name: 'notifikasi_saya', label: 'Membaca notifikasi Anda' }], token: 'tok-abc', apiUrl: 'https://api.example.test/api/v1' },
    onDelta: () => {}, onStatus: (s) => statuses.push(s),
  });
  assert.match(result.content, /^cwd=/);
  assert.deepEqual(statuses.map((s) => [s.tool, s.status]), [['notifikasi_saya', 'running'], [undefined, 'ok']]);
  const leftover = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('prakasa-ai-agent-'))
    .filter((n) => fs.existsSync(path.join(os.tmpdir(), n, 'mcp.json')) && fs.readFileSync(path.join(os.tmpdir(), n, 'mcp.json'), 'utf8').includes('tok-abc'));
  assert.deepEqual(leftover, [], 'the runner removes the token file after the answer');
  limits.reset();
});

test('runner v2: an exhausted seat pauses the backend too, and a wrong secret is refused', async (t) => {
  limits.reset();
  const url = await startRunner(t);
  const account = { id: 8, mode: 'gateway', gatewayUrl: url, gatewaySecret: SECRET };
  const before = attemptsOf('LIMIT');
  await assert.rejects(streamGateway({ prompt: 'LIMIT', model: 'sonnet', account, onDelta: () => {} }), (e) => e.code === 'AI_RATE_LIMITED' && /bisa dipakai lagi/.test(e.message));
  assert.ok((await limits.snapshot('gateway:8')).cooldownUntil, 'backend knows the seat is paused');
  await assert.rejects(streamGateway({ prompt: 'hai', model: 'sonnet', account, onDelta: () => {} }), (e) => e.code === 'AI_RATE_LIMITED');
  assert.equal(attemptsOf('LIMIT') - before, 1, 'the paused seat is not called again');
  limits.reset();
  await assert.rejects(
    streamGateway({ prompt: 'hai', model: 'sonnet', account: { ...account, gatewaySecret: 'y'.repeat(32) }, onDelta: () => {} }),
    (e) => e.status === 502,
  );
});

test('an older runner without v2 still answers through /generate', async (t) => {
  limits.reset();
  const server = http.createServer((req, res) => {
    if (req.url === '/generate') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ content: 'lama', tokensIn: 1 })); return; }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const result = await streamGateway({
    prompt: 'hai', model: 'sonnet', account: { id: 9, mode: 'gateway', gatewayUrl: `http://127.0.0.1:${server.address().port}`, gatewaySecret: SECRET },
    onDelta: () => {},
  });
  assert.equal(result.content, 'lama');
});
