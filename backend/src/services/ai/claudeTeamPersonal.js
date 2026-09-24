const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { safeModel } = require('./providerSettings');

const execFileAsync = promisify(execFile);
const MAX_CLI_OUTPUT_BYTES = 10 * 1024 * 1024;

function providerError(message, code = 'AI_PROVIDER_ERROR', status = 502) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function cliPath() {
  return process.env.CLAUDE_TEAM_CLI_PATH || 'claude';
}

function cliEnv() {
  const env = { ...process.env };
  // Force the Claude Code subscription credential path instead of API billing.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

async function callGateway({ system, prompt, model, context }) {
  const url = String(process.env.CLAUDE_TEAM_GATEWAY_URL || '').replace(/\/+$/, '');
  const secret = process.env.CLAUDE_TEAM_GATEWAY_SECRET;

  if (!url || !secret) {
    throw providerError(
      'Claude Team gateway belum dikonfigurasi',
      'AI_PROVIDER_NOT_CONFIGURED',
      503
    );
  }

  let response;
  try {
    response = await fetch(`${url}/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-prakasa-ai-gateway-secret': secret,
      },
      body: JSON.stringify({
        system,
        prompt,
        model,
        userEmail: context?.userEmail || null,
      }),
      signal: AbortSignal.timeout(
        Number(process.env.CLAUDE_TEAM_TIMEOUT_MS || 120000)
      ),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw providerError(
        'Claude Team gateway timeout',
        'AI_PROVIDER_TIMEOUT',
        504
      );
    }
    throw providerError(
      'Claude Team gateway tidak dapat dijangkau',
      'AI_PROVIDER_UNAVAILABLE',
      503
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // handled below
  }

  if (!response.ok) {
    const code = payload?.error?.code || 'AI_PROVIDER_ERROR';
    const status = response.status === 403 ? 403 : response.status >= 500 ? 503 : 502;
    throw providerError(
      payload?.error?.message || 'Claude Team gateway gagal',
      code,
      status
    );
  }

  return {
    content: String(payload?.content || ''),
    tokensIn: payload?.tokensIn,
    tokensOut: payload?.tokensOut,
  };
}

function cliTimeoutMs() {
  return Number(process.env.CLAUDE_TEAM_TIMEOUT_MS || 120000);
}

function cliArgs({ system, prompt, model, stream = false }) {
  const args = [
    '-p',
    '--safe-mode',
    '--no-session-persistence',
    '--tools',
    '',
    '--output-format',
    stream ? 'stream-json' : 'json',
  ];
  if (stream) args.push('--verbose', '--include-partial-messages');
  args.push('--model', safeModel(model) || 'sonnet');

  if (system) {
    args.push('--system-prompt', system);
  }

  // `--` ends option parsing so prompt text starting with "-" is never read as a CLI flag.
  args.push('--', String(prompt || ''));
  return args;
}

const timeoutError = () => providerError('Claude Team personal mode timeout', 'AI_PROVIDER_TIMEOUT', 504);
const notInstalledError = () => providerError('Claude CLI tidak tersedia pada host ini', 'AI_PROVIDER_NOT_CONFIGURED', 503);
const unavailableError = () => providerError('Claude Team personal mode tidak dapat dijalankan', 'AI_PROVIDER_UNAVAILABLE', 503);

function resultFromPayload(payload) {
  if (!payload || payload.is_error || payload.subtype !== 'success') {
    throw providerError(
      'Claude Team gagal memproses request',
      'AI_PROVIDER_ERROR',
      502
    );
  }

  const usage = payload.usage || {};
  const tokensIn =
    Number(usage.input_tokens || 0) +
    Number(usage.cache_creation_input_tokens || 0) +
    Number(usage.cache_read_input_tokens || 0);

  return {
    content: String(payload.result || ''),
    tokensIn,
    tokensOut: Number(usage.output_tokens || 0) || undefined,
  };
}

async function runCli({ system, prompt, model }) {
  let stdout;
  try {
    const result = await execFileAsync(cliPath(), cliArgs({ system, prompt, model }), {
      env: cliEnv(),
      timeout: cliTimeoutMs(),
      maxBuffer: MAX_CLI_OUTPUT_BYTES,
      cwd: process.env.CLAUDE_TEAM_WORKDIR || process.cwd(),
    });
    stdout = result.stdout;
  } catch (error) {
    if (error?.killed || error?.signal === 'SIGTERM') throw timeoutError();
    if (error?.code === 'ENOENT') throw notInstalledError();
    throw unavailableError();
  }

  let payload;
  try {
    payload = JSON.parse(String(stdout || '').trim());
  } catch {
    throw providerError(
      'Claude Team mengembalikan response yang tidak valid',
      'AI_PROVIDER_ERROR',
      502
    );
  }

  return resultFromPayload(payload);
}

// Streams text deltas from `--output-format stream-json`; resolves with the same shape as runCli.
function runCliStream({ system, prompt, model, onDelta }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cliPath(), cliArgs({ system, prompt, model, stream: true }), {
        env: cliEnv(),
        cwd: process.env.CLAUDE_TEAM_WORKDIR || process.cwd(),
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      reject(unavailableError());
      return;
    }

    let settled = false;
    let timedOut = false;
    let oversized = false;
    let received = 0;
    let pending = '';
    let finalPayload = null;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, cliTimeoutMs());

    const settle = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const handleLine = (line) => {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch { return; }
      const delta = event.type === 'stream_event' && event.event?.type === 'content_block_delta'
        ? event.event.delta
        : null;
      if (delta?.type === 'text_delta' && delta.text) {
        try { onDelta(delta.text); } catch { /* a failing consumer must not abort generation */ }
      } else if (event.type === 'result') {
        finalPayload = event;
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      received += Buffer.byteLength(chunk);
      if (received > MAX_CLI_OUTPUT_BYTES) {
        oversized = true;
        child.kill('SIGTERM');
        return;
      }
      pending += chunk;
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        handleLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    });

    child.on('error', (error) => {
      settle(() => reject(error?.code === 'ENOENT' ? notInstalledError() : unavailableError()));
    });

    child.on('close', () => {
      settle(() => {
        if (pending) handleLine(pending);
        if (timedOut) return reject(timeoutError());
        if (oversized) {
          return reject(providerError('Jawaban Claude Team terlalu besar', 'AI_PROVIDER_ERROR', 502));
        }
        try {
          resolve(resultFromPayload(finalPayload));
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}

// Access is decided by provider.js from the Super Admin settings; this module only
// runs requests the caller has explicitly authorized.
async function generate({ system, prompt, model, context, onDelta = null }) {
  if (context?.accessGranted !== true) {
    throw providerError(
      'Claude Team tidak tersedia untuk akun atau divisi Anda',
      'AI_PROVIDER_FORBIDDEN',
      403
    );
  }

  // The remote gateway does not stream yet; its answer arrives as one piece.
  if (process.env.CLAUDE_TEAM_GATEWAY_URL) {
    return callGateway({ system, prompt, model, context });
  }

  return typeof onDelta === 'function'
    ? runCliStream({ system, prompt, model, onDelta })
    : runCli({ system, prompt, model });
}

function parseAuthStatus(raw) {
  try {
    return JSON.parse(String(raw || '').trim());
  } catch {
    return null;
  }
}

async function cliStatus() {
  if (process.env.CLAUDE_TEAM_GATEWAY_URL) {
    return {
      mode: 'gateway',
      available: null,
      message: 'Claude Team dijalankan lewat gateway; status login dicek di host gateway.',
    };
  }

  let status = null;
  let errorCode = null;
  try {
    const { stdout } = await execFileAsync(cliPath(), ['auth', 'status'], {
      env: cliEnv(),
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    status = parseAuthStatus(stdout);
  } catch (error) {
    errorCode = error?.code;
    // `claude auth status` may exit non-zero when logged out but still print JSON.
    status = parseAuthStatus(error?.stdout);
  }

  if (!status) {
    return {
      mode: 'local',
      available: false,
      loggedIn: false,
      message: errorCode === 'ENOENT'
        ? 'Claude CLI tidak tersedia pada host ini'
        : 'Status Claude CLI tidak dapat dibaca',
    };
  }

  return {
    mode: 'local',
    available: true,
    loggedIn: Boolean(status.loggedIn),
    email: status.email || null,
    orgName: status.orgName || null,
    subscriptionType: status.subscriptionType || null,
    authMethod: status.authMethod || null,
  };
}

module.exports = {
  generate,
  runCli,
  runCliStream,
  callGateway,
  cliStatus,
};
