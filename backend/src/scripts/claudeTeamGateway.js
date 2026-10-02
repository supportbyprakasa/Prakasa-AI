// Claude Team runner (gateway v2) — keeps Prakasa AI running on one Claude Team
// seat logged in on this machine (the owner's Mac for now, a VPS later), for a
// backend that cannot host the CLI itself (shared cPanel). See
// docs/claude-team-runner.md.
//
//   GET  /health     liveness only (no secret): { status: 'ok' }
//   GET  /v2/health  secret: login, queue and usage window of this seat
//   POST /v2/stream  secret: one answer, streamed as one JSON object per line:
//                    delta / status (agent steps, queue place) / rate_limit / result / error
//   POST /generate   secret: legacy one-piece answer (older backends)
//
// The shared secret is the trust boundary: the calling Prakasa backend has
// already authorized the user. Agent runs get a 15-minute token that only
// works on the Prakasa /ai-agent endpoint; the runner writes it to a private
// temp file for the CLI and removes it afterwards.

const http = require('node:http');
const crypto = require('node:crypto');
const { generate, cliStatus } = require('../services/ai/claudeTeamPersonal');
const { writeAgentConfig } = require('../services/ai/agent/agentRun');
const limits = require('../services/ai/claudeTeamLimits');
const { cliQueue } = require('../services/ai/cliQueue');

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const VERSION = 2;

function config() {
  const secret = process.env.CLAUDE_TEAM_GATEWAY_SECRET;
  if (!secret || secret.length < 24) throw new Error('CLAUDE_TEAM_GATEWAY_SECRET wajib diisi minimal 24 karakter.');
  return {
    host: process.env.CLAUDE_TEAM_GATEWAY_HOST || '127.0.0.1',
    port: Number(process.env.CLAUDE_TEAM_GATEWAY_PORT || 3199),
    secret,
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function authorized(req, secret) {
  const given = Buffer.from(String(req.headers['x-prakasa-ai-gateway-secret'] || ''));
  const expected = Buffer.from(secret);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Payload terlalu besar');
      error.status = 413;
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

// A known error keeps its user-facing message; anything else stays generic.
function publicError(error) {
  const known = ['AI_RATE_LIMITED', 'AI_BUSY', 'AI_PROVIDER_LOGGED_OUT', 'AI_PROVIDER_TIMEOUT', 'AI_PROVIDER_UNAVAILABLE', 'GENERATION_STOPPED', 'PAYLOAD_TOO_LARGE'];
  const isKnown = known.includes(error.code);
  return {
    status: isKnown && error.status ? error.status : 502,
    code: error.code || 'GATEWAY_ERROR',
    message: isKnown ? error.message : 'Claude Team gateway error',
    retryAt: error.retryAt || null,
  };
}

let cachedLogin = { at: 0, value: null };
async function loginStatus() {
  if (Date.now() - cachedLogin.at < 60000 && cachedLogin.value) return cachedLogin.value;
  const status = await cliStatus();
  cachedLogin = { at: Date.now(), value: status };
  if (typeof status.loggedIn === 'boolean') await limits.recordLogin('cli', { loggedIn: status.loggedIn });
  return status;
}

async function streamAnswer(req, res, body) {
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  const write = (obj) => { if (!res.writableEnded) res.write(`${JSON.stringify(obj)}\n`); };

  let agentFiles = null;
  try {
    let agent = null;
    if (body.agent?.token && body.agent?.apiUrl) {
      agentFiles = await writeAgentConfig({ token: body.agent.token, apiUrl: body.agent.apiUrl });
      agent = { tools: Array.isArray(body.agent.tools) ? body.agent.tools : [], ...agentFiles };
    }
    const result = await generate({
      system: body.system || '',
      prompt: String(body.prompt || ''),
      model: body.model || process.env.CLAUDE_TEAM_MODEL || 'sonnet',
      tools: Array.isArray(body.tools) ? body.tools : [],
      context: { accessGranted: true },
      account: { mode: 'cli' },
      agent,
      signal: controller.signal,
      onDelta: (text) => write({ type: 'delta', text }),
      onStatus: (status) => write({ type: 'status', status }),
    });
    const snap = await limits.snapshot('cli');
    if (snap.rateType) {
      write({
        type: 'rate_limit',
        info: {
          status: snap.rateStatus, rateLimitType: snap.rateType, utilization: snap.utilization,
          resetsAt: snap.resetsAt ? Math.floor(new Date(snap.resetsAt).getTime() / 1000) : null,
        },
      });
    }
    write({ type: 'result', result });
  } catch (error) {
    const pub = publicError(error);
    if (error.code === 'AI_RATE_LIMITED') {
      const snap = await limits.snapshot('cli');
      write({ type: 'rate_limit', info: { status: 'rejected', rateLimitType: snap.rateType, utilization: snap.utilization, resetsAt: snap.cooldownUntil ? Math.floor(new Date(snap.cooldownUntil).getTime() / 1000) : null } });
    }
    write({ type: 'error', error: pub });
  } finally {
    if (agentFiles) await agentFiles.cleanup();
    if (!res.writableEnded) res.end();
  }
}

function createServer({ secret }) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return sendJson(res, 200, { status: 'ok', version: VERSION });
      if (!authorized(req, secret)) return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });

      if (req.method === 'GET' && req.url === '/v2/health') {
        const login = await loginStatus();
        return sendJson(res, 200, {
          status: 'ok',
          version: VERSION,
          loggedIn: typeof login.loggedIn === 'boolean' ? login.loggedIn : null,
          subscriptionType: login.subscriptionType || null,
          limits: await limits.snapshot('cli'),
          queue: cliQueue.stats(),
        });
      }
      if (req.method === 'POST' && req.url === '/v2/stream') return streamAnswer(req, res, await readBody(req));
      if (req.method === 'POST' && req.url === '/generate') {
        const body = await readBody(req);
        const result = await generate({
          system: body.system || '', prompt: String(body.prompt || ''), model: body.model || process.env.CLAUDE_TEAM_MODEL || 'sonnet',
          context: { accessGranted: true }, account: { mode: 'cli' },
        });
        return sendJson(res, 200, result);
      }
      return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    } catch (error) {
      const pub = publicError(error);
      if (res.headersSent) { if (!res.writableEnded) res.end(); return undefined; }
      return sendJson(res, pub.status, { error: pub });
    }
  });
}

if (require.main === module) {
  require('dotenv').config();
  // Limits live in memory here; the backend records what the runner forwards.
  process.env.CLAUDE_TEAM_LIMITS_PERSIST = 'false';
  const { host, port, secret } = config();
  createServer({ secret }).listen(port, host, () => {
    console.log(`Claude Team runner v${VERSION} listening on http://${host}:${port}`);
  });
}

module.exports = { createServer, publicError, VERSION };
