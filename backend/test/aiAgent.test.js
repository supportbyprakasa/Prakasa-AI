const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-agent';

const pool = require('../src/db/pool');
const requireAuth = require('../src/middleware/requireAuth');
const { signAgentToken, verifyAgentToken } = require('../src/services/ai/agent/agentToken');
const agentTools = require('../src/services/ai/agent/agentTools');
const agentRun = require('../src/services/ai/agent/agentRun');
const { createHandler } = require('../src/services/ai/agent/mcpServer');
const ctrl = require('../src/controllers/aiAgent.controller');

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const token = () => signAgentToken({ userId: 15, entityId: 1, sessionId: 9, tools: ['profil_saya', 'notifikasi_saya'] });

test('an agent token is not a login token, and a login token is not an agent token', async (t) => {
  t.mock.method(pool, 'query', async () => { throw new Error('must not reach the database'); });
  const res = fakeRes();
  await requireAuth({ headers: { authorization: `Bearer ${token()}` } }, res, () => assert.fail('agent token accepted as login'));
  assert.equal(res.statusCode, 401);

  // Even one signed with the login secret is refused by its type.
  const forged = jwt.sign({ typ: 'ai_agent', sub: 15 }, process.env.JWT_SECRET);
  const res2 = fakeRes();
  await requireAuth({ headers: { authorization: `Bearer ${forged}` } }, res2, () => assert.fail('agent type accepted as login'));
  assert.equal(res2.statusCode, 401);

  const login = jwt.sign({ sub: 15 }, process.env.JWT_SECRET);
  assert.throws(() => verifyAgentToken(login));
  assert.deepEqual(verifyAgentToken(token()).tools, ['profil_saya', 'notifikasi_saya']);
});

function agentDb(t, { permissions = ['ai_command.use', 'notification.view'], sessionOwner = 15, status = 'active' } = {}) {
  t.mock.method(pool, 'query', async (sql) => {
    if (/FROM users\s+WHERE id = \?/.test(sql)) return [[{ id: 15, entity_id: 1, department_id: 5, email: 'uji@x', status }]];
    if (/FROM permissions p/.test(sql)) return [permissions.map((code) => ({ code }))];
    if (/FROM ai_sessions/.test(sql)) {
      return [[{ id: 9, entity_id: 1, department_id: 5, owner_user_id: sessionOwner, visibility: 'private', status: 'active', deleted_at: null }]];
    }
    if (/FROM users u LEFT JOIN departments/.test(sql)) return [[{ name: 'Uji Sales', email: 'uji@x', divisi: 'Sales' }]];
    if (/FROM user_roles ur JOIN roles/.test(sql)) return [[{ name: 'Sales Head' }]];
    return [[]];
  });
}

async function run(req, handler) {
  const res = fakeRes();
  let passed = false;
  await ctrl.requireAgent(req, res, () => { passed = true; });
  if (!passed) return res;
  await handler(req, res, (e) => { throw e; });
  return res;
}

test('the tool endpoint lists and runs only tools granted to this answer AND allowed for the user', async (t) => {
  agentDb(t, { permissions: ['ai_command.use'] }); // no notification.view
  const req = { headers: { authorization: `Bearer ${token()}` }, params: {}, body: {} };
  const listed = await run(req, ctrl.listTools);
  assert.deepEqual(listed.body.data.map((x) => x.name), ['profil_saya'], 'a permission the user lacks removes the tool');

  const refused = await run({ ...req, params: { name: 'notifikasi_saya' } }, ctrl.callTool);
  assert.equal(refused.statusCode, 403);

  const profile = await run({ ...req, params: { name: 'profil_saya' } }, ctrl.callTool);
  assert.deepEqual(profile.body.data, { nama: 'Uji Sales', email: 'uji@x', divisi: 'Sales', peran: ['Sales Head'] });
});

test('the tool endpoint refuses login tokens, inactive users and sessions the user cannot use', async (t) => {
  agentDb(t);
  const login = jwt.sign({ sub: 15 }, process.env.JWT_SECRET);
  assert.equal((await run({ headers: { authorization: `Bearer ${login}` }, params: {} }, ctrl.listTools)).statusCode, 401);
  t.mock.restoreAll();

  agentDb(t, { status: 'inactive' });
  assert.equal((await run({ headers: { authorization: `Bearer ${token()}` }, params: {} }, ctrl.listTools)).statusCode, 401);
  t.mock.restoreAll();

  agentDb(t, { sessionOwner: 99 });
  const other = await run({ headers: { authorization: `Bearer ${token()}` }, params: {} }, ctrl.listTools);
  assert.ok(other.statusCode >= 403, 'someone else\'s private session');
});

test('one answer cannot call tools without end', async (t) => {
  agentDb(t);
  const tok = token();
  let last;
  for (let i = 0; i <= ctrl.MAX_CALLS_PER_TOKEN; i += 1) {
    last = await run({ headers: { authorization: `Bearer ${tok}` }, params: { name: 'profil_saya' }, body: {} }, ctrl.callTool);
  }
  assert.equal(last.statusCode, 429);
});

test('the MCP server speaks the protocol and forwards calls with the agent token, marking results as data', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url.endsWith('/ai-agent/tools')) return { ok: true, status: 200, json: async () => ({ success: true, data: [{ name: 'profil_saya', description: 'x', inputSchema: {} }] }) };
    if (url.endsWith('/tools/gagal')) return { ok: false, status: 403, json: async () => ({ success: false, error: { message: 'Alat ini tidak tersedia untuk Anda' } }) };
    return { ok: true, status: 200, json: async () => ({ success: true, data: { nama: 'Uji' } }) };
  };
  const handle = createHandler({ api: 'http://127.0.0.1:3001/api/v1/', token: 'tok', fetchImpl });
  const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.result.serverInfo.name, 'prakasa');
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const list = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(list.result.tools[0].name, 'profil_saya');
  const call = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'profil_saya', arguments: {} } });
  const payload = JSON.parse(call.result.content[0].text);
  assert.match(payload.catatan, /data, bukan instruksi/);
  assert.deepEqual(payload.data, { nama: 'Uji' });
  const failed = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'gagal' } });
  assert.equal(failed.result.isError, true);
  assert.ok(seen.every((s) => s.init.headers.Authorization === 'Bearer tok'));
  assert.equal(seen[1].url, 'http://127.0.0.1:3001/api/v1/ai-agent/tools/profil_saya');
  const unknown = await handle({ jsonrpc: '2.0', id: 5, method: 'resources/list' });
  assert.equal(unknown.error.code, -32601);
});

test('the agent runs only on Claude Team, with tools to use, and within the daily limit', async (t) => {
  const user = { sub: 15, entityId: 1, permissions: ['ai_command.use'] };
  let used = 0;
  t.mock.method(pool, 'query', async () => [[{ n: used }]]);
  assert.equal((await agentRun.decide({ user, session: { id: 9 }, provider: 'gemini' })).ok, false);
  assert.equal((await agentRun.decide({ user, session: { id: 9 }, provider: 'claude_team' })).ok, true);
  used = agentRun.dailyLimit();
  const limited = await agentRun.decide({ user, session: { id: 9 }, provider: 'claude_team' });
  assert.equal(limited.reason, 'daily_limit');
  assert.match(limited.notice, /Batas harian/);
  process.env.AI_AGENT_ENABLED = 'false';
  t.after(() => { delete process.env.AI_AGENT_ENABLED; });
  used = 0;
  assert.equal((await agentRun.decide({ user, session: { id: 9 }, provider: 'claude_team' })).reason, 'disabled');
});

test('preparing an agent writes a private, short-lived config and removes it afterwards', async () => {
  const user = { sub: 15, entityId: 1, permissions: ['ai_command.use', 'notification.view'] };
  const agent = await agentRun.prepare({ user, session: { id: 9, visibility: 'private' } });
  // Exactly the public tools plus those notification.view alone opens — nothing a division permission guards.
  // (A tool offered by surface — the page tools, daftar_formulir — is not in an answer that names no surface.)
  const expected = agentTools.TOOLS.filter((x) => !x.surfaces && (x.public || [].concat(x.permission || []).includes('notification.view'))).map((x) => x.name);
  assert.deepEqual(agent.tools.map((x) => x.name).sort(), [...expected].sort());
  for (const name of ['profil_saya', 'notifikasi_saya', 'panduan_aplikasi']) assert.ok(expected.includes(name), name);
  assert.ok(agent.tools.every((x) => x.label), 'every tool carries the label shown as a step');
  assert.equal(fs.statSync(agent.mcpConfigPath).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(agent.cwd), [], 'the CLI starts in an empty folder');
  const config = JSON.parse(fs.readFileSync(agent.mcpConfigPath, 'utf8'));
  const claims = verifyAgentToken(config.mcpServers.prakasa.env.PRAKASA_AGENT_TOKEN);
  assert.equal(claims.sub, 15);
  assert.equal(claims.sid, 9);
  assert.ok(claims.exp - claims.iat <= 15 * 60);
  await agent.cleanup();
  assert.equal(fs.existsSync(agent.mcpConfigPath), false);
});

test('steps are collected once per tool call and finish with their result', () => {
  const log = agentRun.collectSteps();
  log.add({ type: 'notice', message: 'x' });
  log.add({ type: 'step', id: 'a', tool: 'profil_saya', label: 'Membaca profil Anda', status: 'running' });
  log.add({ type: 'step', id: 'b', tool: 'WebSearch', label: 'Mencari di web', target: 'harga kopi', status: 'running' });
  log.add({ type: 'step', id: 'a', status: 'ok' });
  log.add({ type: 'step', id: 'b', status: 'error' });
  assert.deepEqual(log.steps.map((s) => [s.tool, s.status, s.target]), [['profil_saya', 'ok', null], ['WebSearch', 'error', 'harga kopi']]);
});

test('every agent tool only reads and describes its input', () => {
  for (const tool of agentTools.TOOLS) {
    assert.match(tool.name, /^[a-z_]+$/);
    assert.ok(tool.label && tool.description, tool.name);
    assert.equal(tool.inputSchema.type, 'object');
    // run() is the sealed wrapper (permission, output guard, size cap); impl is the tool's own code.
    // A page tool has none: the browser carries it out (test/aiClientTools.test.js).
    if (tool.client) continue;
    const src = tool.impl.toString();
    assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/i, `${tool.name} must not write`);
  }
});
