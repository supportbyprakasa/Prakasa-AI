function providerError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function generate({ system, prompt, model, params }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw providerError(
      'Claude API belum dikonfigurasi oleh administrator',
      'AI_PROVIDER_NOT_CONFIGURED',
      503
    );
  }

  const requestBody = {
    model,
    max_tokens: params?.max_tokens ?? 800,
    system,
    messages: [{ role: 'user', content: prompt }],
  };

  // Modern Claude models use adaptive thinking and may reject custom sampling
  // values. Keep sampling at provider defaults unless explicitly enabled for
  // a compatible model by the administrator.
  if (process.env.CLAUDE_ALLOW_TEMPERATURE === 'yes' && params?.temperature != null) {
    requestBody.temperature = params.temperature;
  }

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(Number(process.env.CLAUDE_TIMEOUT_MS || 120000)),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw providerError('Claude timeout', 'AI_PROVIDER_TIMEOUT', 504);
    }
    throw providerError('Claude tidak dapat dijangkau', 'AI_PROVIDER_UNAVAILABLE', 503);
  }

  if (!res.ok) {
    const status =
      res.status === 429 ? 503 :
      res.status >= 500 ? 503 :
      502;
    const code =
      res.status === 429 ? 'AI_PROVIDER_RATE_LIMIT' :
      res.status === 401 || res.status === 403 ? 'AI_PROVIDER_AUTH_ERROR' :
      'AI_PROVIDER_ERROR';
    throw providerError(`Claude error: ${res.status}`, code, status);
  }

  const json = await res.json();
  return {
    content: json.content
      ?.filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('') || '',
    tokensIn: json.usage?.input_tokens,
    tokensOut: json.usage?.output_tokens,
  };
}

module.exports = { generate };
