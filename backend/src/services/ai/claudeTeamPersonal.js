const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function providerError(message, code = 'AI_PROVIDER_ERROR', status = 502) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isAllowedUser(context = {}) {
  const allowed = normalizedEmail(process.env.CLAUDE_TEAM_ALLOWED_EMAIL);
  const current = normalizedEmail(context.userEmail);
  return Boolean(
    process.env.CLAUDE_TEAM_SUBSCRIPTION_ENABLED === 'yes' &&
    allowed &&
    current &&
    allowed === current
  );
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

async function generate({ system, prompt, model, context }) {
  if (!isAllowedUser(context)) {
    throw providerError(
      'Claude Team personal mode tidak tersedia untuk user ini',
      'AI_PROVIDER_FORBIDDEN',
      403
    );
  }

  if (process.env.CLAUDE_TEAM_GATEWAY_URL) {
    return callGateway({ system, prompt, model, context });
  }

  const cli = process.env.CLAUDE_TEAM_CLI_PATH || 'claude';
  const timeout = Number(process.env.CLAUDE_TEAM_TIMEOUT_MS || 120000);

  const args = [
    '-p',
    '--safe-mode',
    '--no-session-persistence',
    '--tools',
    '',
    '--output-format',
    'json',
    '--model',
    model || 'sonnet',
  ];

  if (system) {
    args.push('--system-prompt', system);
  }

  args.push(prompt);

  const env = { ...process.env };
  // Force the Claude Code subscription credential path instead of API billing.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  let stdout;
  try {
    const result = await execFileAsync(cli, args, {
      env,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      cwd: process.env.CLAUDE_TEAM_WORKDIR || process.cwd(),
    });
    stdout = result.stdout;
  } catch (error) {
    if (error?.killed || error?.signal === 'SIGTERM') {
      throw providerError(
        'Claude Team personal mode timeout',
        'AI_PROVIDER_TIMEOUT',
        504
      );
    }
    if (error?.code === 'ENOENT') {
      throw providerError(
        'Claude CLI tidak tersedia pada host ini',
        'AI_PROVIDER_NOT_CONFIGURED',
        503
      );
    }
    throw providerError(
      'Claude Team personal mode tidak dapat dijalankan',
      'AI_PROVIDER_UNAVAILABLE',
      503
    );
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

  if (payload.is_error || payload.subtype !== 'success') {
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

module.exports = {
  generate,
  isAllowedUser,
  callGateway,
};
